import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { splitElapsedTime } from "./elapsed-split";

const at = (value: string) => Temporal.Instant.from(value);

function shares<T>(result: ReturnType<typeof splitElapsedTime<T>>) {
	return result.map((share) => ({ value: share.value, durationMs: share.durationMs }));
}

describe("splitting work across intervals by elapsed time", () => {
	it("gives all of a period inside one interval to that interval", () => {
		const result = splitElapsedTime(
			{ start: at("2026-03-02T08:00:00Z"), end: at("2026-03-02T12:00:00Z"), durationMinutes: 240 },
			[{ start: at("2026-03-01T00:00:00Z"), end: null, value: "a" }],
		);

		expect(shares(result)).toEqual([{ value: "a", durationMs: 4 * 3_600_000 }]);
	});

	it("apportions the recorded duration by the elapsed share of each interval", () => {
		// 4 elapsed hours with a 1-hour break: 3 hours, split 1:3 at 09:00.
		const result = splitElapsedTime(
			{ start: at("2026-03-02T08:00:00Z"), end: at("2026-03-02T12:00:00Z"), durationMinutes: 180 },
			[
				{ start: null, end: at("2026-03-02T09:00:00Z"), value: "old" },
				{ start: at("2026-03-02T09:00:00Z"), end: null, value: "new" },
			],
		);

		expect(shares(result)).toEqual([
			{ value: "old", durationMs: 45 * 60_000 },
			{ value: "new", durationMs: 135 * 60_000 },
		]);
	});

	it("reports elapsed time no interval covers as uncovered", () => {
		const result = splitElapsedTime(
			{ start: at("2026-03-02T08:00:00Z"), end: at("2026-03-02T12:00:00Z"), durationMinutes: 240 },
			[{ start: at("2026-03-02T10:00:00Z"), end: at("2026-03-02T11:00:00Z"), value: "a" }],
		);

		expect(shares(result)).toEqual([
			{ value: null, durationMs: 2 * 3_600_000 },
			{ value: "a", durationMs: 3_600_000 },
			{ value: null, durationMs: 3_600_000 },
		]);
	});

	it("keeps whole milliseconds that always add up to the recorded duration", () => {
		const result = splitElapsedTime(
			{ start: at("2026-03-02T08:00:00Z"), end: at("2026-03-02T08:00:03Z"), durationMinutes: 1 },
			[
				{ start: null, end: at("2026-03-02T08:00:01Z"), value: "a" },
				{ start: at("2026-03-02T08:00:01Z"), end: at("2026-03-02T08:00:02Z"), value: "b" },
				{ start: at("2026-03-02T08:00:02Z"), end: null, value: "c" },
			],
		);

		expect(result.map((share) => share.durationMs)).toEqual([20_000, 20_000, 20_000]);
		const uneven = splitElapsedTime(
			{ start: at("2026-03-02T08:00:00Z"), end: at("2026-03-02T08:00:03Z"), durationMinutes: 1 },
			[
				{ start: null, end: at("2026-03-02T08:00:01Z"), value: "a" },
				{ start: at("2026-03-02T08:00:01Z"), end: null, value: "b" },
			],
		);
		expect(uneven.map((share) => share.durationMs)).toEqual([20_000, 40_000]);
		// 60 000 ms over 1 s : 6 s is 8 571.43 : 51 428.57; the spare millisecond goes
		// to the larger remainder.
		const sevenths = splitElapsedTime(
			{ start: at("2026-03-02T08:00:00Z"), end: at("2026-03-02T08:00:07Z"), durationMinutes: 1 },
			[
				{ start: null, end: at("2026-03-02T08:00:01Z"), value: "a" },
				{ start: at("2026-03-02T08:00:01Z"), end: null, value: "b" },
			],
		);
		expect(sevenths.map((share) => share.durationMs)).toEqual([8_571, 51_429]);
		const thirds = splitElapsedTime(
			{
				start: at("2026-03-02T08:00:00Z"),
				end: at("2026-03-02T08:00:00.003Z"),
				durationMinutes: 0,
			},
			[{ start: null, end: null, value: "a" }],
		);
		expect(thirds).toEqual([]);
	});

	it("refuses overlapping intervals", () => {
		expect(() =>
			splitElapsedTime(
				{
					start: at("2026-03-02T08:00:00Z"),
					end: at("2026-03-02T12:00:00Z"),
					durationMinutes: 240,
				},
				[
					{ start: null, end: at("2026-03-02T10:00:00Z"), value: "a" },
					{ start: at("2026-03-02T09:00:00Z"), end: null, value: "b" },
				],
			),
		).toThrow(/overlap/);
	});
});
