import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { member, organization, user } from "@/db/auth-schema";
import {
	closedMonthEmployee,
	employee,
	employeeTrackingSettings,
	organizationTrackingSettings,
	userSettings,
} from "@/db/schema";
import type { AbsenceDaysDatabase } from "@/lib/absences/absence-days-resolver";
import { loadVacationBalances } from "@/lib/absences/vacation-balance-store";
import { AuditAction } from "@/lib/audit-logger";
import { AuditTrail } from "@/lib/audit-trail";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { readOpeningBalanceInEffect } from "@/lib/work-balance/adjustments/ledger";
import type { WorkBalanceDatabase, WorkBalanceDbClient } from "@/lib/work-balance/db-client";
import { computeEmployeePeriodBalance } from "@/lib/work-balance/period-aggregation";
import { recordWorkBalanceRebuildIntent } from "@/lib/work-balance/rebuild-intents";
import {
	computeEmployeeWorkBalanceSnapshotAtEndOfDay,
	type WorkBalanceSnapshot,
} from "@/lib/work-balance/service";
import { loadTrackingReviewEvidence, trackingReviewFingerprint } from "./tracking-date-evidence";
import {
	type TrackingDateImpact,
	TrackingDateRefusal,
	type TrackingEmployeeImpact,
} from "./tracking-date-review-types";
import { loadEmployeeTrackingContext } from "./tracking-start";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireUserConfigurationAccessGuards,
} from "./work-transaction";
import { acquireExclusiveOrganizationConfigurationGuard } from "./work-transaction/ranks";

export type ReviewScope = { organizationId: string; actorUserId: string; now: Instant };
export type OrganizationTrackingProposal = { trackingStartDate: string };

export function parseTrackingProposal(
	input: OrganizationTrackingProposal,
): OrganizationTrackingProposal {
	try {
		return { trackingStartDate: parsePlainDate(input?.trackingStartDate).toString() };
	} catch {
		throw new TrackingDateRefusal(
			"invalid_input",
			"Choose a valid calendar date for time tracking.",
		);
	}
}

/** Revalidated under the actor's access guard for commits; never trusts a UI role or submitted org ID. */
export async function assertTrackingDateAdministrator(
	client: WorkBalanceDbClient,
	input: ReviewScope,
): Promise<void> {
	const [actor] = await client
		.select({ role: member.role, active: employee.isActive, banned: user.banned })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.leftJoin(
			employee,
			and(eq(employee.userId, member.userId), eq(employee.organizationId, member.organizationId)),
		)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				eq(member.userId, input.actorUserId),
				eq(member.status, "approved"),
			),
		);
	if (
		!actor ||
		actor.active === false ||
		actor.banned ||
		(!hasOrganizationRole(actor.role, "owner") && !hasOrganizationRole(actor.role, "admin"))
	) {
		throw new TrackingDateRefusal(
			"not_permitted",
			"Only an active organization admin can review or change tracking dates.",
		);
	}
}

