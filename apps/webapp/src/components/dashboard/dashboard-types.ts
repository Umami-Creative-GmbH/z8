import type { DashboardWidgetOrder } from "@/db/schema";
import type { ManagerTodaySummaryResult } from "./actions";
import type { QuickStats } from "./quick-stats-tracking";

export type DashboardScope = {
	userId: string;
	organizationId: string;
};

export type DashboardLayoutSettings = {
	dashboardWidgetOrder: DashboardWidgetOrder | null;
};

export type DashboardLayoutBootstrap = {
	scope: DashboardScope;
	settings: DashboardLayoutSettings;
	updatedAt: number;
};

export type DashboardSubject = DashboardScope & {
	employee: {
		id: string;
		organizationId: string;
		role: "admin" | "manager" | "employee";
	} | null;
};

export type DashboardWidgetData = {
	"manager-today": ManagerTodaySummaryResult;
	"quick-stats": QuickStats;
};

export type ServerWidgetId = keyof DashboardWidgetData;

export type DashboardWidgetSnapshot<T> = {
	scope: DashboardScope;
	result: { success: true; data: T | null } | { success: false; error: string };
	updatedAt: number;
};

export const SERVER_WIDGET_IDS: readonly ServerWidgetId[] = [
	"manager-today",
	"quick-stats",
];

export function isServerWidgetId(id: string): id is ServerWidgetId {
	return SERVER_WIDGET_IDS.some((candidate) => candidate === id);
}
