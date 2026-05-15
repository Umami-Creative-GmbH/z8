import { describe, expect, it } from "vitest";
import {
	getBlockingOverlapMessage,
	splitVacationAroundSickRange,
} from "./sick-vacation-override";

describe("splitVacationAroundSickRange", () => {
	it("shortens vacation when sickness overlaps the start", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-18",
				sickEndDate: "2026-05-19",
			}),
		).toEqual([{ startDate: "2026-05-20", endDate: "2026-05-22" }]);
	});

	it("shortens vacation when sickness overlaps the end", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-21",
				sickEndDate: "2026-05-22",
			}),
		).toEqual([{ startDate: "2026-05-18", endDate: "2026-05-20" }]);
	});

	it("splits vacation when sickness is inside the vacation", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-20",
				sickEndDate: "2026-05-20",
			}),
		).toEqual([
			{ startDate: "2026-05-18", endDate: "2026-05-19" },
			{ startDate: "2026-05-21", endDate: "2026-05-22" },
		]);
	});

	it("returns no vacation segment when sickness fully covers vacation", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-18",
				sickEndDate: "2026-05-22",
			}),
		).toEqual([]);
	});

	it("preserves vacation when sickness starts after vacation ends", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-25",
				sickEndDate: "2026-05-26",
			}),
		).toEqual([{ startDate: "2026-05-18", endDate: "2026-05-22" }]);
	});

	it("preserves vacation when sickness ends before vacation starts", () => {
		expect(
			splitVacationAroundSickRange({
				vacationStartDate: "2026-05-18",
				vacationEndDate: "2026-05-22",
				sickStartDate: "2026-05-14",
				sickEndDate: "2026-05-15",
			}),
		).toEqual([{ startDate: "2026-05-18", endDate: "2026-05-22" }]);
	});
});

describe("getBlockingOverlapMessage", () => {
	it("allows full-day sick overlap with vacation-like absences", () => {
		expect(
			getBlockingOverlapMessage({
				newCategoryType: "sick",
				newStartPeriod: "full_day",
				newEndPeriod: "full_day",
				existingStatus: "approved",
				existingCountsAgainstVacation: true,
			}),
		).toBeNull();
	});

	it("blocks half-day sick overlap with vacation", () => {
		expect(
			getBlockingOverlapMessage({
				newCategoryType: "sick",
				newStartPeriod: "am",
				newEndPeriod: "am",
				existingStatus: "approved",
				existingCountsAgainstVacation: true,
			}),
		).toBe("Absence request overlaps with an existing approved absence");
	});

	it("blocks sick overlap with non-vacation absences", () => {
		expect(
			getBlockingOverlapMessage({
				newCategoryType: "sick",
				newStartPeriod: "full_day",
				newEndPeriod: "full_day",
				existingStatus: "pending",
				existingCountsAgainstVacation: false,
			}),
		).toBe("Absence request overlaps with an existing pending request");
	});
});
