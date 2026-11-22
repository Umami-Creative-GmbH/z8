"use server";

/**
 * Analytics Server Actions
 *
 * Server actions for analytics data retrieval with unified manager/admin access control.
 * Accessible to employee-role managers/workforce admins and org admins (including org
 * admins without an employee record) via the shared settings-access resolver (#1955).
 *
 * SECURITY: Organization ID is always derived from the authenticated session's active
 * organization, never from client input. This ensures multi-tenant isolation.
 */

import { Effect } from "effect";
import { env } from "@/env";
import {
	loadRecentAnalyticsIdentity,
	type RecentAnalyticsActor,
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
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AnalyticsService } from "@/lib/effect/services/analytics.service";
import {
	meetsSettingsAccess,
	resolveCallerSettingsAccess,
} from "@/lib/organization-action/settings-access";

type AnalyticsActor =
	| {
			role: "admin";
			organizationId: string;
			userId: string;
			employeeId: string | null;
			scope: { role: "admin" };
	  }
	| {
			role: "manager";
			organizationId: string;
			userId: string;
			employeeId: string;
			scope: { role: "manager"; managerEmployeeId: string };
	  };

/**
 * Resolve the authenticated analytics caller via the unified settings-access rule:
 * - Org owners/admins (with or without an employee record) and workforce admins read org-wide.
 * - Managers read their managed scope.
 * - Plain employees, former employees, and unapproved memberships are refused.
 */
function resolveAnalyticsActor() {
	return Effect.gen(function* () {
		const caller = yield* resolveCallerSettingsAccess();

		if (
			caller.settingsAccess === null ||
			!meetsSettingsAccess(caller.settingsAccess, "scopedManager")
		) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Analytics access restricted to managers and admins",
					userId: caller.userId,
					resource: "analytics",
					action: "view",
				}),
			);
		}

		if (
			meetsSettingsAccess(caller.settingsAccess, "orgAdmin") ||
			caller.employee?.role === "admin"
		) {
			return {
				role: "admin",
				organizationId: caller.organizationId,
				userId: caller.userId,
				employeeId: caller.employee?.id ?? null,
				scope: { role: "admin" },
			} satisfies AnalyticsActor;
		}

		if (caller.employee?.role === "manager") {
			return {
				role: "manager",
				organizationId: caller.organizationId,
				userId: caller.userId,
				employeeId: caller.employee.id,
				scope: { role: "manager", managerEmployeeId: caller.employee.id },
			} satisfies AnalyticsActor;
		}

		return yield* Effect.fail(
			new AuthorizationError({
				message: "Analytics access restricted to managers and admins",
				userId: caller.userId,
				resource: "analytics",
				action: "view",
			}),
		);
	});
}

function toRecentAnalyticsActor(actor: AnalyticsActor): RecentAnalyticsActor {
	if (actor.role === "admin") {
		return {
			id: actor.employeeId,
			userId: actor.userId,
			organizationId: actor.organizationId,
			role: "admin",
		};
	}
	return {
		id: actor.employeeId,
		userId: actor.userId,
		organizationId: actor.organizationId,
		role: "manager",
	};
}

function prepareRecentAnalytics(request: RecentAnalyticsRequest) {
	return Effect.gen(function* () {
		const current = yield* resolveAnalyticsActor();
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
			toRecentAnalyticsActor(current),
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
 * Organization ID is derived from the authenticated session's active organization
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
 * Organization ID is derived from the authenticated session's active organization
 */
export async function getVacationTrendsData(
	dateRange: DateRange,
): Promise<ServerActionResult<VacationTrendsData>> {
	const effect = Effect.gen(function* () {
		const actor = yield* resolveAnalyticsActor();
		const organizationId = actor.organizationId;

		const analyticsService = yield* AnalyticsService;

		const data = yield* analyticsService.getVacationTrends({
			organizationId,
			dateRange,
			scope: actor.scope,
		});

		return data;
	});

	return runServerActionSafe(effect);
}

/**
 * Get work hours analytics
 * Organization ID is derived from the authenticated session's active organization
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
 * Organization ID is derived from the authenticated session's active organization
 */
export async function getAbsencePatternsData(
	dateRange: DateRange,
): Promise<ServerActionResult<AbsencePatternsData>> {
	const effect = Effect.gen(function* () {
		const actor = yield* resolveAnalyticsActor();
		const organizationId = actor.organizationId;

		const analyticsService = yield* AnalyticsService;

		const data = yield* analyticsService.getAbsencePatterns({
			organizationId,
			dateRange,
			scope: actor.scope,
		});

		return data;
	});

	return runServerActionSafe(effect);
}

/**
 * Get manager effectiveness analytics
 * Organization ID is derived from the authenticated session's active organization
 */
export async function getManagerEffectivenessData(
	dateRange: DateRange,
	managerId?: string,
): Promise<ServerActionResult<ManagerEffectivenessData>> {
	const effect = Effect.gen(function* () {
		const actor = yield* resolveAnalyticsActor();
		const organizationId = actor.organizationId;

		if (
			actor.role === "manager" &&
			managerId &&
			managerId !== actor.employeeId
		) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Managers can only view their own approval analytics",
					userId: actor.userId,
					resource: "analytics",
					action: "view",
				}),
			);
		}

		const analyticsService = yield* AnalyticsService;

		const data = yield* analyticsService.getManagerEffectiveness({
			organizationId,
			dateRange,
			managerId: actor.role === "manager" ? actor.employeeId : managerId,
			scope: actor.scope,
		});

		return data;
	});

	return runServerActionSafe(effect);
}

/**
 * Get overtime burn-down analytics
 * Organization ID is derived from the authenticated session's active organization
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
