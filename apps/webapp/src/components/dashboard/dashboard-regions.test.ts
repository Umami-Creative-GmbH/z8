import { describe, expect, it } from "vitest";
import {
	DASHBOARD_REGIONS,
	dashboardRegionWidgets,
	usesDashboardRegions,
} from "./dashboard-regions";
import { DEFAULT_WIDGET_ORDER, type WidgetId } from "./widget-registry";

describe("dashboard region allocation", () => {
	it("allocates every existing widget once without dropping secondary capabilities", () => {
		const allocated = Object.values(DASHBOARD_REGIONS).flat();
		expect(new Set(allocated).size).toBe(DEFAULT_WIDGET_ORDER.length);
		expect(allocated.toSorted()).toEqual(DEFAULT_WIDGET_ORDER.toSorted());
	});
	it("uses the approved composition for defaults and any role/visibility subset", () => {
		expect(usesDashboardRegions(DEFAULT_WIDGET_ORDER)).toBe(true);
		expect(
			usesDashboardRegions(
				DEFAULT_WIDGET_ORDER.filter(
					(id) => !["manager-today", "team-overview", "hydration"].includes(id),
				),
			),
		).toBe(true);
		expect(dashboardRegionWidgets(DEFAULT_WIDGET_ORDER, "summary")).toEqual([
			"quick-stats",
			"team-overview",
		]);
	});
	it("preserves an explicit saved global order instead of forcing it into fixed regions", () => {
		const saved: WidgetId[] = [
			"vacation-balance",
			"quick-stats",
			"managed-employees",
		];
		expect(usesDashboardRegions(saved)).toBe(false);
		expect(saved).toEqual([
			"vacation-balance",
			"quick-stats",
			"managed-employees",
		]);
	});
	it("renders only selected widgets in a region", () => {
		expect(
			dashboardRegionWidgets(["quick-stats", "vacation-balance"], "summary"),
		).toEqual(["quick-stats"]);
		expect(
			dashboardRegionWidgets(["quick-stats", "vacation-balance"], "records"),
		).toEqual([]);
	});
});
