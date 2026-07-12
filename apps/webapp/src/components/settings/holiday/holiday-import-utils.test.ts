import { describe, expect, it } from "vitest";
import { buildPresetHolidayImportValue } from "./holiday-import-utils";

describe("holiday preset import helpers", () => {
	it("imports the calendar date from date-holidays without adding an extra day", () => {
		const imported = buildPresetHolidayImportValue({
			name: "Maifeiertag",
			date: "2026-05-01 00:00:00",
			startDate: "2026-04-30T22:00:00.000Z",
			endDate: "2026-05-01T22:00:00.000Z",
			type: "public",
			isDuplicate: false,
		});

		expect(imported).toMatchObject({
			month: 5,
			day: 1,
			durationDays: 1,
		});
	});

	it("rejects an unsupported holiday type instead of casting it into the import payload", () => {
		const imported = buildPresetHolidayImportValue({
			name: "Unknown Holiday",
			date: "2026-05-01 00:00:00",
			startDate: "2026-05-01T00:00:00.000Z",
			endDate: "2026-05-02T00:00:00.000Z",
			type: "regional",
		});

		expect(imported).toBeNull();
	});
});
