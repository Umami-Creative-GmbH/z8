import { describe, expect, it } from "vitest";
import { expandPresetHolidayForYear } from "./holiday-expansion";
import source from "./queries.ts?raw";

describe("expandPresetHolidayForYear", () => {
	it("expands preset holidays into concrete dates for the requested year", () => {
		const holidays = expandPresetHolidayForYear(
			{
				id: "preset-holiday-1",
				name: "Christmas",
				month: 12,
				day: 25,
				durationDays: 2,
				categoryId: "category-1",
			},
			2026,
		);

		expect(holidays).toHaveLength(1);
		expect(holidays[0]).toMatchObject({
			id: "preset-holiday-preset-holiday-1-2026",
			name: "Christmas",
			categoryId: "category-1",
		});
		expect(holidays[0]?.startDate).toEqual(new Date(2026, 11, 25));
		expect(holidays[0]?.endDate).toEqual(new Date(2026, 11, 26));
	});
});

describe("getVacationBalance fiscal ranges", () => {
	it("accepts a fiscalYearStartMonth argument and derives ranges from fiscal-year helpers", () => {
		expect(source).toContain("fiscalYearStartMonth: number | null | undefined = 1");
		expect(source).toContain("getFiscalYearRangeForLabelYear(year, fiscalYearStartMonth)");
		expect(source).not.toContain(`const startOfYear = \`\${year}-01-01\``);
		expect(source).not.toContain(`const endOfYear = \`\${year}-12-31\``);
	});
});
