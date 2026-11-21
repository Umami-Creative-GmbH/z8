import { describe, expect, it } from "vitest";
import {
	type CustomAssignedHoliday,
	expandCustomAssignedHoliday,
} from "@/lib/calendar/assigned-holidays";
import { payrollHolidayRequestRange, payrollHolidaySources } from "./holiday-sources";
import type { PayrollPeriodRange } from "./types";

const december: PayrollPeriodRange = {
	startDate: "2026-12-01",
	endDate: "2026-12-31",
	label: "December 2026",
};

function storedHoliday(
	startDate: string,
	endDate: string,
	recurrenceType: "none" | "yearly" = "none",
): CustomAssignedHoliday {
	return {
		id: "holiday-1",
		name: "Holiday",
		organizationId: "org-1",
		startDate: new Date(startDate),
		endDate: new Date(endDate),
		categoryId: "category-1",
		description: null,
		isActive: true,
		recurrenceType,
		recurrenceRule: null,
		recurrenceEndDate: null,
	};
}

/** The holiday dates the payroll period read gets for one stored holiday row. */
function payrollHolidayDates(holiday: CustomAssignedHoliday, period: PayrollPeriodRange) {
	return payrollHolidaySources(
		expandCustomAssignedHoliday(holiday, payrollHolidayRequestRange(period)),
		period,
	).map(({ startDate, endDate }) => `${startDate}..${endDate}`);
}

describe("payroll holiday dates", () => {
	describe("holidays imported from date-holidays (local midnight to next local midnight)", () => {
		it("keeps a German Christmas Day on December 25 only", () => {
			// Europe/Berlin midnights, as the holiday import stores them.
			const christmas = storedHoliday("2026-12-24T23:00:00.000Z", "2026-12-25T23:00:00.000Z");

			expect(payrollHolidayDates(christmas, december)).toEqual(["2026-12-25..2026-12-25"]);
		});

		it("keeps a yearly German New Year's Day on January 1 only", () => {
			const newYear = storedHoliday(
				"2025-12-31T23:00:00.000Z",
				"2026-01-01T23:00:00.000Z",
				"yearly",
			);

			expect(payrollHolidayDates(newYear, december)).toEqual([]);
			expect(
				payrollHolidayDates(newYear, {
					startDate: "2027-01-01",
					endDate: "2027-01-31",
					label: "January 2027",
				}),
			).toEqual(["2027-01-01..2027-01-01"]);
		});

		it("keeps a summer-time German holiday on its day", () => {
			const ascension = storedHoliday("2026-05-13T22:00:00.000Z", "2026-05-14T22:00:00.000Z");

			expect(
				payrollHolidayDates(ascension, {
					startDate: "2026-05-01",
					endDate: "2026-05-31",
					label: "",
				}),
			).toEqual(["2026-05-14..2026-05-14"]);
		});

		it("keeps a US holiday on the period's last day on that day", () => {
			// America/New_York midnights: the start lies after the last day's UTC midnight.
			const lastDay = storedHoliday("2026-12-31T05:00:00.000Z", "2027-01-01T05:00:00.000Z");

			expect(payrollHolidayDates(lastDay, december)).toEqual(["2026-12-31..2026-12-31"]);
		});

		it("keeps a New Zealand summer-time Christmas Day on December 25", () => {
			// Pacific/Auckland midnights (UTC+13): 11:00 UTC the day before.
			const christmas = storedHoliday("2026-12-24T11:00:00.000Z", "2026-12-25T11:00:00.000Z");

			expect(payrollHolidayDates(christmas, december)).toEqual(["2026-12-25..2026-12-25"]);
		});

		it("keeps an imported holiday whose end was edited in the dialog through that end", () => {
			const extended = storedHoliday("2026-12-24T23:00:00.000Z", "2026-12-26T00:00:00.000Z");

			expect(payrollHolidayDates(extended, december)).toEqual(["2026-12-25..2026-12-26"]);
		});

		it("keeps a two-day holiday across the end of summer time on its two days", () => {
			const twoDays = storedHoliday("2026-10-24T22:00:00.000Z", "2026-10-26T23:00:00.000Z");

			expect(
				payrollHolidayDates(twoDays, { startDate: "2026-10-01", endDate: "2026-10-31", label: "" }),
			).toEqual(["2026-10-25..2026-10-26"]);
		});
	});

	describe("holidays stored as UTC calendar dates", () => {
		it("keeps a dialog holiday's inclusive end date", () => {
			const range = storedHoliday("2026-12-24T00:00:00.000Z", "2026-12-26T00:00:00.000Z");

			expect(payrollHolidayDates(range, december)).toEqual(["2026-12-24..2026-12-26"]);
		});

		it("keeps an end-of-day encoded holiday on its day", () => {
			const range = storedHoliday("2026-12-25T00:00:00.000Z", "2026-12-25T23:59:59.999Z");

			expect(payrollHolidayDates(range, december)).toEqual(["2026-12-25..2026-12-25"]);
		});

		it("keeps a yearly holiday on its date", () => {
			const range = storedHoliday("2024-12-25T00:00:00.000Z", "2024-12-25T00:00:00.000Z", "yearly");

			expect(payrollHolidayDates(range, december)).toEqual(["2026-12-25..2026-12-25"]);
		});

		it("keeps a holiday saved at an arbitrary time of day on its UTC date", () => {
			const range = storedHoliday("2026-12-24T14:37:12.345Z", "2026-12-24T14:37:12.345Z");

			expect(payrollHolidayDates(range, december)).toEqual(["2026-12-24..2026-12-24"]);
		});
	});

	it("clips a holiday to the period", () => {
		const range = storedHoliday("2026-11-30T00:00:00.000Z", "2026-12-02T00:00:00.000Z");

		expect(payrollHolidayDates(range, december)).toEqual(["2026-12-01..2026-12-02"]);
	});
});
