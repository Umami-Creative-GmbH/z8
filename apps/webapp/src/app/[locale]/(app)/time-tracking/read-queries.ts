import "server-only";

import { and, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	surchargeCalculation,
	workPeriod,
} from "@/db/schema";
import { parseOrdinaryWorkPeriodWorkflowPayload } from "@/lib/approvals/domain-adapters/work-period-contract";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	type Clock,
	dateFromInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	buildDayTotalBasis,
	dayTotalRange,
	summarizeDayTotals,
} from "@/lib/time-tracking/day-totals";
import type { TimeSummary } from "@/lib/time-tracking/types";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import type { WorkPeriodWithEntries } from "./types";

/** Internal scope from approved render context or fresh action authorization. It does not authorize callers. */
export type EmployeeReadScope = Readonly<{
	employeeId: string;
	organizationId: string;
}>;
function mapWorkPeriodWithEntries(
	period: typeof workPeriod.$inferSelect & {
		clockIn: WorkPeriodWithEntries["clockIn"];
		clockOut: WorkPeriodWithEntries["clockOut"] | null;
		approvalRequestId?: string | null;
	},
): WorkPeriodWithEntries {
	return {
		...period,
		clockIn: period.clockIn,
		clockOut: period.clockOut || undefined,
		approvalRequestId: period.approvalRequestId ?? null,
	};
}

export async function readActiveWorkPeriod(
	scope: EmployeeReadScope,
): Promise<WorkPeriodWithEntries | null> {
	const activeWorkPeriod = await db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.employeeId, scope.employeeId),
			eq(workPeriod.organizationId, scope.organizationId),
			isNull(workPeriod.endTime),
		),
		with: {
			clockIn: true,
			clockOut: true,
		},
	});

	return activeWorkPeriod
		? mapWorkPeriodWithEntries(
				activeWorkPeriod as unknown as Parameters<
					typeof mapWorkPeriodWithEntries
				>[0],
			)
		: null;
}

export async function readWorkPeriods(
	scope: EmployeeReadScope,
	startDate: Date,
	endDate: Date,
): Promise<WorkPeriodWithEntries[]> {
	const workPeriods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, scope.employeeId),
			eq(workPeriod.organizationId, scope.organizationId),
			isNull(workPeriod.deletedAt),
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
		),
		with: {
			clockIn: true,
			clockOut: true,
		},
		orderBy: [workPeriod.startTime],
	});

	const pendingPeriodIds = workPeriods.reduce<string[]>((ids, period) => {
		if (period.approvalStatus === "pending") ids.push(period.id);
		return ids;
	}, []);
	const stableTargetByPeriodId = new Map<string, string>();
	if (pendingPeriodIds.length > 0) {
		const requests = await db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, scope.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				inArray(approvalRequest.entityId, pendingPeriodIds),
				eq(approvalRequest.status, "pending"),
			),
			columns: { id: true, entityId: true, metadata: true },
		});
		for (const request of requests) {
			try {
				parseOrdinaryWorkPeriodWorkflowPayload(request.metadata);
				if (!stableTargetByPeriodId.has(request.entityId)) {
					stableTargetByPeriodId.set(request.entityId, request.id);
				}
			} catch {
				// A time-correction request is not an ordinary work-period target.
			}
		}

		const workflows = await db.query.approvalWorkflow.findMany({
			where: and(
				eq(approvalWorkflow.organizationId, scope.organizationId),
				eq(approvalWorkflow.sourceType, "time_entry"),
				inArray(approvalWorkflow.sourceId, pendingPeriodIds),
				inArray(approvalWorkflow.workflowType, [
					"manual_time_submission",
					"policy_clock_out",
				]),
				eq(approvalWorkflow.status, "pending"),
			),
			columns: { id: true, sourceId: true, currentStageOrder: true },
			with: {
				stages: {
					where: eq(approvalWorkflowStage.status, "pending"),
					columns: { id: true, sequence: true },
					with: {
						assignments: {
							where: eq(approvalStageAssignment.status, "pending"),
							columns: { id: true },
							orderBy: [approvalStageAssignment.sequence],
							limit: 1,
						},
					},
				},
			},
		});
		for (const workflow of workflows) {
			if (stableTargetByPeriodId.has(workflow.sourceId)) continue;
			const stage = workflow.stages.find(
				(candidate) => candidate.sequence === workflow.currentStageOrder,
			);
			const assignment = stage?.assignments[0];
			if (assignment)
				stableTargetByPeriodId.set(workflow.sourceId, assignment.id);
		}
	}

	return (
		workPeriods as unknown as Parameters<typeof mapWorkPeriodWithEntries>[0][]
	)
		.reverse()
		.map((period) =>
			mapWorkPeriodWithEntries({
				...period,
				approvalRequestId: stableTargetByPeriodId.get(period.id) ?? null,
			}),
		);
}

/**
 * Day totals for today, this week and this month in the employee's timezone,
 * live work included, matching the calendar's day totals.
 */
export async function readTimeSummary(
	scope: EmployeeReadScope,
	timezone: string,
	weekStartDay: WeekStartDay,
	clock: Clock = systemClock,
): Promise<TimeSummary> {
	const now = clock.nowInstant();
	const range = dayTotalRange(now, timezone, weekStartDay);

	// Like the calendar: completed work overlapping the range, and running live work.
	const periods = await db
		.select({
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			surchargeMinutes: surchargeCalculation.surchargeMinutes,
		})
		.from(workPeriod)
		.leftJoin(
			surchargeCalculation,
			eq(surchargeCalculation.workPeriodId, workPeriod.id),
		)
		.where(
			and(
				eq(workPeriod.employeeId, scope.employeeId),
				eq(workPeriod.organizationId, scope.organizationId),
				isNull(workPeriod.deletedAt),
				lt(workPeriod.startTime, range.endExclusive),
				or(
					gt(workPeriod.endTime, range.start),
					and(isNull(workPeriod.endTime), eq(workPeriod.isActive, true)),
				),
			),
		);

	const dayTotals = buildDayTotalBasis({ periods, timezone, weekStartDay });
	return { ...summarizeDayTotals(dayTotals, now), dayTotals };
}

/**
 * The compliance check's day: completed minutes of the work periods that
 * started today, each counted whole. Unlike a day total it leaves out live work.
 */
export async function readComplianceDayCompletedMinutes(
	scope: EmployeeReadScope,
	timezone: string,
	clock: Clock = systemClock,
): Promise<number> {
	const today = clock.nowInstant().toZonedDateTimeISO(timezone).toPlainDate();
	const day = localDayRange(today.toString(), timezone);
	const periods = await db
		.select({ durationMinutes: workPeriod.durationMinutes })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, scope.employeeId),
				eq(workPeriod.organizationId, scope.organizationId),
				isNull(workPeriod.deletedAt),
				gte(workPeriod.startTime, dateFromInstant(day.start)),
				lt(workPeriod.startTime, dateFromInstant(day.endExclusive)),
			),
		);

	return periods.reduce(
		(minutes, period) => minutes + (period.durationMinutes ?? 0),
		0,
	);
}
