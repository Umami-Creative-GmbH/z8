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
		if (!subject.employee) {
			return {
				scope,
				result: { success: true, data: null },
				updatedAt: systemClock.nowInstant().epochMilliseconds,
			};
		}
		const result =
			id === "manager-today"
				? {
						success: true as const,
						data: await loadManagerTodayForEmployee(subject.employee),
					}
				: await runServerActionSafe(loadQuickStatsForSubject(scope));
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
