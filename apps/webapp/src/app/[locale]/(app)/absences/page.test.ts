import { describe, expect, it } from "vitest";
import source from "./page.tsx?raw";

// Behaviour (balance year, linked record year, calendar-date ranges) is covered in page-ui.test.tsx.
describe("AbsencesPage calendar ranges", () => {
	it("keeps the vacation balance on the calendar year and records on the linked year", () => {
		expect(source).toContain(
			"getVacationBalanceResult(employee.id, calendarYear, timezone)",
		);
		expect(source).toContain("readAbsenceCalendarYear(employee.id, recordYear)");
		expect(source).not.toContain("fis" + "cal");
	});
});
