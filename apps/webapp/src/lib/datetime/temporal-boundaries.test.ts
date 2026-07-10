import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	AmbiguousWallClockTimeError,
	localDayRange,
	localMonthRange,
	localWeekRange,
	NonexistentWallClockTimeError,
	resolveManualWallClock,
	resolveScheduledWallClock,
} from "./temporal-boundaries";

describe("local calendar instant ranges", () => {
	it("uses Berlin's 23-hour spring-transition day", () => {
		const range = localDayRange("2026-03-29", "Europe/Berlin");

		expect(range.start).toBeInstanceOf(Temporal.Instant);
		expect(range.start.toString()).toBe("2026-03-28T23:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-03-29T22:00:00Z");
		expect(range.endExclusive.epochMilliseconds - range.start.epochMilliseconds).toBe(
			23 * 60 * 60 * 1000,
		);
	});

	it("uses New York's 25-hour fall-transition day", () => {
		const range = localDayRange("2026-11-01", "America/New_York");

		expect(range.start.toString()).toBe("2026-11-01T04:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-11-02T05:00:00Z");
		expect(range.endExclusive.epochMilliseconds - range.start.epochMilliseconds).toBe(
			25 * 60 * 60 * 1000,
		);
	});

	it("converts Kathmandu local midnight using its 45-minute offset", () => {
		const range = localDayRange("2026-07-10", "Asia/Kathmandu");

		expect(range.start.toString()).toBe("2026-07-09T18:15:00Z");
		expect(range.endExclusive.toString()).toBe("2026-07-10T18:15:00Z");
	});

	it("builds Sunday-start weeks with an exclusive next-Sunday boundary", () => {
		const range = localWeekRange("2026-07-08", "UTC", "sunday");

		expect(range.start.toString()).toBe("2026-07-05T00:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-07-12T00:00:00Z");
	});

	it("builds Monday-start weeks with an exclusive next-Monday boundary", () => {
		const range = localWeekRange("2026-07-08", "UTC", "monday");

		expect(range.start.toString()).toBe("2026-07-06T00:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-07-13T00:00:00Z");
	});

	it("includes all of leap February using a March start boundary", () => {
		const range = localMonthRange("2024-02-15", "UTC");

		expect(range.start.toString()).toBe("2024-02-01T00:00:00Z");
		expect(range.endExclusive.toString()).toBe("2024-03-01T00:00:00Z");
		expect(range.endExclusive.epochMilliseconds - range.start.epochMilliseconds).toBe(
			29 * 24 * 60 * 60 * 1000,
		);
	});

	it("rejects invalid dates, timezones, and week-start values before returning a range", () => {
		expect(() => localDayRange("2026-02-30", "UTC")).toThrow();
		expect(() => localDayRange("2026-07-10", "UTC+05:45")).toThrow();
		expect(() => localWeekRange("2026-07-10", "UTC", "tuesday" as "monday")).toThrow();
		expect(() => localMonthRange("2026-07-10T00:00", "UTC")).toThrow();
	});
});

