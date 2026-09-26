import "server-only";

import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { Effect } from "effect";
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
import type { ServerActionResult } from "@/lib/effect/result";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
	type EditCapability,
} from "@/lib/effect/services/change-policy.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	getMonthRangeInTimezone,
	getTodayRangeInTimezone,
	getWeekRangeInTimezone,
} from "@/lib/time-tracking/timezone-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import type { WorkPeriodWithEntries } from "../types";
import { getCurrentEmployee, getCurrentSession, getUserTimezone } from "./auth";
import { getAssignedProjectsWithHours } from "./entry-helpers";
import { logger } from "./shared";
import type { AssignedProject } from "./types";

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

export async function getTimeClockStatus(): Promise<{
	hasEmployee: boolean;
	employeeId: string | null;
	isClockedIn: boolean;
	activeWorkPeriod: { id: string; startTime: Date } | null;
}> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return {
			hasEmployee: false,
			employeeId: null,
			isClockedIn: false,
			activeWorkPeriod: null,
		};
	}

	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return {
			hasEmployee: false,
			employeeId: null,
			isClockedIn: false,
			activeWorkPeriod: null,
		};
	}

	const activeWorkPeriod = await db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.employeeId, currentEmployee.id),
			eq(workPeriod.organizationId, currentEmployee.organizationId),
			isNull(workPeriod.endTime),
		),
	});

	return {
		hasEmployee: true,
		employeeId: currentEmployee.id,
		isClockedIn: !!activeWorkPeriod,
		activeWorkPeriod: activeWorkPeriod
			? { id: activeWorkPeriod.id, startTime: activeWorkPeriod.startTime }
			: null,
	};
}

export async function getActiveWorkPeriod(
	employeeId: string,
): Promise<WorkPeriodWithEntries | null> {
	const activeWorkPeriod = await db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.employeeId, employeeId),
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

export async function getWorkPeriods(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkPeriodWithEntries[]> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return [];
	}
	const workPeriods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			eq(workPeriod.organizationId, currentEmployee.organizationId),
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
				eq(approvalRequest.organizationId, currentEmployee.organizationId),
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
				eq(approvalWorkflow.organizationId, currentEmployee.organizationId),
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

export async function getTimeSummary(
	employeeId: string,
	timezone: string = "UTC",
	weekStartDay: WeekStartDay = "sunday",
): Promise<TimeSummary> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return { todayMinutes: 0, weekMinutes: 0, monthMinutes: 0 };
	}
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
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.organizationId, currentEmployee.organizationId),
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

export async function getAssignedProjects(): Promise<
	ServerActionResult<AssignedProject[]>
> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const { projectsById, hoursByProjectId } =
			await getAssignedProjectsWithHours(
				currentEmployee.id,
				currentEmployee.organizationId,
				currentEmployee.teamId,
			);

		const projects = Array.from(projectsById.values())
			.map((project) => ({
				id: project.id,
				name: project.name,
				color: project.color,
				status: project.status,
				budgetHours: project.budgetHours ? Number(project.budgetHours) : null,
				deadline: project.deadline?.toISOString() ?? null,
				totalHoursBooked: hoursByProjectId.get(project.id) ?? 0,
			}))
			.sort((left, right) => left.name.localeCompare(right.name));

		return { success: true, data: projects };
	} catch (error) {
		logger.error({ error }, "Failed to get assigned projects");
		return { success: false, error: "Failed to load projects" };
	}
}

export async function getWorkPeriodEditCapability(
	workPeriodId: string,
): Promise<
	ServerActionResult<{
		capability: EditCapability;
		policyName: string | null;
	}>
> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const [timezone, [selectedWorkPeriod]] = await Promise.all([
		getUserTimezone(session.user.id),
		db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1),
	]);

	if (!selectedWorkPeriod) {
		return { success: false, error: "Work period not found" };
	}

	if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
		return {
			success: false,
			error: "You can only check your own work periods",
		};
	}

	if (!selectedWorkPeriod.endTime) {
		return {
			success: true,
			data: {
				capability: {
					type: "forbidden",
					reason: "beyond_approval_window",
					daysBack: 0,
				},
				policyName: null,
			},
		};
	}

	try {
		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const policyService = yield* _(ChangePolicyService);
				const policy = yield* _(
					policyService.resolvePolicy(currentEmployee.id),
				);
				const capability = yield* _(
					policyService.getEditCapability({
						employeeId: currentEmployee.id,
						workPeriodEndTime: selectedWorkPeriod.endTime!,
						timezone,
					}),
				);

				return {
					capability,
					policyName: policy?.policyName || null,
				};
			}).pipe(
				Effect.provide(ChangePolicyServiceLive),
				Effect.provide(DatabaseServiceLive),
			),
		);

		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to get edit capability");
		return { success: false, error: "Failed to check edit permissions" };
	}
}
