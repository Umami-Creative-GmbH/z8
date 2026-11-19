import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	formatPayrollReadinessPeriod,
	payrollReadinessAnchorMonth,
	payrollReadinessMonthHref,
	resolvePayrollReadinessPeriod,
} from "./payroll-readiness-period";

const today = Temporal.PlainDate.from("2026-11-19");

describe("resolvePayrollReadinessPeriod", () => {
	it("defaults to the whole previous UTC month", () => {
		const period = resolvePayrollReadinessPeriod({}, today);

		expect(period.start.toString()).toBe("2026-10-01");
		expect(period.end.toString()).toBe("2026-10-31");
		expect(period.month?.toString()).toBe("2026-10");
	});

	it("crosses a year boundary for the January default", () => {
		const period = resolvePayrollReadinessPeriod({}, Temporal.PlainDate.from("2027-01-03"));

		expect(period.start.toString()).toBe("2026-12-01");
		expect(period.end.toString()).toBe("2026-12-31");
	});

	it("keeps a requested whole month and recognises it as one", () => {
		const period = resolvePayrollReadinessPeriod({ start: "2024-02-01", end: "2024-02-29" }, today);

		expect(period.month?.toString()).toBe("2024-02");
	});

	it("keeps a custom range without calling it a month", () => {
		const period = resolvePayrollReadinessPeriod({ start: "2026-07-01", end: "2026-07-15" }, today);

		expect(period.start.toString()).toBe("2026-07-01");
		expect(period.end.toString()).toBe("2026-07-15");
		expect(period.month).toBeNull();
	});

	it("reads an instant with an offset as its UTC day", () => {
		const period = resolvePayrollReadinessPeriod(
			{ start: "2026-07-01T01:00:00+02:00", end: "2026-07-31" },
			today,
		);

		expect(period.start.toString()).toBe("2026-06-30");
	});

	it("falls back for each unreadable bound on its own", () => {
		const period = resolvePayrollReadinessPeriod(
			{ start: "not-a-date", end: "2026-02-30" },
			today,
		);

		expect(period.start.toString()).toBe("2026-10-01");
		expect(period.end.toString()).toBe("2026-10-31");
	});
});

describe("payroll readiness month navigation", () => {
	it("links a whole month in the page's start/end convention", () => {
		expect(payrollReadinessMonthHref(Temporal.PlainYearMonth.from("2026-02"))).toBe(
			"/settings/payroll-readiness?start=2026-02-01&end=2026-02-28",
		);
	});

	it("steps from the month a custom range starts in", () => {
		const period = resolvePayrollReadinessPeriod({ start: "2026-07-10", end: "2026-08-20" }, today);

		expect(payrollReadinessAnchorMonth(period).toString()).toBe("2026-07");
	});
});

describe("formatPayrollReadinessPeriod", () => {
	it("names a whole month in the reader's locale", () => {
		const period = resolvePayrollReadinessPeriod({ start: "2026-07-01", end: "2026-07-31" }, today);

		expect(formatPayrollReadinessPeriod(period, "en")).toBe("July 2026");
		expect(formatPayrollReadinessPeriod(period, "de")).toBe("Juli 2026");
	});

	it("shows a custom range as dates", () => {
		const period = resolvePayrollReadinessPeriod({ start: "2026-07-01", end: "2026-07-15" }, today);

		expect(formatPayrollReadinessPeriod(period, "en")).toMatch(/Jul.*1.*15.*2026/);
	});
});
