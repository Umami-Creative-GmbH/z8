import { describe, expect, it } from "vitest";
import {
	DEFAULT_WIDGET_ORDER,
	mergeVisibleWidgetOrder,
	normalizeWidgetLayout,
	normalizeWidgetOrder,
	VALID_WIDGET_IDS,
	WIDGET_CONFIGS,
} from "./widget-registry";

describe("dashboard widget registry", () => {
	it("registers manager today near the front of the default order", () => {
		expect(DEFAULT_WIDGET_ORDER).toContain("manager-today");
		expect(DEFAULT_WIDGET_ORDER.indexOf("manager-today")).toBeLessThanOrEqual(1);
		expect(VALID_WIDGET_IDS.has("manager-today")).toBe(true);
	});

	it("adds manager today when normalizing an older saved order", () => {
		expect(normalizeWidgetOrder(["quick-stats", "presence-status"])).toContain("manager-today");
	});

	it("defines display metadata for every widget", () => {
		expect(WIDGET_CONFIGS.map((widget) => widget.id)).toEqual(DEFAULT_WIDGET_ORDER);
		expect(WIDGET_CONFIGS.every((widget) => widget.label.length > 0)).toBe(true);
		expect(WIDGET_CONFIGS.every((widget) => widget.labelKey.startsWith("dashboard.widgets."))).toBe(
			true,
		);
	});

	it("normalizes missing hidden widgets to an empty list", () => {
		expect(normalizeWidgetLayout({ order: ["quick-stats"], version: 1 })).toEqual({
			order: normalizeWidgetOrder(["quick-stats"]),
			hidden: [],
			version: 1,
		});
	});

	it("removes unknown and duplicate hidden widget ids", () => {
		expect(
			normalizeWidgetLayout({
				order: ["quick-stats", "quick-stats", "unknown-widget"],
				hidden: ["quick-stats", "unknown-widget", "quick-stats", "presence-status"],
				version: 1,
			}),
		).toEqual({
			order: normalizeWidgetOrder(["quick-stats"]),
			hidden: ["quick-stats", "presence-status"],
			version: 1,
		});
	});

	it("keeps new widgets visible by default", () => {
		const layout = normalizeWidgetLayout({
			order: ["quick-stats"],
			hidden: ["quick-stats"],
			version: 1,
		});

		expect(layout.order).toEqual(normalizeWidgetOrder(["quick-stats"]));
		expect(layout.hidden).toEqual(["quick-stats"]);
		expect(layout.order.filter((id) => !layout.hidden.includes(id))).toContain("manager-today");
	});

	it("merges reordered visible widgets without moving hidden widget slots", () => {
		expect(
			mergeVisibleWidgetOrder(
				["manager-today", "quick-stats", "presence-status", "whos-out-today"],
				["whos-out-today", "manager-today", "quick-stats"],
				["presence-status"],
			),
		).toEqual(["whos-out-today", "manager-today", "presence-status", "quick-stats"]);
	});
});
