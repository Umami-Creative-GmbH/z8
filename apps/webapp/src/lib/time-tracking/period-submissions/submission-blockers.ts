import { and, asc, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { absenceEntry, approvalRequest, approvalWorkflow, workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { closedRangeTouchedByWork } from "@/lib/time-tracking/closed-months/rules";
import type { PeriodSubmissionDatabase } from "./submission-store";

/**
 * What keeps a period open for submitting (#1060): live work that started in the period and is
 * still running, and undecided requests touching the period. "Touching" is the closed-month rule
 * (Time Tracking ADR-0004): work whose interval overlaps the period's fixed instants even in part,
 * an absence whose local days overlap the period's days even in part. Requests are read in both
 * lifecycles, as a month close reads them: the legacy `approval_status`/`approval_request` and the
 * canonical `approval_workflow`.
 *
 * Plain data; crosses to the client in a refusal.
 */
export type PeriodSubmissionBlocker =
	| {
			kind: "live_work" | "time_correction" | "manual_work";
			workPeriodId: string;
			/** ISO instants of the work period's current interval. */
			startTime: string;
			endTime: string | null;
			/** The period's zone, to show the times in. */
			timezone: string;
	  }
	| { kind: "absence_request"; absenceId: string; startDate: string; endDate: string };

export interface SubmissionPeriodBounds {
	organizationId: string;
	employeeId: string;
	timezone: string;
	/** Inclusive local dates of the (clipped) period. */
	startDate: string;
	endDate: string;
	/** The period's fixed `[start, end)` instants. */
	range: { start: Instant; end: Instant };
}

/** How a work period's undecided request reads; null when nothing about it is undecided. */
export function classifyUndecidedWork(work: {
	approvalStatus: string;
	pendingWorkflowType: string | null;
	hasPendingLegacyRequest: boolean;
}): "time_correction" | "manual_work" | null {
	if (work.pendingWorkflowType) {
		return work.pendingWorkflowType === "time_correction" ? "time_correction" : "manual_work";
	}
	// Legacy: manual work waits with the period itself pending; a correction request is raised on
	// work that already counts.
	if (work.approvalStatus === "pending") return "manual_work";
	if (work.hasPendingLegacyRequest) return "time_correction";
	return null;
}

/**
 * The blockers of one employee's period, ordered by time (work by start, then absences by first
 * day). Run it in the submitting transaction, after the employee's period-submission lock.
 */
export async function findPeriodSubmissionBlockers(
	database: PeriodSubmissionDatabase,
	period: SubmissionPeriodBounds,
): Promise<PeriodSubmissionBlocker[]> {
	const start = dateFromInstant(period.range.start);
	const end = dateFromInstant(period.range.end);
	const work = await database
		.select({
			id: workPeriod.id,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			approvalStatus: workPeriod.approvalStatus,
			pendingWorkflowType: sql<string | null>`(
				select ${approvalWorkflow.workflowType}::text from ${approvalWorkflow}
				where ${approvalWorkflow.organizationId} = "work_period"."organization_id"
					and ${approvalWorkflow.sourceType} = 'time_entry'
					and ${approvalWorkflow.sourceId} = "work_period"."id"
					and ${approvalWorkflow.status} = 'pending'
				order by ${approvalWorkflow.createdAt} desc
				limit 1
			)`,
			hasPendingLegacyRequest: sql<boolean>`exists (
				select 1 from ${approvalRequest}
				where ${approvalRequest.organizationId} = "work_period"."organization_id"
					and ${approvalRequest.entityId} = "work_period"."id"
					and ${approvalRequest.status} = 'pending'
			)`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, period.organizationId),
				eq(workPeriod.employeeId, period.employeeId),
				isNull(workPeriod.deletedAt),
				lt(workPeriod.startTime, end),
				or(isNull(workPeriod.endTime), gt(workPeriod.endTime, start)),
			),
		)
		.orderBy(asc(workPeriod.startTime), asc(workPeriod.id));

	const blockers: PeriodSubmissionBlocker[] = [];
	const touchRange = [
		{ month: period.startDate, start: period.range.start, endExclusive: period.range.end },
	];
	for (const row of work) {
		const base = {
			workPeriodId: row.id,
			startTime: row.startTime.toISOString(),
			endTime: row.endTime ? row.endTime.toISOString() : null,
			timezone: period.timezone,
		};
		if (row.endTime === null) {
			// Only live work that started in the period holds it open.
			if (row.startTime.getTime() >= start.getTime()) blockers.push({ kind: "live_work", ...base });
			continue;
		}
		const touched = closedRangeTouchedByWork(
			[{ start: instantFromDate(row.startTime), end: instantFromDate(row.endTime) }],
			touchRange,
		);
		if (!touched) continue;
		const kind = classifyUndecidedWork({
			approvalStatus: row.approvalStatus,
			pendingWorkflowType: row.pendingWorkflowType,
			hasPendingLegacyRequest: row.hasPendingLegacyRequest,
		});
		if (kind) blockers.push({ kind, ...base });
	}

	const absences = await database
		.select({
			id: absenceEntry.id,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
		})
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.organizationId, period.organizationId),
				eq(absenceEntry.employeeId, period.employeeId),
				eq(absenceEntry.status, "pending"),
				lte(absenceEntry.startDate, period.endDate),
				gte(absenceEntry.endDate, period.startDate),
			),
		)
		.orderBy(asc(absenceEntry.startDate), asc(absenceEntry.id));
	for (const absence of absences) {
		blockers.push({
			kind: "absence_request",
			absenceId: absence.id,
			startDate: absence.startDate,
			endDate: absence.endDate,
		});
	}
	return blockers;
}
