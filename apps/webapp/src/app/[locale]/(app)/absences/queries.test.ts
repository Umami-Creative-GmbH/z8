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

describe("getVacationBalance calendar ranges", () => {
	it("derives ranges from calendar-year helpers", () => {
		expect(source).toContain("timezone = \"UTC\"");
		expect(source).toContain("getYearRange(year)");
		expect(source).toContain("timezone,");
		expect(source).toContain("lte(absenceEntry.startDate, endOfYear)");
		expect(source).toContain("gte(absenceEntry.endDate, startOfYear)");
		expect(source).not.toContain(`const startOfYear = \`\${year}-01-01\``);
		expect(source).not.toContain(`const endOfYear = \`\${year}-12-31\``);
	});
});
