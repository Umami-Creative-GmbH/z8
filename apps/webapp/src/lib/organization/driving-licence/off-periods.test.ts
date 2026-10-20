import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { drivingLicenceOffPeriods, reminderOccasionFellWhileOff } from "./off-periods";

const at = (value: string) => parseInstant(value);
const iso = (periods: ReturnType<typeof drivingLicenceOffPeriods>) =>
	periods.map((p) => ({
		offAt: p.offAt.toString(),
		onAt: p.onAt?.toString() ?? null,
	}));

describe("drivingLicenceOffPeriods", () => {
	it("pairs each switch-off with the next switch-on, leaving the last one open", () => {
		expect(
			iso(
				drivingLicenceOffPeriods([
					{ enabled: true, changedAt: at("2026-01-01T10:00:00Z") },
					{ enabled: false, changedAt: at("2026-02-01T10:00:00Z") },
					{ enabled: true, changedAt: at("2026-03-01T10:00:00Z") },
					{ enabled: false, changedAt: at("2026-04-01T10:00:00Z") },
				]),
			),
		).toEqual([
			{ offAt: "2026-02-01T10:00:00Z", onAt: "2026-03-01T10:00:00Z" },
			{ offAt: "2026-04-01T10:00:00Z", onAt: null },
		]);
	});

	it("ignores policy saves that keep the value and a policy that was off before it was ever on", () => {
		expect(
			iso(
				drivingLicenceOffPeriods([
					{ enabled: false, changedAt: at("2025-12-01T10:00:00Z") },
					{ enabled: true, changedAt: at("2026-01-01T10:00:00Z") },
					{ enabled: true, changedAt: at("2026-01-15T10:00:00Z") },
					{ enabled: false, changedAt: at("2026-02-01T10:00:00Z") },
					{ enabled: false, changedAt: at("2026-02-10T10:00:00Z") },
					{ enabled: true, changedAt: at("2026-03-01T10:00:00Z") },
				]),
			),
		).toEqual([{ offAt: "2026-02-01T10:00:00Z", onAt: "2026-03-01T10:00:00Z" }]);
	});
});

describe("reminderOccasionFellWhileOff", () => {
	// Off from 12 February to 5 March (Berlin).
	const offPeriods = [{ offAt: at("2026-02-12T09:00:00Z"), onAt: at("2026-03-05T09:00:00Z") }];
	const occasion = (leadDays: number) =>
		reminderOccasionFellWhileOff({
			validThrough: "2026-03-10",
			leadDays,
			timezone: "Europe/Berlin",
			offPeriods,
		});

	it("skips an occasion whose date fell between the switch-off and the switch-on", () => {
		expect(occasion(7)).toBe(true); // due 3 March
		expect(occasion(26)).toBe(true); // due 12 February, the switch-off day
	});

	it("keeps occasions due before the switch-off, on the switch-on day or later", () => {
		expect(occasion(30)).toBe(false); // due 8 February
		expect(occasion(5)).toBe(false); // due 5 March, the switch-on day
		expect(occasion(1)).toBe(false); // due 9 March
	});

	it("reads the dates in the authorization's deadline timezone", () => {
		const lateEvening = [{ offAt: at("2026-03-02T23:30:00Z"), onAt: at("2026-03-05T09:00:00Z") }];
		// 23:30 UTC on 2 March is already 3 March in Berlin: a 2 March occasion fell while off in UTC only.
		expect(
			reminderOccasionFellWhileOff({
				validThrough: "2026-03-10",
				leadDays: 8,
				timezone: "Europe/Berlin",
				offPeriods: lateEvening,
			}),
		).toBe(false);
		expect(
			reminderOccasionFellWhileOff({
				validThrough: "2026-03-10",
				leadDays: 7,
				timezone: "Europe/Berlin",
				offPeriods: lateEvening,
			}),
		).toBe(true);
		expect(
			reminderOccasionFellWhileOff({
				validThrough: "2026-03-10",
				leadDays: 7,
				timezone: "UTC",
				offPeriods: lateEvening,
			}),
		).toBe(true);
		expect(
			reminderOccasionFellWhileOff({
				validThrough: "2026-03-10",
				leadDays: 8,
				timezone: "UTC",
				offPeriods: lateEvening,
			}),
		).toBe(true);
	});

	it("treats a period that is still open as running until now", () => {
		expect(
			reminderOccasionFellWhileOff({
				validThrough: "2026-03-10",
				leadDays: 1,
				timezone: "Europe/Berlin",
				offPeriods: [{ offAt: at("2026-02-12T09:00:00Z"), onAt: null }],
			}),
		).toBe(true);
	});
});
