import { describe, expect, it } from "vitest";
import source from "./page.tsx?raw";

describe("AbsencesPage calendar ranges", () => {
	it("keeps visual calendar data and vacation balance on the calendar year", () => {
		expect(source).toContain("const calendarStart = DateTime.fromObject");
		expect(source).toContain('const calendarEnd = calendarStart.endOf("year")');
		expect(source).toContain("getVacationBalance(employee.id, calendarYear, timezone)");
		expect(source).toContain("getAbsenceEntries(employee.id, calendarStartDate, calendarEndDate)");
		expect(source).toContain("currentYear={calendarYear}");
		expect(source).not.toContain("fis" + "cal");
	});
});
