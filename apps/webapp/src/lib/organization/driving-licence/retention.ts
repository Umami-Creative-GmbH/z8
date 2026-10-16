import "server-only";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceCheck,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingImpedimentReport } from "@/db/schema/driving-licence-impediments";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import {
	drivingLicenceCleanupRun,
	drivingLicenceHold,
	drivingLicenceRetention,
} from "@/db/schema/driving-licence-retention";
import { employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { employee } from "@/db/schema/organization";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
import { beginDrivingLicenceRetentionChange } from "./retention-state";
import type { DrivingLicenceTransaction } from "./verifiers";

async function assertAdministrator(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
) {
	const [membership] = await tx
		.select()
		.from(member)
		.where(
			and(
				eq(member.organizationId, actor.organizationId),
				eq(member.userId, actor.userId),
				eq(member.status, "approved"),
			),
		)
		.for("share");
	const [profile] = await tx
		.select({
			hasAccess: employeeHasOrganizationAccess(systemClock.nowInstant()),
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(employee.userId, actor.userId),
			),
		);
	if (profile && !profile.hasAccess) throw new Error("forbidden");
	if (
		!membership ||
		!(
			hasOrganizationRole(membership.role, "admin") ||
			hasOrganizationRole(membership.role, "owner")
		)
	)
		throw new Error("forbidden");
}
async function list(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
) {
	const protectedIds = await beginDrivingLicenceRetentionChange(
		tx,
		organizationId,
		now,
	);
	const [policy] = await tx
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	const records = await tx
		.select({
			checkId: drivingLicenceCheck.id,
			employmentPeriodId: drivingLicenceCheck.employmentPeriodId,
			employeeId: drivingLicenceCheck.employeeId,
			employeeName: user.name,
			controlledAt: drivingLicenceCheck.controlledAt,
			retentionStartedAt: drivingLicenceRetention.retentionStartedAt,
		})
		.from(drivingLicenceCheck)
		.innerJoin(
			employee,
			and(
				eq(employee.id, drivingLicenceCheck.employeeId),
				eq(employee.organizationId, drivingLicenceCheck.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.innerJoin(
			drivingLicenceRetention,
			and(
				eq(
					drivingLicenceRetention.organizationId,
					drivingLicenceCheck.organizationId,
				),
				eq(drivingLicenceRetention.checkId, drivingLicenceCheck.id),
			),
		)
		.where(eq(drivingLicenceCheck.organizationId, organizationId))
		.orderBy(desc(drivingLicenceCheck.controlledAt));
	const holds = await tx
		.select()
		.from(drivingLicenceHold)
		.where(eq(drivingLicenceHold.organizationId, organizationId));
	const metadata = records.map((r) => {
		const deleteAfter =
			r.retentionStartedAt && policy?.retentionMonths
				? instantFromDate(r.retentionStartedAt)
						.toZonedDateTimeISO(policy.timezone)
						.add({ months: policy.retentionMonths })
						.toInstant()
				: null;
		const recordHolds = holds.filter((h) => h.checkId === r.checkId);
		return {
			checkId: r.checkId,
			employmentPeriodId: r.employmentPeriodId,
			employeeId: r.employeeId,
			employeeName: r.employeeName,
			controlledAt: r.controlledAt.toISOString(),
			retentionStartedAt: r.retentionStartedAt?.toISOString() ?? null,
			deleteAfter:
				deleteAfter?.toString({ smallestUnit: "millisecond" }) ?? null,
			protected: protectedIds.has(r.checkId),
			due:
				!!deleteAfter && deleteAfter.epochNanoseconds <= now.epochNanoseconds,
			holds: recordHolds.map((h) => ({
				...h,
				placedAt: h.placedAt.toISOString(),
				releasedAt: h.releasedAt?.toISOString() ?? null,
			})),
		};
	});
	// A case preserving report context must preserve the check and event that establish its resolution too.
	const reports = await tx
		.select({
			resolutionCheckId: drivingImpedimentReport.resolutionCheckId,
			employeeId: drivingImpedimentReport.employeeId,
			employmentPeriodId: drivingImpedimentReport.employmentPeriodId,
		})
		.from(drivingImpedimentReport)
		.where(eq(drivingImpedimentReport.organizationId, organizationId));
	return metadata.map((record) => {
		const contexts = reports.filter(
			(report) => report.resolutionCheckId === record.checkId,
		);
		const contextRecords = metadata.filter((source) =>
			contexts.some(
				(report) =>
					source.employeeId === report.employeeId &&
					source.employmentPeriodId === report.employmentPeriodId,
			),
		);
		const contextHolds = contextRecords
			.flatMap((source) => source.holds)
			.filter((hold) => !hold.releasedAt);
		return {
			...record,
			holds: [
				...new Map(
					[...record.holds, ...contextHolds].map((hold) => [hold.id, hold]),
				).values(),
			],
		};
	});
}
/** Report proof shares its period's case context, but current unresolved causes remain operational. */
async function listReports(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
	records: Awaited<ReturnType<typeof list>>,
) {
	const [policy] = await tx
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	const reports = await tx
		.select({
			report: drivingImpedimentReport,
			employeeName: user.name,
			endedAt: employeeEmploymentPeriod.endedAt,
		})
		.from(drivingImpedimentReport)
		.innerJoin(
			employee,
			and(
				eq(employee.id, drivingImpedimentReport.employeeId),
				eq(employee.organizationId, organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			employeeEmploymentPeriod,
			and(
				eq(
					employeeEmploymentPeriod.id,
					drivingImpedimentReport.employmentPeriodId,
				),
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				eq(
					employeeEmploymentPeriod.employeeId,
					drivingImpedimentReport.employeeId,
				),
			),
		)
		.where(eq(drivingImpedimentReport.organizationId, organizationId));
	const checks = await tx
		.select({
			id: drivingLicenceCheck.id,
			employeeId: drivingLicenceCheck.employeeId,
			employmentPeriodId: drivingLicenceCheck.employmentPeriodId,
		})
		.from(drivingLicenceCheck)
		.where(eq(drivingLicenceCheck.organizationId, organizationId));
	const departures = await tx.execute<{
		employee_id: string;
		employment_period_id: string | null;
		cutoff_at: Date | string;
	}>(
		sql`SELECT employee_id, employment_period_id, cutoff_at FROM employee_departure d WHERE d.organization_id=${organizationId} AND d.cutoff_at<=${dateFromInstant(now)} AND (d.status='effective' OR (d.status='pending' AND employee_departure_denies_access(d.organization_id,d.employee_id,${dateFromInstant(now)})))`,
	);
	const result = [];
	const recordById = new Map(records.map((record) => [record.checkId, record]));
	for (const { report, employeeName, endedAt } of reports) {
		const periodEnd = [
			...(endedAt ? [instantFromDate(endedAt)] : []),
			...departures.rows
				.filter(
					(d) =>
						d.employee_id === report.employeeId &&
						(d.employment_period_id === report.employmentPeriodId ||
							(report.employmentPeriodId === null &&
								instantFromDate(new Date(d.cutoff_at)).epochNanoseconds >=
									instantFromDate(report.reportedAt).epochNanoseconds)),
				)
				.map((d) => instantFromDate(new Date(d.cutoff_at))),
		]
			.filter((at) => at.epochNanoseconds <= now.epochNanoseconds)
			.reduce<Instant | null>(
				(a, b) => (!a || b.epochNanoseconds < a.epochNanoseconds ? b : a),
				null,
			);
		const resolution = report.resolutionCheckId
			? recordById.get(report.resolutionCheckId)
			: undefined;
		const resolutionStart = resolution?.retentionStartedAt
			? parseInstant(resolution.retentionStartedAt)
			: null;
		const resolved = report.resolvedAt
			? instantFromDate(report.resolvedAt)
			: null;
		// A resolved report still explains its resolution check while that proof supports permission.
		const resolvedStart =
			resolved && !resolution?.protected
				? resolutionStart &&
					resolutionStart.epochNanoseconds > resolved.epochNanoseconds
					? resolutionStart
					: report.retentionStartedAt
						? instantFromDate(report.retentionStartedAt)
						: resolved
				: null;
		const start =
			periodEnd &&
			(!resolvedStart ||
				periodEnd.epochNanoseconds < resolvedStart.epochNanoseconds)
				? periodEnd
				: resolvedStart;
		const saved = report.retentionStartedAt
			? instantFromDate(report.retentionStartedAt)
			: null;
		if (saved?.epochNanoseconds !== start?.epochNanoseconds)
			await tx
				.update(drivingImpedimentReport)
				.set({ retentionStartedAt: start ? dateFromInstant(start) : null })
				.where(
					and(
						eq(drivingImpedimentReport.organizationId, organizationId),
						eq(drivingImpedimentReport.id, report.id),
					),
				);
		const deleteAfter =
			start && policy?.retentionMonths
				? start
						.toZonedDateTimeISO(policy.timezone)
						.add({ months: policy.retentionMonths })
						.toInstant()
				: null;
		const relatedIds = new Set(
			checks
				.filter(
					(c) =>
						c.employeeId === report.employeeId &&
						c.employmentPeriodId === report.employmentPeriodId,
				)
				.map((c) => c.id),
		);
		const holds = records
			.filter((r) => relatedIds.has(r.checkId))
			.flatMap((r) => r.holds)
			.filter((h) => !h.releasedAt);
		result.push({
			reportId: report.id,
			employeeId: report.employeeId,
			employeeName,
			reportedAt: report.reportedAt.toISOString(),
			retentionStartedAt:
				start?.toString({ smallestUnit: "millisecond" }) ?? null,
			deleteAfter:
				deleteAfter?.toString({ smallestUnit: "millisecond" }) ?? null,
			protected: !start,
			due:
				!!deleteAfter && deleteAfter.epochNanoseconds <= now.epochNanoseconds,
			holds,
		});
	}
	return result;
}
export async function readDrivingLicenceRetention(actor: DrivingLicenceActor) {
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await assertAdministrator(tx, actor);
		const records = await list(
			tx,
			actor.organizationId,
			systemClock.nowInstant(),
		);
		const reports = await listReports(
			tx,
			actor.organizationId,
			systemClock.nowInstant(),
			records,
		);
		const runs = await tx
			.select()
			.from(drivingLicenceCleanupRun)
			.where(eq(drivingLicenceCleanupRun.organizationId, actor.organizationId))
			.orderBy(desc(drivingLicenceCleanupRun.completedAt))
			.limit(10);
		return {
			organizationId: actor.organizationId,
			records,
			reports,
			runs: runs.map((r) => ({
				...r,
				completedAt: r.completedAt.toISOString(),
			})),
		};
	});
}
const placeInput = z.strictObject({
	checkId: z.uuid(),
	caseReference: z.string().trim().min(3).max(100),
	preservationReason: z.string().trim().min(10).max(400),
});
export async function placeDrivingLicenceHold(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = placeInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await assertAdministrator(tx, actor);
		const [record] = await tx
			.select({ id: drivingLicenceCheck.id })
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, actor.organizationId),
					eq(drivingLicenceCheck.id, input.checkId),
				),
			);
		if (!record) throw new Error("unavailable");
		const now = systemClock.nowInstant();
		const [existing] = await tx
			.select()
			.from(drivingLicenceHold)
			.where(
				and(
					eq(drivingLicenceHold.organizationId, actor.organizationId),
					eq(drivingLicenceHold.checkId, input.checkId),
					eq(drivingLicenceHold.caseReference, input.caseReference),
					isNull(drivingLicenceHold.releasedAt),
				),
			);
		if (existing) return { holdId: existing.id };
		const [hold] = await tx
			.insert(drivingLicenceHold)
			.values({
				organizationId: actor.organizationId,
				...input,
				placedAt: dateFromInstant(now),
				placedBy: actor.userId,
			})
			.returning();
		return { holdId: hold.id };
	});
}
export async function releaseDrivingLicenceHold(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = z
		.strictObject({
			holdId: z.uuid(),
			releaseReason: z.string().trim().min(10).max(400),
		})
		.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await assertAdministrator(tx, actor);
		const [hold] = await tx
			.select()
			.from(drivingLicenceHold)
			.where(
				and(
					eq(drivingLicenceHold.organizationId, actor.organizationId),
					eq(drivingLicenceHold.id, input.holdId),
				),
			);
		if (!hold) throw new Error("unavailable");
		if (!hold.releasedAt)
			await tx
				.update(drivingLicenceHold)
				.set({
					releasedAt: dateFromInstant(systemClock.nowInstant()),
					releasedBy: actor.userId,
					releaseReason: input.releaseReason,
				})
				.where(
					and(
						eq(drivingLicenceHold.organizationId, actor.organizationId),
						eq(drivingLicenceHold.id, hold.id),
					),
				);
		return { holdId: hold.id };
	});
}
export async function cleanupDrivingLicenceEvidence(
	organizationId: string,
	actor?: DrivingLicenceActor,
) {
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, organizationId);
		if (actor) {
			if (actor.organizationId !== organizationId) throw new Error("forbidden");
			await assertAdministrator(tx, actor);
		}
		const now = systemClock.nowInstant();
		await materializeExpiredDrivingAuthorizations(tx, organizationId, now);
		const records = await list(tx, organizationId, now);
		const reports = await listReports(tx, organizationId, now, records);
		let deletedCount = 0;
		for (const report of reports) {
			if (report.protected || !report.due || report.holds.length) continue;
			await tx
				.delete(drivingAuthorizationEvent)
				.where(
					and(
						eq(drivingAuthorizationEvent.organizationId, organizationId),
						eq(drivingAuthorizationEvent.employeeId, report.employeeId),
						or(
							eq(drivingAuthorizationEvent.id, report.reportId),
							eq(
								drivingAuthorizationEvent.reason,
								`reported_impediment:${report.reportId}`,
							),
						),
					),
				);
			await tx
				.delete(drivingImpedimentReport)
				.where(
					and(
						eq(drivingImpedimentReport.organizationId, organizationId),
						eq(drivingImpedimentReport.id, report.reportId),
					),
				);
			deletedCount++;
		}
		for (const record of records) {
			if (
				record.protected ||
				!record.due ||
				record.holds.some((h) => !h.releasedAt)
			)
				continue;
			// Keep the operational suspension; deleting its old proof must not make a later check an initial grant.
			await tx
				.update(drivingAuthorization)
				.set({
					supportingCheckId: null,
					state: sql`CASE WHEN ${drivingAuthorization.state}='active' THEN 'ended' ELSE ${drivingAuthorization.state} END`,
					lastSuccessfulAt: null,
					restrictions: "",
				})
				.where(
					and(
						eq(drivingAuthorization.organizationId, organizationId),
						eq(drivingAuthorization.supportingCheckId, record.checkId),
					),
				);
			await tx
				.update(drivingLicenceSubject)
				.set({ sourceCheckId: null })
				.where(
					and(
						eq(drivingLicenceSubject.organizationId, organizationId),
						eq(drivingLicenceSubject.sourceCheckId, record.checkId),
					),
				);
			await tx
				.delete(drivingLicenceCheck)
				.where(
					and(
						eq(drivingLicenceCheck.organizationId, organizationId),
						eq(drivingLicenceCheck.id, record.checkId),
					),
				);
			deletedCount++;
		}
		const result = {
			deletedCount,
			heldCount:
				records.filter((r) => r.holds.some((h) => !h.releasedAt)).length +
				reports.filter((r) => r.holds.length > 0).length,
			protectedCount:
				records.filter((r) => r.protected).length +
				reports.filter((r) => r.protected).length,
		};
		await tx.insert(drivingLicenceCleanupRun).values({
			organizationId,
			completedAt: dateFromInstant(now),
			actorUserId: actor?.userId ?? null,
			...result,
		});
		return result;
	});
}
export type DrivingLicenceRetentionData = Awaited<
	ReturnType<typeof readDrivingLicenceRetention>
>;
