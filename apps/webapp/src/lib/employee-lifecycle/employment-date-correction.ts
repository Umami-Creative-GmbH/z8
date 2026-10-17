import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import {
	closedMonthEmployee,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentPeriod,
	organizationTrackingSettings,
} from "@/db/schema";
import type { AbsenceDaysDatabase } from "@/lib/absences/absence-days-resolver";
import {
	type VacationBalance,
	vacationConfigurationProblem,
} from "@/lib/absences/types";
import { loadVacationBalances } from "@/lib/absences/vacation-balance-store";
import { vacationPolicyCalculationsEnabled } from "@/lib/absences/vacation-policy-rollout";
import {
	applyEmploymentVacationRefresh,
	planEmploymentVacationRefresh,
} from "@/lib/absences/vacation-employment-refresh";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { trackingReviewFingerprint } from "@/lib/time-tracking/tracking-date-evidence";
import {
	assertTrackingDateAdministrator,
	commitReviewedTrackingChange,
	loadTrackingDateImpact,
} from "@/lib/time-tracking/tracking-date-review";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import type { WorkBalanceDatabase } from "@/lib/work-balance/db-client";
import type {
	EmploymentDateCorrectionImpact,
	VacationCorrectionBalance,
} from "./employment-date-correction-types";
export type EmploymentDateCorrectionScope = {
	organizationId: string;
	actorUserId: string;
	now: Instant;
};
export type EmploymentDateCorrectionProposal = {
	employeeId: string;
	employmentStartDate: string;
};
export function parseEmploymentDateCorrection(
	input: EmploymentDateCorrectionProposal,
): EmploymentDateCorrectionProposal {
	try {
		if (!isCanonicalUuid(input.employeeId)) throw new Error();
		return {
			employeeId: input.employeeId,
			employmentStartDate: parsePlainDate(input.employmentStartDate).toString(),
		};
	} catch {
		throw new TrackingDateRefusal(
			"invalid_input",
			"Choose an employee and a valid actual joining date.",
		);
	}
}
const asBalance = (
	balance: VacationBalance | undefined,
): VacationCorrectionBalance | null =>
	balance
		? {
				allowanceDays: balance.allowanceDays,
				totalDays: balance.totalDays,
				remainingDays: balance.remainingDays,
				usedDays: balance.usedDays,
				pendingDays: balance.pendingDays,
				overdrawnDays: balance.overdrawnDays,
				carryoverDays: balance.carryoverDays ?? 0,
			}
		: null;