/** Public production preview: reads a coherent snapshot and never activates or writes projections. */
export async function previewOrganizationTrackingDate(
	database: WorkBalanceDatabase,
	input: ReviewScope & OrganizationTrackingProposal,
): Promise<TrackingDateImpact> {
	const proposal = parseTrackingProposal(input);
	return database.transaction(
		async (tx) => {
			await assertTrackingDateAdministrator(tx, input);
			return loadTrackingDateImpact(tx, { ...input, ...proposal });
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}

/**
 * Organization-scoped impact plan, built from the production snapshots and monthly aggregation
 * also used by employee correction workflows.
 */
export async function loadTrackingDateImpact(
	client: AbsenceDaysDatabase,
	input: ReviewScope &
		OrganizationTrackingProposal & {
			employeeId?: string;
			employeeTrackingStartDateOverride?: string | null;
			employeeEmploymentStartDateOverride?: string;
		},
): Promise<TrackingDateImpact> {
	const [org] = await client
		.select({ timezone: organization.timezone, createdAt: organization.createdAt })
		.from(organization)
		.where(eq(organization.id, input.organizationId));
	if (!org) throw new TrackingDateRefusal("not_permitted", "The organization is not available.");
	const [settings] = await client
		.select()
		.from(organizationTrackingSettings)
		.where(eq(organizationTrackingSettings.organizationId, input.organizationId));
	const rows = await client
		.select({
			id: employee.id,
			startDate: employee.startDate,
			userId: employee.userId,
			name: user.name,
			userTimezone: userSettings.timezone,
			exception: employeeTrackingSettings.trackingStartDate,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			employeeTrackingSettings,
			and(
				eq(employeeTrackingSettings.organizationId, employee.organizationId),
				eq(employeeTrackingSettings.employeeId, employee.id),
			),
		)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				input.employeeId ? eq(employee.id, input.employeeId) : undefined,
			),
		)
		.orderBy(asc(employee.id));
	const closures = await client
		.select()
		.from(closedMonthEmployee)
		.where(
			and(
				eq(closedMonthEmployee.organizationId, input.organizationId),
				isNull(closedMonthEmployee.reopenedAt),
			),
		);
	const employees: TrackingEmployeeImpact[] = [];
	const blockers: TrackingDateImpact["blockers"] = [];
	const organizationTimezone = resolveEffectiveTimezone(null, org.timezone);
	for (const row of rows) {
		const timezone = resolveEffectiveTimezone(row.userTimezone, org.timezone);
		const throughDate = plainDateAt(input.now, timezone).subtract({ days: 1 }).toString();
		const target = { id: row.id, startDate: row.startDate, timezone };
		const scope = { organizationId: input.organizationId, employeeId: row.id };
		const projection = {
			trackingStartDateOverride: input.trackingStartDate,
			employeeTrackingStartDateOverride: input.employeeTrackingStartDateOverride,
			employeeEmploymentStartDateOverride: input.employeeEmploymentStartDateOverride,
		};
		const exception =
			input.employeeTrackingStartDateOverride === undefined
				? row.exception
				: input.employeeTrackingStartDateOverride;
		const employmentStart =
			input.employeeEmploymentStartDateOverride ??
			(row.startDate ? plainDateAt(instantFromDate(row.startDate), "UTC").toString() : null);
		if (
			exception &&
			(exception < input.trackingStartDate || (employmentStart && exception < employmentStart))
		)
			blockers.push({
				employeeId: row.id,
				kind: "employee_exception_conflict",
				exceptionDate: exception,
				minimumDate:
					employmentStart && employmentStart > input.trackingStartDate
						? employmentStart
						: input.trackingStartDate,
			});
		const beforeContext = await loadEmployeeTrackingContext(client, scope);
		const afterContext = await loadEmployeeTrackingContext(client, {
			...scope,
			...projection,
		});
		if (!afterContext) throw new Error("A proposed tracking context could not be resolved");
		const snapshot = (day: string, proposed: boolean, snapshotTimezone = timezone) =>
			computeEmployeeWorkBalanceSnapshotAtEndOfDay(
				{
					organizationId: input.organizationId,
					employee: { ...target, timezone: snapshotTimezone },
					day,
					employeeTimezoneOverride: snapshotTimezone,
					...(proposed ? projection : {}),
				},
				client,
			);
		const [before, after, openingBalance] = await Promise.all([
			snapshot(throughDate, false),
			snapshot(throughDate, true),
			readOpeningBalanceInEffect(client, scope),
		]);
		const oldBoundary = beforeContext?.startDate ?? before.calculationStartDate;
		// List every month from the earliest changed boundary, plus any closed month whose accumulated result changes.
		const firstDay =
			[oldBoundary, input.trackingStartDate, afterContext.startDate]
				.filter((day): day is string => !!day)
				.sort()[0] ?? throughDate;
		const months = new Set<string>();
		let cursor = parsePlainDate(firstDay).with({ day: 1 });
		const last = parsePlainDate(throughDate).with({ day: 1 });
		while (cursor.toString() <= last.toString()) {
			months.add(cursor.toPlainYearMonth().toString());
			cursor = cursor.add({ months: 1 });
		}
		const employeeClosures = closures.filter((closure) => closure.employeeId === row.id);
		for (const closure of employeeClosures) months.add(closure.month.slice(0, 7));
		const periods: TrackingEmployeeImpact["periods"] = [];
		for (const month of [...months].sort()) {
			const start = parsePlainDate(`${month}-01`);
			const end = start.add({ months: 1 }).subtract({ days: 1 }).toString();
			const day = end > throughDate ? throughDate : end;
			const closedRange = employeeClosures.find((closure) => closure.month.slice(0, 7) === month);
			const periodTimezone = closedRange?.timezone ?? timezone;
			const ending = await Promise.all([
				snapshot(day, false, periodTimezone),
				snapshot(day, true, periodTimezone),
			]);
			const monthFor = (value: WorkBalanceSnapshot, proposed: boolean) =>
				computeEmployeePeriodBalance({
					...scope,
					dbClient: client,
					periodType: "month",
					periodStart: start.toString(),
					periodEnd: day,
					calculationStartDate: value.calculationStartDate,
					timezone: periodTimezone,
					employeeTimezoneOverride: periodTimezone,
					isClosed: false,
					...(proposed ? projection : {}),
				});
			const monthly = await Promise.all([monthFor(ending[0], false), monthFor(ending[1], true)]);
			const prior = {
				...ending[0],
				actualMinutes: monthly[0].actualMinutes,
				requiredMinutes: monthly[0].requiredMinutes,
			};
			const proposed = {
				...ending[1],
				actualMinutes: monthly[1].actualMinutes,
				requiredMinutes: monthly[1].requiredMinutes,
			};
			const changed =
				prior.actualMinutes !== proposed.actualMinutes ||
				prior.requiredMinutes !== proposed.requiredMinutes ||
				prior.balanceMinutes !== proposed.balanceMinutes;
			const closed = !!closedRange;
			if (changed) {
				periods.push({ month, timezone: periodTimezone, before: prior, after: proposed, closed });
				if (closed) blockers.push({ employeeId: row.id, kind: "month_closed", month });
			}
		}
		const vacation: TrackingEmployeeImpact["vacation"] = [];
		const years = new Set([
			parsePlainDate(throughDate).year,
			...periods.map((period) => Number(period.month.slice(0, 4))),
		]);
		for (const year of [...years].sort()) {
			const result = await loadVacationBalances(client, {
				organizationId: input.organizationId,
				employeeIds: [row.id],
				year,
				timezone: organizationTimezone,
				currentDate: dateFromInstant(input.now),
			});
			const balance = result.balances.get(row.id);
			if (balance)
				vacation.push({
					year,
					allowanceDays: balance.allowanceDays,
					remainingDays: balance.remainingDays,
				});
		}
		employees.push({
			employeeId: row.id,
			employeeName: row.name,
			timezone,
			throughDate,
			oldBoundary,
			proposedBoundary: afterContext.startDate,
			before,
			after,
			periods,
			openingBalance,
			vacation,
		});
	}
	const impact = {
		kind: settings?.activatedAt ? ("date_change" as const) : ("activation" as const),
		currentDate: settings?.activatedAt ? settings.trackingStartDate : null,
		proposedDate: input.trackingStartDate,
		employees,
		blockers,
	};
	const evidence = await loadTrackingReviewEvidence(client, input.organizationId);
	const fingerprint = trackingReviewFingerprint({
		version: 1,
		proposal: {
			employeeId: input.employeeId ?? null,
			employeeTrackingStartDateOverride: input.employeeTrackingStartDateOverride,
			employeeEmploymentStartDateOverride: input.employeeEmploymentStartDateOverride,
		},
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		organization: org,
		settings: settings ?? null,
		impact,
		evidence,
	});
	return { ...impact, fingerprint };
}

/**
 * Reusable commit scope for tracking and personnel-date corrections: guards, current authority,
 * reviewed evidence and blockers, the caller's atomic mutation, and a durable projection reset.
 */
export async function commitReviewedTrackingChange<T extends TrackingDateImpact>(
	database: WorkBalanceDatabase,
	input: ReviewScope & {
		fingerprint: string;
		plan: (client: Parameters<Parameters<WorkBalanceDatabase["transaction"]>[0]>[0]) => Promise<T>;
		write: (
			client: Parameters<Parameters<WorkBalanceDatabase["transaction"]>[0]>[0],
			impact: T,
			audit: AuditTrail,
		) => Promise<void>;
	},
): Promise<T> {
	const audit = new AuditTrail();
	let result: T;
	try {
		result = await database.transaction(
			async (tx) => {
				await acquireAdoptionGate(tx, input.organizationId);
				await acquireExclusiveOrganizationConfigurationGuard(tx, input.organizationId);
				const employees = await tx
					.select({ id: employee.id, userId: employee.userId })
					.from(employee)
					.where(eq(employee.organizationId, input.organizationId))
					.orderBy(asc(employee.id));
				await acquireUserConfigurationAccessGuards(tx, [
					input.actorUserId,
					...employees.map((row) => row.userId),
				]);
				await acquireEmployeeCoordination(
					tx,
					employees.map((row) => row.id),
				);
				await assertTrackingDateAdministrator(tx, input);
				await loadTrackingReviewEvidence(tx, input.organizationId, true);
				const impact = await input.plan(tx);
				if (impact.fingerprint !== input.fingerprint)
					throw new TrackingDateRefusal(
						"stale_preview",
						"The reviewed inputs changed. Generate a new preview before saving.",
					);
				if (impact.blockers.length)
					throw new TrackingDateRefusal(
						"blocked",
						impact.blockers.some((blocker) => blocker.kind === "employee_exception_conflict")
							? "Resolve the conflicting employee tracking exception before saving this change."
							: "Reopen the affected closed months before saving this change.",
					);
				await input.write(tx, impact, audit);
				await recordWorkBalanceRebuildIntent(tx, {
					organizationId: input.organizationId,
					reason: "tracking_dates",
					requestedBy: input.actorUserId,
					requestedAt: dateFromInstant(input.now),
				});
				return impact;
			},
			{ isolationLevel: "serializable" },
		);
	} catch (error) {
		const code =
			(error as { code?: string; cause?: { code?: string } })?.code ??
			(error as { cause?: { code?: string } })?.cause?.code;
		if (code === "40001" || code === "40P01")
			throw new TrackingDateRefusal(
				"stale_preview",
				"The reviewed inputs changed concurrently. Generate a new preview.",
			);
		throw error;
	}
	audit.forwardCommitted();
	return result;
}

export async function commitOrganizationTrackingDate(
	database: WorkBalanceDatabase,
	input: ReviewScope & OrganizationTrackingProposal & { fingerprint: string; reason: string },
): Promise<TrackingDateImpact> {
	const proposal = parseTrackingProposal(input);
	if (typeof input.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.fingerprint))
		throw new TrackingDateRefusal(
			"invalid_input",
			"Review this tracking-date change before saving.",
		);
	const reason = typeof input.reason === "string" ? input.reason.trim() : "";
	if (!reason || reason.length > 1000)
		throw new TrackingDateRefusal("invalid_input", "Enter a reason of at most 1,000 characters.");
	return commitReviewedTrackingChange(database, {
		...input,
		plan: (client) => loadTrackingDateImpact(client, { ...input, ...proposal }),
		write: async (client, impact, audit) => {
			const timestamp = dateFromInstant(input.now);
			await client
				.insert(organizationTrackingSettings)
				.values({
					organizationId: input.organizationId,
					trackingStartDate: proposal.trackingStartDate,
					activatedAt: timestamp,
					activatedBy: input.actorUserId,
					updatedAt: timestamp,
					updatedBy: input.actorUserId,
				})
				.onConflictDoUpdate({
					target: organizationTrackingSettings.organizationId,
					set: {
						trackingStartDate: proposal.trackingStartDate,
						activatedAt: sql`coalesce(${organizationTrackingSettings.activatedAt}, ${timestamp})`,
						activatedBy: sql`coalesce(${organizationTrackingSettings.activatedBy}, ${input.actorUserId})`,
						updatedAt: timestamp,
						updatedBy: input.actorUserId,
						revision: sql`${organizationTrackingSettings.revision} + 1`,
					},
				});
			await audit.record(client, {
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				targetType: "organization",
				targetId: input.organizationId,
				action: AuditAction.ORGANIZATION_TRACKING_DATES_CHANGED,
				changes: {
					from: { active: impact.kind !== "activation", trackingStartDate: impact.currentDate },
					to: { active: true, trackingStartDate: proposal.trackingStartDate },
				},
				metadata: { reason, fingerprint: input.fingerprint, source: "reviewed_tracking_dates" },
			});
		},
	});
}
