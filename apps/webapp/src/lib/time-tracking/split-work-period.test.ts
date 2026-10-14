import { describe, expect, it } from "vitest";
import { resolveWorkPeriodSplit } from "./split-work-period";

describe("resolveWorkPeriodSplit", () => {
	it("resolves a Berlin wall-clock split and derives UTC durations", () => {
		const result = resolveWorkPeriodSplit({
			startTime: new Date("2026-05-04T08:00:00.000Z"),
			endTime: new Date("2026-05-04T16:00:00.000Z"),
			splitDate: "2026-05-04",
			splitTime: "12:00",
			timezone: "Europe/Berlin",
		});

		expect(result).toEqual({
			success: true,
			splitTime: new Date("2026-05-04T10:00:00.000Z"),
			firstDurationMinutes: 120,
			secondDurationMinutes: 360,
		});
	});

	it("rejects a split outside the work period", () => {
		expect(
			resolveWorkPeriodSplit({
				startTime: new Date("2026-05-04T08:00:00.000Z"),
				endTime: new Date("2026-05-04T16:00:00.000Z"),
				splitDate: "2026-05-04",
				splitTime: "09:00",
				timezone: "Europe/Berlin",
			}),
		).toEqual({ success: false, code: "outside_period" });
	});

	it("resolves an overnight Berlin period on the following local date", () => {
		expect(
			resolveWorkPeriodSplit({
				startTime: new Date("2026-05-04T20:00:00.000Z"),
				endTime: new Date("2026-05-05T04:00:00.000Z"),
				splitDate: "2026-05-05",
				splitTime: "02:00",
				timezone: "Europe/Berlin",
			}),
		).toEqual({
			success: true,
			splitTime: new Date("2026-05-05T00:00:00.000Z"),
			firstDurationMinutes: 240,
			secondDurationMinutes: 240,
		});
	});

	it("uses the selected date in a multi-day period without treating dates as a DST fold", () => {
		expect(
			resolveWorkPeriodSplit({
				startTime: new Date("2026-05-04T00:00:00.000Z"),
				endTime: new Date("2026-05-06T21:00:00.000Z"),
				splitDate: "2026-05-05",
				splitTime: "02:00",
				timezone: "Europe/Berlin",
			}),
		).toMatchObject({ success: true, splitTime: new Date("2026-05-05T00:00:00.000Z") });
	});

	it("floors UTC-derived segment durations when period endpoints include seconds", () => {
		expect(
			resolveWorkPeriodSplit({
				startTime: new Date("2026-05-04T08:00:30.000Z"),
				endTime: new Date("2026-05-04T16:00:45.000Z"),
				splitDate: "2026-05-04",
				splitTime: "12:00",
				timezone: "Europe/Berlin",
			}),
		).toMatchObject({
			success: true,
			firstDurationMinutes: 119,
			secondDurationMinutes: 360,
		});
	});

	it("rejects nonexistent local times during a DST gap", () => {
		expect(
			resolveWorkPeriodSplit({
				startTime: new Date("2026-03-29T00:00:00.000Z"),
				endTime: new Date("2026-03-29T03:00:00.000Z"),
				splitDate: "2026-03-29",
				splitTime: "02:30",
				timezone: "Europe/Berlin",
			}),
		).toEqual({ success: false, code: "nonexistent" });
	});

	it("requires a fold choice and resolves either explicit choice", () => {
		const input = {
			startTime: new Date("2026-10-25T00:00:00.000Z"),
			endTime: new Date("2026-10-25T03:00:00.000Z"),
			splitDate: "2026-10-25",
			splitTime: "02:30",
			timezone: "Europe/Berlin",
		};

		expect(resolveWorkPeriodSplit(input)).toEqual({ success: false, code: "ambiguous" });
		expect(resolveWorkPeriodSplit({ ...input, disambiguation: "earlier" })).toMatchObject({
			success: true,
			splitTime: new Date("2026-10-25T00:30:00.000Z"),
		});
		expect(resolveWorkPeriodSplit({ ...input, disambiguation: "later" })).toMatchObject({
			success: true,
			splitTime: new Date("2026-10-25T01:30:00.000Z"),
		});
	});
});
