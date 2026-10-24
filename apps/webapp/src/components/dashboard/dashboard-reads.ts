import "server-only";

import { cache } from "react";
import { loadPresenceStatusForSubject } from "@/app/[locale]/(app)/time-tracking/actions/presence-status-read";
import { getRenderAuthContext } from "@/lib/auth/render-context";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runServerActionSafe } from "@/lib/effect/result";
import { getRenderUserSettings } from "@/lib/user-preferences/render-snapshot";
import { normalizeWeekStartDay } from "@/lib/user-preferences/week-start";
import type {
	DashboardLayoutBootstrap,
	DashboardScope,
	DashboardSubject,
	DashboardWidgetData,
	DashboardWidgetSnapshot,
	ServerWidgetId,
} from "./dashboard-types";
import { loadManagerTodayForEmployee } from "./manager-today-read";
import {
	loadBirthdayRemindersForOrganization,
	loadHydrationForSubject,
	loadVacationBalanceForEmployee,
} from "./personal-widget-reads";
import { loadQuickStatsForSubject } from "./quick-stats-read";
import {
	loadCoverDutiesForSubject,
	loadUpcomingShiftsForEmployee,
	loadUpcomingTimeOffForOrganization,
	loadWhosOutForOrganization,
} from "./schedule-absence-reads";
import {
	loadManagedEmployeesForEmployee,
	loadPendingApprovalsForSubject,
	loadRecentlyApprovedForOrganization,
	loadTeamOverviewForOrganization,
	recentlyApprovedDto,
} from "./team-approval-reads";

export async function readDashboardLayout(
	scope: DashboardScope,
): Promise<DashboardLayoutBootstrap> {
	const settings = await getRenderUserSettings(scope.userId);
	return {
		scope,
		settings: { dashboardWidgetOrder: settings?.dashboardWidgetOrder ?? null },
		updatedAt: systemClock.nowInstant().epochMilliseconds,
	};
}

export const getRenderDashboardLayout = cache(async () => {
	const context = await getRenderAuthContext();
	const organizationId = context?.session.activeOrganizationId;
	if (!context || !organizationId) return null;
	const settings = await getRenderUserSettings(context.user.id);
	const subject: DashboardSubject = {
		userId: context.user.id,
		organizationId,
		employee: context.employee,
		hydrationSettings: {
			waterReminderEnabled: settings?.waterReminderEnabled ?? false,
			waterReminderDailyGoal: settings?.waterReminderDailyGoal ?? 8,
		},
		preferences: {
			timezone: settings?.timezone || "UTC",
			weekStartDay: normalizeWeekStartDay(settings?.weekStartDay),
		},
	};
	return { subject, layout: await readDashboardLayout(subject) };
});

export async function readDashboardWidget<K extends ServerWidgetId>(
	id: K,
	subject: DashboardSubject,
): Promise<DashboardWidgetSnapshot<DashboardWidgetData[K]>> {
	const scope = {
		userId: subject.userId,
		organizationId: subject.organizationId,
	};
	try {
		const employee = subject.employee;
		if (!employee && (id === "manager-today" || id === "quick-stats")) {
			return {
				scope,
				result: { success: true, data: null },
				updatedAt: systemClock.nowInstant().epochMilliseconds,
			};
		}
		if (!employee || employee.organizationId !== subject.organizationId)
			throw new Error("Employee access required");
		const result = await (async () => {
			switch (id) {
				case "birthday-reminders":
					return runServerActionSafe(loadBirthdayRemindersForOrganization(subject.organizationId));
				case "hydration":
					return runServerActionSafe(loadHydrationForSubject(subject, { fresh: true }));
				case "presence-status":
					return runServerActionSafe(
						loadPresenceStatusForSubject({
							userId: subject.userId,
							organizationId: subject.organizationId,
							employeeId: employee.id,
							preferences: subject.preferences,
						}),
					);
				case "vacation-balance": {
					const result = await runServerActionSafe(
						loadVacationBalanceForEmployee({ organizationId: subject.organizationId, employee }),
					);
					return result.success
						? {
								success: true as const,
								data: {
									...result.data,
									balance: result.data.balance
										? {
												...result.data.balance,
												carryoverExpiryDate:
													result.data.balance.carryoverExpiryDate?.toISOString() ?? null,
											}
										: null,
								},
							}
						: result;
				}
				case "upcoming-shifts":
					return runServerActionSafe(loadUpcomingShiftsForEmployee(employee));
				case "covering-for":
					return { success: true as const, data: await loadCoverDutiesForSubject(subject) };
				case "whos-out-today":
					return runServerActionSafe(loadWhosOutForOrganization(subject.organizationId));
				case "upcoming-time-off":
					return runServerActionSafe(loadUpcomingTimeOffForOrganization(subject.organizationId));
				case "manager-today":
					return {
						success: true as const,
						data: await loadManagerTodayForEmployee(employee),
					};
				case "quick-stats":
					return runServerActionSafe(loadQuickStatsForSubject(scope));
				case "managed-employees":
					return runServerActionSafe(loadManagedEmployeesForEmployee(employee));
				case "team-overview":
					return employee.role === "employee"
						? { success: true as const, data: null }
						: runServerActionSafe(loadTeamOverviewForOrganization(subject.organizationId));
				case "pending-approvals":
					return { success: true as const, data: await loadPendingApprovalsForSubject(subject) };
				case "recently-approved": {
					const result = await runServerActionSafe(
						loadRecentlyApprovedForOrganization(subject.organizationId),
					);
					return result.success
						? { success: true as const, data: recentlyApprovedDto(result.data) }
						: result;
				}
			}
		})();
		return {
			scope,
			result,
			updatedAt: systemClock.nowInstant().epochMilliseconds,
		} as DashboardWidgetSnapshot<DashboardWidgetData[K]>;
	} catch {
		return {
			scope,
			result: {
				success: false,
				error: "Dashboard widget could not be loaded.",
			},
			updatedAt: systemClock.nowInstant().epochMilliseconds,
		};
	}
}
