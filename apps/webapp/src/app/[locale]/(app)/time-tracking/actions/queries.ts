import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import type { ServerActionResult } from "@/lib/effect/result";
import { runtime } from "@/lib/effect/runtime";
import {
	ChangePolicyService,
	type EditCapability,
} from "@/lib/effect/services/change-policy.service";
import { systemClock } from "@/lib/datetime/temporal-core";
import { readComplianceTotals } from "@/lib/time-tracking/compliance-totals";
import type { TimeSummary } from "@/lib/time-tracking/types";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import {
	readActiveWorkPeriod,
	readTimeSummary,
	readWorkPeriods,
} from "../read-queries";
import type { WorkPeriodWithEntries } from "../types";
import { getCurrentEmployee, getCurrentSession, getUserTimezone } from "./auth";
import { getAssignedProjectsWithHours } from "./entry-helpers";
import { logger } from "./shared";
import type { AssignedProject } from "./types";

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
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.id !== employeeId) return null;
	return readActiveWorkPeriod({
		employeeId: currentEmployee.id,
		organizationId: currentEmployee.organizationId,
	});
}

export async function getWorkPeriods(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkPeriodWithEntries[]> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.id !== employeeId) return [];
	return readWorkPeriods(
		{
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
		},
		startDate,
		endDate,
	);
}

export async function getTimeSummary(
	employeeId: string,
	timezone: string = "UTC",
	weekStartDay: WeekStartDay = "sunday",
): Promise<TimeSummary> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.id !== employeeId)
		return { todayMinutes: 0, weekMinutes: 0, monthMinutes: 0 };
	return readTimeSummary(
		{
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
		},
		timezone,
		weekStartDay,
	);
}

/**
 * Today's minutes on the compliance check's day, for break reminders: each
 * work period counted whole on the day it started, live work left out.
 */
export async function getComplianceDailyMinutes(
	employeeId: string,
	timezone: string,
): Promise<number> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.id !== employeeId) return 0;
	const totals = await readComplianceTotals({
		organizationId: currentEmployee.organizationId,
		employeeId: currentEmployee.id,
		workStart: systemClock.nowInstant(),
		timezone,
	});
	return totals.dailyMinutes;
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
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const policyService = yield* ChangePolicyService;
				const policy = yield* policyService.resolvePolicy(currentEmployee.id);
				const capability = yield* policyService.getEditCapability({
					employeeId: currentEmployee.id,
					workPeriodEndTime: selectedWorkPeriod.endTime!,
					timezone,
				});

				return {
					capability,
					policyName: policy?.policyName || null,
				};
			}),
		);

		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to get edit capability");
		return { success: false, error: "Failed to check edit permissions" };
	}
}
