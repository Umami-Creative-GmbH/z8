"use server";

import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import * as z from "zod";
import { db } from "@/db";
import {
	employee,
	surchargeCalculation,
	workPeriod,
	workPolicy,
	workPolicyPresence,
} from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { AuthorizationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
	type EditCapability,
} from "@/lib/effect/services/change-policy.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { WorkPolicyService } from "@/lib/effect/services/work-policy.service";
import {
	getMonthRangeInTimezone,
	getTodayRangeInTimezone,
	getWeekRangeInTimezone,
} from "@/lib/time-tracking/timezone-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";
import type { WorkPeriodWithEntries } from "../types";
import { getCurrentEmployee, getCurrentSession, getUserTimezone } from "./auth";
import { getAssignedProjectsWithHours } from "./entry-helpers";
import { logger } from "./shared";
import type { AssignedProject } from "./types";

function mapWorkPeriodWithEntries(period: typeof workPeriod.$inferSelect & {
	clockIn: WorkPeriodWithEntries["clockIn"];
	clockOut: WorkPeriodWithEntries["clockOut"] | null;
}): WorkPeriodWithEntries {
	return {
		...period,
		clockIn: period.clockIn,
		clockOut: period.clockOut || undefined,
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
		return { hasEmployee: false, employeeId: null, isClockedIn: false, activeWorkPeriod: null };
	}

	const currentEmployee = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});

	if (!currentEmployee) {
		return { hasEmployee: false, employeeId: null, isClockedIn: false, activeWorkPeriod: null };
	}

	const activeWorkPeriod = await db.query.workPeriod.findFirst({
		where: and(eq(workPeriod.employeeId, currentEmployee.id), isNull(workPeriod.endTime)),
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
		where: and(eq(workPeriod.employeeId, employeeId), isNull(workPeriod.endTime)),
		with: {
			clockIn: true,
			clockOut: true,
		},
	});

	return activeWorkPeriod ? mapWorkPeriodWithEntries(activeWorkPeriod) : null;
}

export async function getWorkPeriods(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkPeriodWithEntries[]> {
	const workPeriods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
		),
		with: {
			clockIn: true,
			clockOut: true,
		},
		orderBy: [workPeriod.startTime],
	});

	return workPeriods.reverse().map(mapWorkPeriodWithEntries);
}

export async function getTimeSummary(
	employeeId: string,
	timezone: string = "UTC",
): Promise<TimeSummary> {
	const { start: todayStartDateTime, end: todayEndDateTime } = getTodayRangeInTimezone(timezone);
	const { start: weekStartDateTime, end: weekEndDateTime } = getWeekRangeInTimezone(
		new Date(),
		timezone,
	);
	const { start: monthStartDateTime, end: monthEndDateTime } = getMonthRangeInTimezone(
		new Date(),
		timezone,
	);

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
		.leftJoin(surchargeCalculation, eq(surchargeCalculation.workPeriodId, workPeriod.id))
		.where(
			and(
				eq(workPeriod.employeeId, employeeId),
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

export async function getAssignedProjects(): Promise<ServerActionResult<AssignedProject[]>> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const { projectsById, hoursByProjectId } = await getAssignedProjectsWithHours(
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

export async function getWorkPeriodEditCapability(workPeriodId: string): Promise<
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

	const timezone = await getUserTimezone(session.user.id);
	const [selectedWorkPeriod] = await db
		.select()
		.from(workPeriod)
		.where(eq(workPeriod.id, workPeriodId))
		.limit(1);

	if (!selectedWorkPeriod) {
		return { success: false, error: "Work period not found" };
	}

	if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
		return { success: false, error: "You can only check your own work periods" };
	}

	if (!selectedWorkPeriod.endTime) {
		return {
			success: true,
			data: {
				capability: { type: "forbidden", reason: "beyond_approval_window", daysBack: 0 },
				policyName: null,
			},
		};
	}

	try {
		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const policyService = yield* _(ChangePolicyService);
				const policy = yield* _(policyService.resolvePolicy(currentEmployee.id));
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
			}).pipe(Effect.provide(ChangePolicyServiceLive), Effect.provide(DatabaseServiceLive)),
		);

		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to get edit capability");
		return { success: false, error: "Failed to check edit permissions" };
	}
}

