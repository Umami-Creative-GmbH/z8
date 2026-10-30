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

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { member } from "@/db/auth-schema";
import { env } from "@/env";
import {
	loadRecentAnalyticsIdentity,
	type RecentAnalyticsRequest,
} from "@/lib/analytics/recent-identity";
import {
	readRecentOvertime,
	readRecentTeamPerformance,
	readRecentWorkHours,
} from "@/lib/analytics/recent-read";
import type {
	AbsencePatternsData,
	DateRange,
	ManagerEffectivenessData,
	OvertimeBurnDownData,
	OvertimeBurnDownParams,
	TeamPerformanceData,
	VacationTrendsData,
	WorkHoursAnalyticsData,
} from "@/lib/analytics/types";
import {
	AuthorizationError,
	BillingError,
	ExternalServiceError,
	NotFoundError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AnalyticsService } from "@/lib/effect/services/analytics.service";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { findAnalyticsEmployeeByUserId } from "./current-employee-scope";

/**
 * Get current employee and check if they're a manager or admin
 * Returns the employee record which includes organizationId for secure data access
 */
function checkManagerOrAdminAccess() {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Get current employee
		const currentEmployee = yield* dbService
			.query("getCurrentEmployee", async () => {
				return await findAnalyticsEmployeeByUserId(
					dbService.db,
					session.user.id,
					session.session.activeOrganizationId,
				);
			})
			.pipe(
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

		const membership = yield* dbService.query(
			"analytics.currentMembership",
			() =>
				dbService.db
					.select({ id: member.id })
					.from(member)
					.where(
						and(
							eq(member.organizationId, currentEmployee.organizationId),
							eq(member.userId, session.user.id),
							eq(member.status, "approved"),
						),
					)
					.limit(1),
		);
		if (!membership.length)
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Organization access is no longer available",
					userId: session.user.id,
					resource: "analytics",
					action: "view",
				}),
			);

		// Check role
		if (
			currentEmployee.role !== "admin" &&
			currentEmployee.role !== "manager"
		) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Analytics access restricted to managers and admins",
					userId: session.user.id,
					resource: "analytics",
					action: "view",
				}),
			);
		}

		return currentEmployee;
	});
}

function prepareRecentAnalytics(request: RecentAnalyticsRequest) {
	return Effect.gen(function* () {
		const current = yield* checkManagerOrAdminAccess();
		if (env.BILLING_ENABLED === "true") {
			const { BillingEnforcementService, BillingServicesLive } =
				yield* Effect.promise(() => import("@/lib/effect/services/billing"));
			const access = yield* Effect.gen(function* () {
				const billing = yield* BillingEnforcementService;
				return yield* billing.checkBillingAccess(current.organizationId, {
					createTrialIfMissing: false,
				});
			}).pipe(Effect.provide(BillingServicesLive));
			if (!access.canAccess)
				return yield* Effect.fail(
					new BillingError({
						message: "Billing access denied",
						reason: access.reason ?? "subscription_required",
						organizationId: current.organizationId,
					}),
				);
		}
		return yield* loadRecentAnalyticsIdentity(
			{
				id: current.id,
				userId: current.userId,
				organizationId: current.organizationId,
				role: current.role === "admin" ? "admin" : "manager",
			},
			request,
		);
	});
}

