import { describe, it, expect } from "vitest";
import { todayTotal } from "../src/lib/day-total";
const basis = (timezone = "Europe/Berlin") => ({
	timezone,
	completedMinutesByDate: {},
	liveWork: [{ startedAt: "2026-10-24T22:00:00Z" }],
});
describe("employee day total", () => {
	it("counts elapsed UTC work across the autumn DST overlap", () => {
		expect(todayTotal(basis(), [], "2026-10-25T02:30:00Z")).toBe(270);
	});
	it("uses the employee's day rather than the device day after travel", () => {
		expect(
			todayTotal(basis("America/New_York"), [], "2026-10-25T02:30:00Z"),
		).toBe(270);
		expect(todayTotal(basis(), [], "2026-10-25T23:10:00Z")).toBe(10);
	});
	it("excludes a saved manual break and includes resumed offline work", () => {
		const pending = [
			{ kind: "clock_out", occurredAt: "2026-10-25T00:00:00Z", command: "{}" },
			{ kind: "clock_in", occurredAt: "2026-10-25T00:30:00Z", command: "{}" },
		] as const;
		expect(todayTotal(basis(), pending, "2026-10-25T01:00:00Z")).toBe(150);
	});
});
