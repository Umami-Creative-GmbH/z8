import { describe, expect, it } from "vitest";
import type { ApprovalInboxTimeComparison } from "../inbox/types";
import {
	comparisonElapsedMinutes,
	comparisonEndpointText,
	timeComparisonLayout,
} from "./time-comparison";

const comparison: ApprovalInboxTimeComparison = {
	type: "time_comparison",
	action: "edit",
	original: {
		start: { at: "2026-10-02T06:00:00Z", utcOffsetMinutes: 120 },
		end: { at: "2026-10-02T10:00:00Z", utcOffsetMinutes: 120 },
	},
	requested: {
		start: { at: "2026-10-02T06:30:00Z", utcOffsetMinutes: 120 },
		end: { at: "2026-10-02T11:00:00Z", utcOffsetMinutes: 120 },
	},
};

describe("time correction comparison", () => {
	it("aligns both ranges on the same captured local time axis", () => {
		const layout = timeComparisonLayout(comparison)!;
		expect(layout.offsetLabel).toBe("UTC+02:00");
		expect(layout.ticks[0].label).toBe("07:00");
		expect(layout.original!.top).toBeLessThan(layout.requested!.top);
		expect(layout.requested!.height).toBeGreaterThan(layout.original!.height);
		expect(comparisonElapsedMinutes(comparison.requested)).toBe(270);
		expect(comparisonEndpointText(comparison.original.start!)).toBe("2026-10-02 08:00 (UTC+02:00)");
	});
	it("shows recorded endpoint offsets while measuring travel by UTC instants", () => {
		const range = {
			start: comparison.original.start,
			end: { at: "2026-10-02T11:00:00Z", utcOffsetMinutes: -240 },
		};
		expect(comparisonElapsedMinutes(range)).toBe(300);
		expect(comparisonEndpointText(range.end)).toBe("2026-10-02 07:00 (UTC-04:00)");
		expect(
			timeComparisonLayout({ ...comparison, requested: range })!.requested!.height,
		).toBeGreaterThan(0);
	});
	it("keeps overnight entries ordered and marks the next day's ticks", () => {
		const range = {
			start: { at: "2026-10-02T21:00:00Z", utcOffsetMinutes: 120 },
			end: { at: "2026-10-03T01:00:00Z", utcOffsetMinutes: 120 },
		};
		const layout = timeComparisonLayout({
			...comparison,
			original: range,
			requested: range,
		})!;
		expect(layout.ticks.some((tick) => tick.label.startsWith("2026-10-03"))).toBe(true);
		expect(comparisonElapsedMinutes(range)).toBe(240);
	});
	it("does not invent a requested interval for deletion or missing evidence", () => {
		expect(
			timeComparisonLayout({
				...comparison,
				action: "delete",
				requested: { start: null, end: null },
			})!.requested,
		).toBeNull();
		expect(
			timeComparisonLayout({
				...comparison,
				original: {
					...comparison.original,
					start: { ...comparison.original.start!, utcOffsetMinutes: null },
				},
			}),
		).toBeNull();
		expect(comparisonElapsedMinutes({ start: comparison.original.start, end: null })).toBeNull();
	});
});