/** Cache outage is an isolated retryable read error, never a raw recomputation storm. */
async function readCachedAnalytics<T>(
	read: () => Promise<T>,
): Promise<ServerActionResult<T>> {
	try {
		return { success: true, data: await read() };
	} catch (cause) {
		return runServerActionSafe(
			Effect.fail(
				new ExternalServiceError({
					message: "Analytics temporarily unavailable. Please retry.",
					service: "recent-analytics",
					operation: "read",
					cause,
				}),
			),
		);
	}
}
/**
 * Get team performance analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getTeamPerformanceData(
	dateRange: DateRange,
	teamId?: string,
): Promise<ServerActionResult<TeamPerformanceData>> {
	const prepared = await runServerActionSafe(
		prepareRecentAnalytics({
			kind: "team",
			dateRange,
			teamId: teamId || undefined,
		}),
	);
	if (!prepared.success) return prepared;
	const { identity, request } = prepared.data;
	const params = {
		organizationId: identity.organizationId,
		scope: identity.scope,
		dateRange: request.dateRange,
		teamId: teamId || undefined,
	};
	if (!identity.cacheable)
		return runServerActionSafe(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getTeamPerformance(params);
			}),
		);
	return readCachedAnalytics(() => readRecentTeamPerformance(identity, params));
}
/**
 * Get vacation trends analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getVacationTrendsData(
	dateRange: DateRange,
): Promise<ServerActionResult<VacationTrendsData>> {
	const effect = Effect.gen(function* () {
		const currentEmployee = yield* checkManagerOrAdminAccess();
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* AnalyticsService;

		const data = yield* analyticsService.getVacationTrends({
			organizationId,
			dateRange,
		});

		return data;
	});

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
	const prepared = await runServerActionSafe(
		prepareRecentAnalytics({
			kind: "work-hours",
			dateRange,
			employeeId: employeeId || undefined,
		}),
	);
	if (!prepared.success) return prepared;
	const { identity, request } = prepared.data;
	const params = {
		organizationId: identity.organizationId,
		scope: identity.scope,
		dateRange: request.dateRange,
		employeeId: employeeId || undefined,
	};
	if (!identity.cacheable)
		return runServerActionSafe(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getWorkHoursAnalytics(params);
			}),
		);
	return readCachedAnalytics(() => readRecentWorkHours(identity, params));
}
/**
 * Get absence patterns analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getAbsencePatternsData(
	dateRange: DateRange,
): Promise<ServerActionResult<AbsencePatternsData>> {
	const effect = Effect.gen(function* () {
		const currentEmployee = yield* checkManagerOrAdminAccess();
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* AnalyticsService;

		const data = yield* analyticsService.getAbsencePatterns({
			organizationId,
			dateRange,
			scope:
				currentEmployee.role === "admin"
					? { role: "admin" }
					: { role: "manager", managerEmployeeId: currentEmployee.id },
		});

		return data;
	});

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
	const effect = Effect.gen(function* () {
		const currentEmployee = yield* checkManagerOrAdminAccess();
		const organizationId = currentEmployee.organizationId;

		const analyticsService = yield* AnalyticsService;

		const data = yield* analyticsService.getManagerEffectiveness({
			organizationId,
			dateRange,
			managerId,
		});

		return data;
	});

	return runServerActionSafe(effect);
}

/**
 * Get overtime burn-down analytics
 * Organization ID is derived from authenticated user's employee record
 */
export async function getOvertimeBurnDownData(
	dateRange: DateRange,
	filters?: OvertimeBurnDownParams["filters"],
): Promise<ServerActionResult<OvertimeBurnDownData>> {
	const normalizedFilters =
		filters?.teamId || filters?.managerId || filters?.costCenterId
			? {
					teamId: filters?.teamId || undefined,
					managerId: filters?.managerId || undefined,
					costCenterId: filters?.costCenterId || undefined,
				}
			: undefined;
	const prepared = await runServerActionSafe(
		prepareRecentAnalytics({
			kind: "overtime",
			dateRange,
			filters: normalizedFilters,
		}),
	);
	if (!prepared.success) return prepared;
	const { identity, request } = prepared.data;
	const params = {
		organizationId: identity.organizationId,
		scope: identity.scope,
		dateRange: request.dateRange,
		filters: normalizedFilters,
	};
	if (!identity.cacheable)
		return runServerActionSafe(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getOvertimeBurnDown(params);
			}),
		);
	return readCachedAnalytics(() => readRecentOvertime(identity, params));
}
