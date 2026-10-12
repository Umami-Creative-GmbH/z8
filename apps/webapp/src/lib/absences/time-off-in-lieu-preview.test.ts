import { describe, expect, it } from "vitest";
import { previewTimeOffInLieu } from "./time-off-in-lieu-preview";

const balance = (balanceMinutes: number, computedThroughDate = "2026-10-09") => ({
	balanceMinutes,
	computedThroughDate,
});

const fullDay = (date: string) => ({
	startDate: date,
	startPeriod: "full_day" as const,
	endDate: date,
	endPeriod: "full_day" as const,
});

describe("projected work balance after time off in lieu", () => {
	it("falls by the required time of a full day", () => {
		expect(
			previewTimeOffInLieu({
				balance: balance(600),
				absence: fullDay("2026-10-12"),
				requiredMinutesByDate: { "2026-10-12": 480 },
			}),
		).toEqual({
			currentBalanceMinutes: 600,
			drawnMinutes: 480,
			projectedBalanceMinutes: 120,
			wouldBeNegative: false,
		});
	});

	it("falls by half the day's required time on a half day", () => {
		expect(
			previewTimeOffInLieu({
				balance: balance(600),
				absence: { ...fullDay("2026-10-12"), startPeriod: "am", endPeriod: "am" },
				requiredMinutesByDate: { "2026-10-12": 480 },
			}),
		).toMatchObject({ drawnMinutes: 240, projectedBalanceMinutes: 360 });
	});

	it("draws half of a first afternoon and a last morning across several days", () => {
		expect(
			previewTimeOffInLieu({
				balance: balance(1200),
				absence: {
					startDate: "2026-10-12",
					startPeriod: "pm",
					endDate: "2026-10-14",
					endPeriod: "am",
				},
				requiredMinutesByDate: { "2026-10-12": 480, "2026-10-13": 480, "2026-10-14": 480 },
			}),
		).toMatchObject({ drawnMinutes: 960, projectedBalanceMinutes: 240 });
	});

	it("warns when the balance would be negative", () => {
		expect(
			previewTimeOffInLieu({
				balance: balance(240),
				absence: fullDay("2026-10-12"),
				requiredMinutesByDate: { "2026-10-12": 480 },
			}),
		).toMatchObject({ projectedBalanceMinutes: -240, wouldBeNegative: true });
	});

	it("does not draw again on days the balance already counts", () => {
		expect(
			previewTimeOffInLieu({
				balance: balance(-480, "2026-10-09"),
				absence: { ...fullDay("2026-10-09"), endDate: "2026-10-10" },
				requiredMinutesByDate: { "2026-10-09": 480, "2026-10-10": 480 },
			}),
		).toMatchObject({ drawnMinutes: 480, projectedBalanceMinutes: -960 });
	});

	it("draws nothing on days without required time", () => {
		expect(
			previewTimeOffInLieu({
				balance: balance(60),
				absence: fullDay("2026-10-11"),
				requiredMinutesByDate: {},
			}),
		).toMatchObject({ drawnMinutes: 0, projectedBalanceMinutes: 60, wouldBeNegative: false });
	});

	it("has no projection while the work balance is unavailable", () => {
		expect(
			previewTimeOffInLieu({
				balance: null,
				absence: fullDay("2026-10-12"),
				requiredMinutesByDate: { "2026-10-12": 480 },
			}),
		).toBeNull();
	});
});
