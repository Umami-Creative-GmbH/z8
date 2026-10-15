import { describe, expect, it } from "vitest";
import { expandPresetHolidayForYear } from "./holiday-expansion";
import balanceStoreSource from "@/lib/absences/vacation-balance-store.ts?raw";
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
	it("derives ranges from calendar-year helpers in the shared balance computation (#1111)", () => {
		expect(source).toContain('timezone = "UTC"');
		expect(source).toContain("loadVacationBalances(db, {");
		expect(source).toContain("timezone,");
		expect(balanceStoreSource).toMatch(/Temporal\.PlainDate\.from\(\{\s*year,\s*month: 1,\s*day: 1,?\s*\}\)/);
		expect(balanceStoreSource).toContain("lte(absenceEntry.startDate, endOfYear)");
		expect(balanceStoreSource).toContain("gte(absenceEntry.endDate, startOfYear)");
		expect(balanceStoreSource).not.toContain(`const startOfYear = \`\${year}-01-01\``);
		expect(balanceStoreSource).not.toContain(`const endOfYear = \`\${year}-12-31\``);
	});
});