describe("manual wall-clock resolution", () => {
	it.each([
		"reject",
		"earlier",
		"later",
	] as const)("always rejects Berlin's nonexistent spring time with %s disambiguation", (disambiguation) => {
		expect(() =>
			resolveManualWallClock({
				date: "2026-03-29",
				time: "02:30",
				timezone: "Europe/Berlin",
				disambiguation,
			}),
		).toThrow(NonexistentWallClockTimeError);
	});

	it("rejects Berlin's ambiguous fall time when no occurrence is selected", () => {
		expect(() =>
			resolveManualWallClock({
				date: "2026-10-25",
				time: "02:30",
				timezone: "Europe/Berlin",
				disambiguation: "reject",
			}),
		).toThrow(AmbiguousWallClockTimeError);
	});

	it("classifies Lord Howe's 30-minute spring transition as a gap", () => {
		expect(() =>
			resolveManualWallClock({
				date: "2026-10-04",
				time: "02:15",
				timezone: "Australia/Lord_Howe",
				disambiguation: "later",
			}),
		).toThrow(NonexistentWallClockTimeError);
	});

	it("classifies Lord Howe's 30-minute fall transition as a fold", () => {
		const input = {
			date: "2026-04-05",
			time: "01:45",
			timezone: "Australia/Lord_Howe",
		} as const;

		expect(() => resolveManualWallClock({ ...input, disambiguation: "reject" })).toThrow(
			AmbiguousWallClockTimeError,
		);

		const earlier = resolveManualWallClock({ ...input, disambiguation: "earlier" });
		const later = resolveManualWallClock({ ...input, disambiguation: "later" });

		expect(later.epochMilliseconds - earlier.epochMilliseconds).toBe(30 * 60 * 1000);
	});

	it("classifies Apia's skipped date as a gap", () => {
		expect(() =>
			resolveManualWallClock({
				date: "2011-12-30",
				time: "12:00",
				timezone: "Pacific/Apia",
				disambiguation: "earlier",
			}),
		).toThrow(NonexistentWallClockTimeError);
	});

	it.each([
		["earlier", "2026-10-25T00:30:00Z", "+02:00"],
		["later", "2026-10-25T01:30:00Z", "+01:00"],
	] as const)("selects the %s occurrence of Berlin's fall fold", (disambiguation, instant, offset) => {
		const result = resolveManualWallClock({
			date: "2026-10-25",
			time: "02:30",
			timezone: "Europe/Berlin",
			disambiguation,
		});

		expect(result).toBeInstanceOf(Temporal.ZonedDateTime);
		expect(result.toInstant().toString()).toBe(instant);
		expect(result.offset).toBe(offset);
	});

	it("resolves an ordinary manual wall-clock time without changing it", () => {
		const result = resolveManualWallClock({
			date: "2026-07-10",
			time: "09:15",
			timezone: "Europe/Berlin",
			disambiguation: "reject",
		});

		expect(result.toPlainDateTime().toString()).toBe("2026-07-10T09:15:00");
		expect(result.toInstant().toString()).toBe("2026-07-10T07:15:00Z");
	});

	it.each([
		["date shape", { date: "2026-7-10", time: "09:15", timezone: "Europe/Berlin" }],
		["calendar date", { date: "2026-02-30", time: "09:15", timezone: "Europe/Berlin" }],
		["time shape", { date: "2026-07-10", time: "9:15", timezone: "Europe/Berlin" }],
		["seconds", { date: "2026-07-10", time: "09:15:00", timezone: "Europe/Berlin" }],
		["clock time", { date: "2026-07-10", time: "24:00", timezone: "Europe/Berlin" }],
		["fixed offset", { date: "2026-07-10", time: "09:15", timezone: "+05:45" }],
		["timezone", { date: "2026-07-10", time: "09:15", timezone: "Invalid/Zone" }],
	] as const)("rejects invalid manual %s input", (_description, input) => {
		expect(() => resolveManualWallClock({ ...input, disambiguation: "reject" })).toThrow();
	});
});

describe("scheduled wall-clock resolution", () => {
	it("uses compatible disambiguation to move a spring gap time forward", () => {
		const result = resolveScheduledWallClock({
			date: "2026-03-29",
			time: "02:30",
			timezone: "Europe/Berlin",
		});

		expect(result.toPlainDateTime().toString()).toBe("2026-03-29T03:30:00");
		expect(result.toInstant().toString()).toBe("2026-03-29T01:30:00Z");
	});

	it("uses compatible disambiguation to select the earlier fall-fold occurrence", () => {
		const result = resolveScheduledWallClock({
			date: "2026-10-25",
			time: "02:30",
			timezone: "Europe/Berlin",
		});

		expect(result.toInstant().toString()).toBe("2026-10-25T00:30:00Z");
		expect(result.offset).toBe("+02:00");
	});

	it("uses compatible disambiguation for Lord Howe's 30-minute gap", () => {
		const result = resolveScheduledWallClock({
			date: "2026-10-04",
			time: "02:15",
			timezone: "Australia/Lord_Howe",
		});

		expect(result.toPlainDateTime().equals(Temporal.PlainDateTime.from("2026-10-04T02:45"))).toBe(
			true,
		);
	});

	it("uses compatible disambiguation to move an Apia skipped date forward", () => {
		const result = resolveScheduledWallClock({
			date: "2011-12-30",
			time: "12:00",
			timezone: "Pacific/Apia",
		});

		expect(result.toPlainDateTime().equals(Temporal.PlainDateTime.from("2011-12-31T12:00"))).toBe(
			true,
		);
	});

	it("strictly validates scheduled date, time, and named IANA timezone inputs", () => {
		expect(() =>
			resolveScheduledWallClock({
				date: "2026-03-29T00:00",
				time: "02:30",
				timezone: "Europe/Berlin",
			}),
		).toThrow();
		expect(() =>
			resolveScheduledWallClock({
				date: "2026-03-29",
				time: "02:30:00",
				timezone: "Europe/Berlin",
			}),
		).toThrow();
		expect(() =>
			resolveScheduledWallClock({
				date: "2026-03-29",
				time: "02:30",
				timezone: "+05:45",
			}),
		).toThrow();
	});
});
