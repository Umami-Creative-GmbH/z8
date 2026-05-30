import { describe, expect, it } from "vitest";
import {
	getEndDateAfterStartDateChange,
	parseHolidayDatePickerValue,
} from "./holiday-dialog-utils";

describe("holiday dialog date helpers", () => {
	it("defaults the end date to the selected start date when creating a holiday", () => {
		const startDate = parseHolidayDatePickerValue("2026-05-01") as Date;
		const currentEndDate = parseHolidayDatePickerValue("2026-05-28") as Date;

		expect(
			getEndDateAfterStartDateChange({
				isEditing: false,
				nextStartDate: startDate,
				currentEndDate,
			}),
		).toBe(startDate);
	});

	it("keeps existing end dates unchanged when editing a holiday", () => {
		const startDate = parseHolidayDatePickerValue("2026-05-01") as Date;
		const currentEndDate = parseHolidayDatePickerValue("2026-05-03") as Date;

		expect(
			getEndDateAfterStartDateChange({
				isEditing: true,
				nextStartDate: startDate,
				currentEndDate,
			}),
		).toBe(currentEndDate);
	});
});
