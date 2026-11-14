import { DEFAULT_WIDGET_ORDER, type WidgetId } from "./widget-registry";

export const DASHBOARD_REGIONS = {
	summary: ["quick-stats", "team-overview"],
	attention: ["manager-today", "pending-approvals", "whos-out-today"],
	records: ["managed-employees", "upcoming-shifts", "covering-for"],
	personal: ["vacation-balance", "upcoming-time-off", "recently-approved"],
	utilities: ["presence-status", "birthday-reminders", "hydration"],
} satisfies Record<string, WidgetId[]>;

/** An explicit global order continues to mean exactly that, including hidden slots. */
export function usesDashboardRegions(order: WidgetId[]): boolean {
	const selected = new Set(order);
	return DEFAULT_WIDGET_ORDER.filter((id) => selected.has(id)).every(
		(id, index) => order[index] === id,
	);
}

export function dashboardRegionWidgets(
	order: WidgetId[],
	region: keyof typeof DASHBOARD_REGIONS,
) {
	const ids: readonly WidgetId[] = DASHBOARD_REGIONS[region];
	const selected = new Set(order);
	return ids.filter((id) => selected.has(id));
}
