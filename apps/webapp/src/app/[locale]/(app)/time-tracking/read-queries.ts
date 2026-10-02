import "server-only";

import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
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
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import {
	getMonthRangeInTimezone,
	getTodayRangeInTimezone,
	getWeekRangeInTimezone,
} from "@/lib/time-tracking/timezone-utils";
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

export async function readTimeSummary(
	scope: EmployeeReadScope,
	timezone: string,
	weekStartDay: WeekStartDay,
): Promise<TimeSummary> {
	const { start: todayStartDateTime, end: todayEndDateTime } =
		getTodayRangeInTimezone(timezone);
	const { start: weekStartDateTime, end: weekEndDateTime } =
		getWeekRangeInTimezone(new Date(), timezone, weekStartDay);
	const { start: monthStartDateTime, end: monthEndDateTime } =
		getMonthRangeInTimezone(new Date(), timezone);

	const todayStart = dateToDB(todayStartDateTime)!;
	const todayEnd = dateToDB(todayEndDateTime)!;
	const weekStart = dateToDB(weekStartDateTime)!;
	const weekEnd = dateToDB(weekEndDateTime)!;
	const monthStart = dateToDB(monthStartDateTime)!;
	const monthEnd = dateToDB(monthEndDateTime)!;

	const periodsWithSurcharges = await db
		.select({
			startTime: workPeriod.startTime,
			durationMinutes: workPeriod.durationMinutes,
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
				gte(workPeriod.startTime, monthStart),
				lte(workPeriod.startTime, monthEnd),
			),
		);

	let todayMinutes = 0;
	let weekMinutes = 0;
	let monthMinutes = 0;
	let todaySurchargeMinutes = 0;
	let weekSurchargeMinutes = 0;
	let monthSurchargeMinutes = 0;

	for (const period of periodsWithSurcharges) {
		const durationMinutes = period.durationMinutes || 0;
		const surchargeMinutes = period.surchargeMinutes || 0;
		const { startTime } = period;

		monthMinutes += durationMinutes;
		monthSurchargeMinutes += surchargeMinutes;

		if (startTime >= todayStart && startTime <= todayEnd) {
			todayMinutes += durationMinutes;
			todaySurchargeMinutes += surchargeMinutes;
		}

		if (startTime >= weekStart && startTime <= weekEnd) {
			weekMinutes += durationMinutes;
			weekSurchargeMinutes += surchargeMinutes;
		}
	}

	return {
		todayMinutes,
		weekMinutes,
		monthMinutes,
		...(monthSurchargeMinutes > 0 && {
			todaySurchargeMinutes,
			weekSurchargeMinutes,
			monthSurchargeMinutes,
		}),
	};
}
