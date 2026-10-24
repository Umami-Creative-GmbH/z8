import "server-only";

import { cache } from "react";
import { getRenderAuthContext } from "@/lib/auth/render-context";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runServerActionSafe } from "@/lib/effect/result";
import { getRenderUserSettings } from "@/lib/user-preferences/render-snapshot";
import type {
	DashboardLayoutBootstrap,
	DashboardScope,
	DashboardSubject,
	DashboardWidgetData,
	DashboardWidgetSnapshot,
	ServerWidgetId,
} from "./dashboard-types";
import { loadManagerTodayForEmployee } from "./manager-today-read";
import { loadQuickStatsForSubject } from "./quick-stats-read";
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
	const subject: DashboardSubject = {
		userId: context.user.id,
		organizationId,
		employee: context.employee,
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