export async function loadEmploymentDateCorrectionImpact(
	client: AbsenceDaysDatabase,
	input: EmploymentDateCorrectionScope & EmploymentDateCorrectionProposal,
): Promise<EmploymentDateCorrectionImpact> {
	const proposal = parseEmploymentDateCorrection(input);
	const [target] = await client
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, proposal.employeeId),
			),
		);
	if (!target)
		throw new TrackingDateRefusal(
			"not_permitted",
			"The employee is not available in this organization.",
		);
	const [settings] = await client
		.select()
		.from(organizationTrackingSettings)
		.where(
			eq(organizationTrackingSettings.organizationId, input.organizationId),
		);
	if (!settings?.activatedAt)
		throw new TrackingDateRefusal(
			"blocked",
			"Activate reviewed tracking dates in organization settings before correcting employment dates.",
		);
	const [org] = await client
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, input.organizationId));
	const timezone = org?.timezone ?? "UTC";
	const periods = await client
		.select()
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				eq(employeeEmploymentPeriod.employeeId, proposal.employeeId),
			),
		)
		.orderBy(
			sql`${employeeEmploymentPeriod.startedAt} asc nulls first`,
			asc(employeeEmploymentPeriod.id),
		);
	const terms = await client
		.select()
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.employeeId, proposal.employeeId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
			),
		);
	const first = periods[0];
	const next = periods[1];
	const employmentBlockers: EmploymentDateCorrectionImpact["employmentBlockers"] =
		[];
	const proposedInstant = parsePlainDate(proposal.employmentStartDate)
		.toZonedDateTime(timezone)
		.toInstant();
	if (
		target.endDate &&
		proposal.employmentStartDate >
			plainDateAt(instantFromDate(target.endDate), "UTC").toString() &&
		periods.length <= 1
	)
		employmentBlockers.push({
			code: "after_departure",
			message: "The joining date must precede the recorded last working day.",
		});
	if (
		first?.endedAt &&
		proposedInstant.epochMilliseconds >= first.endedAt.getTime()
	)
		employmentBlockers.push({
			code: "after_departure",
			message:
				"The joining date must precede the original employment's departure.",
		});
	if (
		terms.some(
			(term) =>
				(term.employmentPeriodId === first?.id || !term.employmentPeriodId) &&
				proposedInstant.epochMilliseconds > term.validFrom.getTime(),
		)
	)
		employmentBlockers.push({
			code: "confirmed_terms",
			message:
				"The joining date would exclude confirmed employment terms. Resolve those terms before correcting the date.",
		});
	if (
		next?.startedAt &&
		proposedInstant.epochMilliseconds >= next.startedAt.getTime()
	) {
		employmentBlockers.push({
			code: "rehire_conflict",
			message:
				"The original joining date must precede the separately recorded rehire. Correct each employment record without bridging the gap.",
		});
	}
	const workInput = {
		...input,
		trackingStartDate: settings.trackingStartDate,
		employeeId: proposal.employeeId,
		employeeEmploymentStartDateOverride: proposal.employmentStartDate,
	};
	const work = await loadTrackingDateImpact(client, workInput);
	const previousEmploymentStartDate = target.startDate
		? plainDateAt(instantFromDate(target.startDate), "UTC").toString()
		: null;
	const currentYear = plainDateAt(input.now, timezone).year;
	const firstYear = Math.min(
		currentYear,
		Math.max(
			2026,
			Math.min(
				Number(proposal.employmentStartDate.slice(0, 4)),
				Number(previousEmploymentStartDate?.slice(0, 4) ?? currentYear),
			),
		),
	);
	const refresh = await planEmploymentVacationRefresh(client, {
		...input,
		...proposal,
		timezone,
	});
	const vacation: EmploymentDateCorrectionImpact["vacation"] = [];
	const vacationPolicies: unknown[] = [];
	const years = new Set([
		...refresh.accrualSums.keys(),
		...refresh.carryovers.map((row) => row.year),
	]);
	for (let year = firstYear; year <= currentYear; year++) years.add(year);
	for (const year of [...years].sort((a, b) => a - b)) {
		const params = {
			organizationId: input.organizationId,
			employeeIds: [proposal.employeeId],
			year,
			timezone,
			currentDate: dateFromInstant(input.now),
		};
		const before = await loadVacationBalances(client, params);
		const after = await loadVacationBalances(client, {
			...params,
			employeeEmploymentStartDateOverrides: new Map([
				[proposal.employeeId, proposal.employmentStartDate],
			]),
			carryoverDaysOverrides: refresh.carryovers.some(
				(row) => row.year === year,
			)
				? new Map([
						[
							proposal.employeeId,
							refresh.carryovers.find((row) => row.year === year)?.days ?? "0",
						],
					])
				: undefined,
			accrualDaysOverrides: refresh.accrualSums.has(year)
				? new Map([[proposal.employeeId, refresh.accrualSums.get(year) ?? 0]])
				: undefined,
		});
		const beforeConfiguration = before.configurations.get(proposal.employeeId);
		const afterConfiguration = after.configurations.get(proposal.employeeId);
		const problem = [beforeConfiguration, afterConfiguration].find(
			(row) => row?.status === "missing" || row?.status === "conflict",
		);
		if (problem && await vacationPolicyCalculationsEnabled(client,input.organizationId,year))
			employmentBlockers.push({
				code: "vacation_policy_configuration",
				message: vacationConfigurationProblem(problem),
			});
		vacationPolicies.push({
			year,
			before: before.periods.get(proposal.employeeId),
			after: after.periods.get(proposal.employeeId),
		});
		vacation.push({
			beforeConfiguration,
			afterConfiguration,
			year,
			before: asBalance(before.balances.get(proposal.employeeId)),
			after: asBalance(after.balances.get(proposal.employeeId)),
		});
	}
	const closures = await client
		.select({ month: closedMonthEmployee.month })
		.from(closedMonthEmployee)
		.where(
			and(
				eq(closedMonthEmployee.organizationId, input.organizationId),
				eq(closedMonthEmployee.employeeId, proposal.employeeId),
				isNull(closedMonthEmployee.reopenedAt),
			),
		);
	for (const closure of closures) {
		const year = Number(closure.month.slice(0, 4));
		const annual = vacation.find((row) => row.year === year);
		if (
			annual &&
			JSON.stringify(annual.before) !== JSON.stringify(annual.after) &&
			!work.blockers.some(
				(row) =>
					row.kind === "month_closed" &&
					row.month === closure.month.slice(0, 7),
			)
		)
			work.blockers.push({
				employeeId: proposal.employeeId,
				kind: "month_closed",
				month: closure.month.slice(0, 7),
			});
	}
	const impact = {
		...work,
		employeeId: proposal.employeeId,
		employmentStartDate: proposal.employmentStartDate,
		previousEmploymentStartDate,
		employmentPeriodId: first?.id ?? null,
		employmentBlockers,
		vacation,
	};
	return {
		...impact,
		fingerprint: trackingReviewFingerprint({
			kind: "employment_correction",
			impact,
			vacationPolicies,
			periods,
			terms,
			refresh: {
				accruals: refresh.accruals,
				accrualSums: [...refresh.accrualSums],
				carryovers: refresh.carryovers,
				carryoverEvidence: refresh.carryoverEvidence,
			},
		}),
	};
}
export async function previewEmploymentDateCorrection(
	database: WorkBalanceDatabase,
	input: EmploymentDateCorrectionScope & EmploymentDateCorrectionProposal,
) {
	return database.transaction(
		async (tx) => {
			await assertTrackingDateAdministrator(tx, input);
			return loadEmploymentDateCorrectionImpact(tx, input);
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}
export async function validateEmploymentDateCorrectionReview(
	client: AbsenceDaysDatabase,
	input: EmploymentDateCorrectionScope &
		EmploymentDateCorrectionProposal & { fingerprint: string },
) {
	await assertTrackingDateAdministrator(client, input);
	const impact = await loadEmploymentDateCorrectionImpact(client, input);
	if (input.fingerprint !== impact.fingerprint)
		throw new TrackingDateRefusal(
			"stale_preview",
			"The reviewed employment or configuration changed. Generate a new preview.",
		);
	if (impact.blockers.length || impact.employmentBlockers.length)
		throw new TrackingDateRefusal(
			"blocked",
			impact.employmentBlockers[0]?.message ??
				"Reopen affected closed months before saving.",
		);
	return impact;
}
/** Caller owns the reviewed configuration/employee guards. Bulk callers validate every plan before any write. */
export async function applyReviewedEmploymentDateCorrection(
	client: AbsenceDaysDatabase,
	input: EmploymentDateCorrectionScope & {
		reviewedImpact: EmploymentDateCorrectionImpact;
		reason: string;
	},
	audit: AuditTrail,
) {
	await assertTrackingDateAdministrator(client, input);
	const impact = input.reviewedImpact;
	if (impact.employmentBlockers.length || impact.blockers.length)
		throw new TrackingDateRefusal(
			"blocked",
			"Resolve the reviewed blockers before saving.",
		);
	const timestamp = dateFromInstant(input.now);
	await client
		.update(employee)
		.set({
			startDate: dateFromInstant(
				parsePlainDate(impact.employmentStartDate)
					.toZonedDateTime("UTC")
					.toInstant(),
			),
			updatedAt: timestamp,
		})
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, impact.employeeId),
			),
		);
	await client.execute(
		sql`select employee_employment_period_backfill_legacy(${input.organizationId}, ${impact.employeeId}::uuid)`,
	);
	if (impact.employmentPeriodId) {
		const [period] = await client
			.select()
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, input.organizationId),
					eq(employeeEmploymentPeriod.employeeId, impact.employeeId),
					eq(employeeEmploymentPeriod.id, impact.employmentPeriodId),
				),
			);
		const [org] = await client
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, input.organizationId));
		await client
			.update(employeeEmploymentPeriod)
			.set({
				startedAt: dateFromInstant(
					parsePlainDate(impact.employmentStartDate)
						.toZonedDateTime(
							period?.startProvenance === "recorded"
								? (org?.timezone ?? "UTC")
								: "UTC",
						)
						.toInstant(),
				),
				startProvenance:
					period?.startProvenance === "unknown"
						? "legacy"
						: (period?.startProvenance ?? "legacy"),
			})
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, input.organizationId),
					eq(employeeEmploymentPeriod.id, impact.employmentPeriodId),
					eq(employeeEmploymentPeriod.employeeId, impact.employeeId),
				),
			);
	}
	const [refreshOrg] = await client
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, input.organizationId));
	const refresh = await planEmploymentVacationRefresh(client, {
		...input,
		employeeId: impact.employeeId,
		employmentStartDate: impact.employmentStartDate,
		timezone: refreshOrg?.timezone ?? "UTC",
	});
	await applyEmploymentVacationRefresh(client, {
		organizationId: input.organizationId,
		employeeId: impact.employeeId,
		plan: refresh,
		actorUserId: input.actorUserId,
		now: input.now,
		audit,
	});
	await audit.record(client, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		targetType: "employee",
		targetId: impact.employeeId,
		employeeId: impact.employeeId,
		action: AuditAction.EMPLOYEE_EMPLOYMENT_START_CORRECTED,
		changes: {
			from: { employmentStartDate: impact.previousEmploymentStartDate },
			to: { employmentStartDate: impact.employmentStartDate },
		},
		metadata: {
			reason: input.reason,
			fingerprint: impact.fingerprint,
			employmentPeriodId: impact.employmentPeriodId,
		},
	});
}
export async function commitEmploymentDateCorrection(
	database: WorkBalanceDatabase,
	input: EmploymentDateCorrectionScope &
		EmploymentDateCorrectionProposal & { fingerprint: string; reason: string },
) {
	const proposal = parseEmploymentDateCorrection(input);
	const reason = typeof input.reason === "string" ? input.reason.trim() : "";
	if (
		!reason ||
		reason.length > 1000 ||
		!/^[a-f0-9]{64}$/.test(input.fingerprint)
	)
		throw new TrackingDateRefusal(
			"invalid_input",
			"Review the correction and enter a reason of at most 1,000 characters.",
		);
	return commitReviewedTrackingChange(database, {
		...input,
		plan: (client) =>
			validateEmploymentDateCorrectionReview(client, { ...input, ...proposal }),
		write: async (client, reviewed, audit) => {
			await applyReviewedEmploymentDateCorrection(
				client,
				{ ...input, reviewedImpact: reviewed, reason },
				audit,
			);
		},
	});
}
