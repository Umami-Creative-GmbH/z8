/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
	createYearlyHolidayRecurrenceRule,
	formatHolidayDatePickerValue,
	parseHolidayDatePickerValue,
} from "./holiday-dialog-utils";

vi.mock("@/app/[locale]/(app)/settings/holidays/actions", () => ({
	getHolidayCategories: vi.fn(),
}));

describe("holiday date picker helpers", () => {
	it("preserve UTC date-only semantics for holiday dates", () => {
		const date = parseHolidayDatePickerValue("2024-05-01");

		expect(date?.toISOString()).toBe("2024-05-01T00:00:00.000Z");
		expect(formatHolidayDatePickerValue(date)).toBe("2024-05-01");
	});

	it("generates yearly recurrence rules from UTC holiday dates", () => {
		const date = parseHolidayDatePickerValue("2024-05-01");

		expect(date).not.toBeNull();
		expect(createYearlyHolidayRecurrenceRule(date as Date)).toBe(
			JSON.stringify({ month: 5, day: 1 }),
		);
	});
});
