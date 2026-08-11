import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import {
	type Clock,
	calendarYearAt,
	compareInstants,
	comparePlainDates,
	dateFromInstant,
	instantFromDate,
	isInstant,
	parseInstant,
	parsePlainDate,
	parsePlainTimeMinute,
	systemClock,
} from "./temporal-core";

describe("temporal core", () => {
	it.each([
		{
			instant: "2025-12-31T10:30:00Z",
			timezone: "Pacific/Kiritimati",
			expectedYear: 2026,
		},
		{
			instant: "2026-01-01T00:30:00Z",
			timezone: "America/Los_Angeles",
			expectedYear: 2025,
		},
	])(
		"resolves $instant to organization calendar year $expectedYear in $timezone",
		({ instant, timezone, expectedYear }) => {
			expect(calendarYearAt(parseInstant(instant), timezone)).toBe(
				expectedYear,
			);
		},
	);

	it("parses fixed UTC instants", () => {
		const instant = parseInstant("2024-01-15T10:30:00.123Z");

		expect(instant).toBeInstanceOf(Temporal.Instant);
		expect(instant.toString()).toBe("2024-01-15T10:30:00.123Z");
		expect(parseInstant("2024-01-15T10:30Z").toString()).toBe(
			"2024-01-15T10:30:00Z",
		);
	});

	it("normalizes instants with explicit offsets", () => {
		expect(parseInstant("2024-01-15T11:30:00.123+01:00").toString()).toBe(
			"2024-01-15T10:30:00.123Z",
		);
	});

	it.each([
		["zone-less", "2024-01-15T10:30:00.123"],
		["expanded year", "+002024-01-15T10:30:00Z"],
		["signed year", "+2024-01-15T10:30:00Z"],
		["compact offset", "2024-01-15T10:30:00+0100"],
		["short offset", "2024-01-15T10:30:00+01"],
		["offset seconds", "2024-01-15T10:30:00+01:00:30"],
	])("rejects %s instant input", (_description, value) => {
		expect(() => parseInstant(value)).toThrow();
	});

	it("rejects leap-second instants instead of normalizing them", () => {
		expect(() => parseInstant("2016-12-31T23:59:60Z")).toThrow();
	});

	it("rejects non-string instant values", () => {
		expect(() => parseInstant(undefined as unknown as string)).toThrow();
	});

	it("parses valid leap dates", () => {
		const date = parsePlainDate("2024-02-29");

		expect(date).toBeInstanceOf(Temporal.PlainDate);
		expect(date.toString()).toBe("2024-02-29");
	});

	it("rejects invalid leap dates and date-time input as plain dates", () => {
		expect(() => parsePlainDate("2023-02-29")).toThrow();
		expect(() => parsePlainDate("2024-02-29T00:00:00")).toThrow();
	});

	it("parses exact minute times and rejects seconds", () => {
		expect(parsePlainTimeMinute("23:59").toString()).toBe("23:59:00");
		expect(() => parsePlainTimeMinute("23:59:00")).toThrow();
		expect(() => parsePlainTimeMinute("24:00")).toThrow();
	});

	it("rejects invalid JavaScript Dates", () => {
		expect(() => instantFromDate(new Date(Number.NaN))).toThrow();
	});

	it("round-trips JavaScript Dates and instants", () => {
		const date = new Date("2024-01-15T10:30:00.123Z");
		const instant = instantFromDate(date);

		expect(instant).toBeInstanceOf(Temporal.Instant);
		expect(dateFromInstant(instant).toISOString()).toBe(date.toISOString());
	});

	it("rejects instants with sub-millisecond precision before Date conversion", () => {
		const instant = Temporal.Instant.from("2026-07-10T12:30:00.123000001Z");

		expect(() => dateFromInstant(instant)).toThrow();
	});

	it("supports deterministic Clock injection", () => {
		class FixedClock implements Clock {
			readonly #instant = parseInstant("2024-03-31T00:30:00.000Z");

			nowInstant() {
				return this.#instant;
			}
		}

		const readCurrentInstant = (clock: Clock) => clock.nowInstant();

		expect(readCurrentInstant(new FixedClock()).toString()).toBe(
			"2024-03-31T00:30:00Z",
		);
		expect(Object.isFrozen(systemClock)).toBe(true);
		expect(systemClock.nowInstant()).toBeInstanceOf(Temporal.Instant);
	});

	it("normalizes the system clock to millisecond precision", () => {
		const nativeNow = vi
			.spyOn(Temporal.Now, "instant")
			.mockReturnValue(Temporal.Instant.from("2026-07-13T08:15:30.123456789Z"));

		try {
			expect(systemClock.nowInstant().toString()).toBe(
				"2026-07-13T08:15:30.123Z",
			);
		} finally {
			nativeNow.mockRestore();
		}
	});

	it("compares instants", () => {
		const earlier = parseInstant("2024-01-15T10:30:00.000Z");
		const later = parseInstant("2024-01-15T10:30:00.001Z");

		expect(compareInstants(earlier, later)).toBe(-1);
		expect(compareInstants(later, earlier)).toBe(1);
		expect(compareInstants(earlier, earlier)).toBe(0);
	});

	it("recognizes only objects with Temporal Instant internal slots", () => {
		const instant = parseInstant("2024-01-15T10:30:00Z");
		const coercible = {
			toString: () => "2024-01-15T10:30:00Z",
		};

		expect(isInstant(instant)).toBe(true);
		expect(isInstant(coercible)).toBe(false);
		expect(isInstant(instant.toZonedDateTimeISO("UTC"))).toBe(false);
		expect(isInstant(Object.create(Temporal.Instant.prototype))).toBe(false);
		expect(isInstant(new Proxy(instant, {}))).toBe(false);
	});

	it("compares plain dates", () => {
		const earlier = parsePlainDate("2024-01-15");
		const later = parsePlainDate("2024-01-16");

		expect(comparePlainDates(earlier, later)).toBe(-1);
		expect(comparePlainDates(later, earlier)).toBe(1);
		expect(comparePlainDates(earlier, earlier)).toBe(0);
	});
});
