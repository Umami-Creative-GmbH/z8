import { describe, expect, it } from "vitest";
import { DEFAULT_WIDGET_ORDER, normalizeWidgetOrder, VALID_WIDGET_IDS } from "./widget-registry";

describe("dashboard widget registry", () => {
	it("registers manager today near the front of the default order", () => {
		expect(DEFAULT_WIDGET_ORDER).toContain("manager-today");
		expect(DEFAULT_WIDGET_ORDER.indexOf("manager-today")).toBeLessThanOrEqual(1);
		expect(VALID_WIDGET_IDS.has("manager-today")).toBe(true);
	});

	it("adds manager today when normalizing an older saved order", () => {
		expect(normalizeWidgetOrder(["quick-stats", "presence-status"])).toContain("manager-today");
	});
});
