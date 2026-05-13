import { describe, expect, it } from "vitest";
import source from "./page.tsx?raw";

describe("AbsencesPage calendar and fiscal ranges", () => {
	it("keeps visual calendar data on Jan-Dec while vacation balance uses fiscal label", () => {
		expect(source).toContain("const calendarStart = DateTime.fromObject");
		expect(source).toContain('const calendarEnd = calendarStart.endOf("year")');
		expect(source).toContain(
			"getVacationBalance(employee.id, fiscalYearLabel, fiscalYearStartMonth)",
		);
		expect(source).toContain("getAbsenceEntries(employee.id, calendarStartDate, calendarEndDate)");
		expect(source).toContain("currentYear={calendarYear}");
	});
});
