import { describe, expect, it } from "vitest";
import { calculateCarryoverExpiryDate, dateRangesOverlap, getYearRange } from "./date-utils";
import vacationServiceSource from "./vacation.service.ts?raw";
import vacationQueriesSource from "../query/vacation.queries.ts?raw";
import vacationReportsSource from "../reporting/vacation-reports.ts?raw";

describe("absence date utilities", () => {
	it("returns calendar-year boundaries by default", () => {
		const range = getYearRange(2026);

		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("calculates carryover expiry from the calendar year start", () => {
		const expiry = calculateCarryoverExpiryDate(2026, 3);

		expect(expiry.toISO()).toBe("2026-03-31T23:59:59.999Z");
	});

	it("calculates carryover expiry in the organization timezone", () => {
		const expiry = calculateCarryoverExpiryDate(2026, 3, "Europe/Berlin");

		expect(expiry.toISO()).toBe("2026-03-31T23:59:59.999+02:00");
	});

	it("uses organization timezone when checking existing carryover balance", () => {
		expect(vacationQueriesSource).toContain("timezone = \"UTC\"");
		expect(vacationQueriesSource).toContain("calculateCarryoverExpiryDate(");
		expect(vacationQueriesSource).toContain("policy.carryoverExpiryMonths");
		expect(vacationQueriesSource).toContain("timezone,");
		expect(vacationServiceSource).toContain("getCarryoverBalance(");
		expect(vacationServiceSource).toContain("fromYear,");
		expect(vacationServiceSource).toContain("undefined,");
		expect(vacationServiceSource).toContain("timezone,");
	});

	it("uses organization timezone when finding employees with expiring carryover", () => {
		expect(vacationQueriesSource).toContain("daysUntilExpiry: number = 30");
		expect(vacationQueriesSource).toContain("columns: { timezone: true }");
		expect(vacationQueriesSource).toContain("const timezone = org?.timezone || \"UTC\"");
		expect(vacationQueriesSource).toContain("calculateCarryoverExpiryDate(");
		expect(vacationQueriesSource).toContain("policy.carryoverExpiryMonths");
		expect(vacationQueriesSource).toContain("timezone,");
	});

	it("passes organization timezone through enhanced vacation balance calculation", () => {
		expect(vacationServiceSource).toContain("timezone?: string");
		expect(vacationServiceSource).toContain("timezone = \"UTC\"");
		expect(vacationServiceSource).toContain("calculateVacationBalance({");
		expect(vacationServiceSource).toContain("timezone,");
		expect(vacationServiceSource).toContain("calculateCarryoverExpiryDate(");
	});

	it("passes organization timezone through vacation summary and reporting balances", () => {
		expect(vacationServiceSource).toContain("columns: { timezone: true }");
		expect(vacationServiceSource).toContain("const timezone = org?.timezone || \"UTC\"");
		expect(vacationServiceSource).toContain("getEnhancedVacationBalance({");
		expect(vacationServiceSource).toContain("timezone,");
		expect(vacationReportsSource).toContain("columns: { timezone: true }");
		expect(vacationReportsSource).toContain("const timezone = org?.timezone || \"UTC\"");
		expect(vacationReportsSource).toContain("getEnhancedVacationBalance({");
		expect(vacationReportsSource).toContain("timezone,");
	});

	it("does not overlap the next logical day when an all-day range ends at next-day midnight", () => {
		expect(
			dateRangesOverlap(
				"2026-05-21",
				"2026-05-21",
				new Date("2026-05-20T00:00:00.000Z"),
				new Date("2026-05-21T00:00:00.000Z"),
			),
		).toBe(false);
	});
});
