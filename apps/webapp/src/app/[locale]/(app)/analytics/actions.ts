"use server";

/**
 * Analytics Server Actions
 *
 * Server actions for analytics data retrieval with role-based access control.
 * All analytics endpoints are restricted to admins and managers only.
 *
 * SECURITY: Organization ID is always derived from the authenticated user's
 * employee record, never from client input. This ensures multi-tenant isolation.
 */

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee } from "@/db/schema";
import type {
	AbsencePatternsData,
	DateRange,
	ManagerEffectivenessData,
	TeamPerformanceData,
	VacationTrendsData,
	WorkHoursAnalyticsData,
} from "@/lib/analytics/types";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AnalyticsService } from "@/lib/effect/services/analytics.service";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

/**
 * Get current employee and check if they're a manager or admin
 * Returns the employee record which includes organizationId for secure data access
 */
function checkManagerOrAdminAccess() {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		// Check role
		if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Analytics access restricted to managers and admins",
						userId: session.user.id,
						resource: "analytics",
						action: "view",
					}),
				),
			);
		}

		return currentEmployee;
	});
}

/**
 * Get team performance analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getTeamPerformanceData(
	dateRange: DateRange,
	teamId?: string,
): Promise<ServerActionResult<TeamPerformanceData>> {
	const effect = Effect.gen(function* (_) {
		const currentEmployee = yield* _(checkManagerOrAdminAccess());
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* _(AnalyticsService);

		const data = yield* _(
			analyticsService.getTeamPerformance({
				organizationId,
				dateRange,
				teamId,
			}),
		);

		return data;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get vacation trends analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getVacationTrendsData(
	dateRange: DateRange,
): Promise<ServerActionResult<VacationTrendsData>> {
	const effect = Effect.gen(function* (_) {
		const currentEmployee = yield* _(checkManagerOrAdminAccess());
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* _(AnalyticsService);

		const data = yield* _(
			analyticsService.getVacationTrends({
				organizationId,
				dateRange,
			}),
		);

		return data;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get work hours analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getWorkHoursAnalyticsData(
	dateRange: DateRange,
	employeeId?: string,
): Promise<ServerActionResult<WorkHoursAnalyticsData>> {
	const effect = Effect.gen(function* (_) {
		const currentEmployee = yield* _(checkManagerOrAdminAccess());
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* _(AnalyticsService);

		const data = yield* _(
			analyticsService.getWorkHoursAnalytics({
				organizationId,
				dateRange,
				employeeId,
			}),
		);

		return data;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get absence patterns analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getAbsencePatternsData(
	dateRange: DateRange,
): Promise<ServerActionResult<AbsencePatternsData>> {
	const effect = Effect.gen(function* (_) {
		const currentEmployee = yield* _(checkManagerOrAdminAccess());
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* _(AnalyticsService);

		const data = yield* _(
			analyticsService.getAbsencePatterns({
				organizationId,
				dateRange,
			}),
		);

		return data;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get manager effectiveness analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getManagerEffectivenessData(
	dateRange: DateRange,
	managerId?: string,
): Promise<ServerActionResult<ManagerEffectivenessData>> {
	const effect = Effect.gen(function* (_) {
		const currentEmployee = yield* _(checkManagerOrAdminAccess());
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* _(AnalyticsService);

		const data = yield* _(
			analyticsService.getManagerEffectiveness({
				organizationId,
				dateRange,
				managerId,
			}),
		);

		return data;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
