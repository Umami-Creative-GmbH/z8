import { describe, expect, it } from "vitest";
import { getNextAvailableReturnDate } from "./return-date-calculations";

describe("getNextAvailableReturnDate", () => {
	it("uses the employee schedule instead of blindly skipping Saturdays", () => {
		const result = getNextAvailableReturnDate({
			absenceEndDate: "2026-05-15",
			today: "2026-05-15",
			schedule: {
				workingDaysPreset: "weekends",
			},
			holidayDates: new Set(),
			absenceRanges: [],
		});

		expect(result.returnDate).toBe("2026-05-16");
		expect(result.returnsTomorrow).toBe(true);
	});

	it("skips non-working days, holidays, and future approved absences", () => {
		const result = getNextAvailableReturnDate({
			absenceEndDate: "2026-05-15",
			today: "2026-05-15",
			schedule: {
				workingDaysPreset: "weekdays",
			},
			holidayDates: new Set(["2026-05-18"]),
			absenceRanges: [{ startDate: "2026-05-19", endDate: "2026-05-19" }],
		});

		expect(result.returnDate).toBe("2026-05-20");
		expect(result.returnsTomorrow).toBe(false);
	});
});