export async function getPresenceStatus(employeeId: string): Promise<
	ServerActionResult<{
		required: number;
		actual: number;
		period: string;
		mode: string;
		presenceEnabled: boolean;
	}>
> {
	const parsed = z
		.object({ employeeId: z.string().uuid("Invalid employee ID") })
		.safeParse({ employeeId });

	if (!parsed.success) {
		return { success: false as const, error: parsed.error.issues[0]?.message || "Invalid input" };
	}

	const validatedEmployeeId = parsed.data.employeeId;
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const activeOrganizationId = session.session.activeOrganizationId;

		if (!activeOrganizationId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "No active organization",
						userId: session.user.id,
						resource: "employee",
						action: "getPresenceStatus",
					}),
				),
			);
		}

		const targetEmployee = yield* _(
			dbService.query("getEmployeeForAuth", async () => {
				return dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.id, validatedEmployeeId),
						eq(employee.organizationId, activeOrganizationId!),
					),
					columns: { id: true },
				});
			}),
		);

		if (!targetEmployee) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Employee not found in your organization",
						userId: session.user.id,
						resource: "employee",
						action: "getPresenceStatus",
					}),
				),
			);
		}

		const workPolicyService = yield* _(WorkPolicyService);
		const effectivePolicy = yield* _(workPolicyService.getEffectivePolicy(validatedEmployeeId));

		if (!effectivePolicy) {
			return {
				required: 0,
				actual: 0,
				period: "weekly",
				mode: "minimum_count",
				presenceEnabled: false,
			};
		}

		const policyRow = yield* _(
			dbService.query("getWorkPolicy", async () => {
				return dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, effectivePolicy.policyId),
					columns: { presenceEnabled: true },
				});
			}),
		);

		if (!policyRow?.presenceEnabled) {
			return {
				required: 0,
				actual: 0,
				period: "weekly",
				mode: "minimum_count",
				presenceEnabled: false,
			};
		}

		const presenceConfig = yield* _(
			dbService.query("getPresenceConfig", async () => {
				return dbService.db.query.workPolicyPresence.findFirst({
					where: eq(workPolicyPresence.policyId, effectivePolicy.policyId),
				});
			}),
		);

		if (!presenceConfig) {
			return {
				required: 0,
				actual: 0,
				period: "weekly",
				mode: "minimum_count",
				presenceEnabled: false,
			};
		}

		const weekStart = DateTime.now().startOf("week");
		const weekEnd = DateTime.now().endOf("week");
		const workPeriods = yield* _(
			dbService.query("getWeekWorkPeriods", async () => {
				return dbService.db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.employeeId, validatedEmployeeId),
						gte(workPeriod.startTime, weekStart.toJSDate()),
						lte(workPeriod.startTime, weekEnd.toJSDate()),
					),
				});
			}),
		);

		const onsiteDates = new Set<string>();
		for (const period of workPeriods) {
			if (period.workLocationType === "office" || period.workLocationType === "field") {
				const date = DateTime.fromJSDate(period.startTime).toISODate();
				if (date) {
					onsiteDates.add(date);
				}
			}
		}

		const required =
			presenceConfig.presenceMode === "minimum_count"
				? (presenceConfig.requiredOnsiteDays ?? 0)
				: presenceConfig.requiredOnsiteFixedDays
					? (JSON.parse(presenceConfig.requiredOnsiteFixedDays) as string[]).length
					: 0;

		return {
			required,
			actual: onsiteDates.size,
			period: presenceConfig.evaluationPeriod,
			mode: presenceConfig.presenceMode,
			presenceEnabled: true,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
