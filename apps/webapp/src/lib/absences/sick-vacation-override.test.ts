import { describe, expect, it } from "vitest";
import { splitVacationAroundSickRange } from "./sick-vacation-override";

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
});
