import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import { DEFAULT_STATUTORY_PREFERENCES, validateStatutoryPreferences } from "./preferences";

describe("minor contractors under JArbSchG (#2022)", () => {
	it("defaults to flagging minor contractors for review instead of judging them", () => {
		expect(DEFAULT_STATUTORY_PREFERENCES.applyJarbschgToMinorContractors).toBe(false);
	});
});

describe("validateStatutoryPreferences: working-student daytime band (#2017)", () => {
	const withBand = (start: number, end: number) => ({
		...DEFAULT_STATUTORY_PREFERENCES,
		workingStudentDaytimeStartMinute: start,
		workingStudentDaytimeEndMinute: end,
	});

	it("defaults to 06:00–18:00", () => {
		expect(DEFAULT_STATUTORY_PREFERENCES).toMatchObject({
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
		});
	});

	it.each([
		["00:00–24:00", 0, 1440],
		["07:00–19:00", 420, 1140],
		["05:45–06:00", 345, 360],
	])("accepts %s", (_, start, end) => {
		expect(() => validateStatutoryPreferences(withBand(start, end))).not.toThrow();
	});

	it.each([
		["a start that is not a quarter hour", 361, 1080, "statutory_daytime_band_out_of_range"],
		["an end that is not a quarter hour", 360, 1081, "statutory_daytime_band_out_of_range"],
		["a fractional minute", 360.5, 1080, "statutory_daytime_band_out_of_range"],
		["a start before 00:00", -15, 1080, "statutory_daytime_band_out_of_range"],
		["an end after 24:00", 360, 1455, "statutory_daytime_band_out_of_range"],
		["a start equal to the end", 600, 600, "statutory_daytime_band_start_not_before_end"],
		["a start after the end", 1080, 360, "statutory_daytime_band_start_not_before_end"],
	])("refuses %s", (_, start, end, refusal) => {
		let error: unknown;
		try {
			validateStatutoryPreferences(withBand(start, end));
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).toMatchObject({ refusal });
	});
});
