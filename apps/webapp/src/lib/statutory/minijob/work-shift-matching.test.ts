import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { matchWorkToShifts, workBelongsToShift } from "./work-shift-matching";

const ZONE = "Europe/Berlin";
const NOW = Temporal.Instant.from("2026-11-23T12:00:00Z");

function at(date: string, time: string): Temporal.Instant {
	return Temporal.ZonedDateTime.from(`${date}T${time}[${ZONE}]`).toInstant();
}

function shift(id: string, date: string, startTime: string, endTime: string) {
	return {
		id,
		interval: shiftInterval({ date: Temporal.PlainDate.from(date), startTime, endTime }, ZONE),
	};
}

function work(id: string, start: Temporal.Instant, end: Temporal.Instant | null) {
	return { id, start, end };
}

/** The ids of the shifts each work belongs to, earliest shift first. */
function matched(
	shifts: ReturnType<typeof shift>[],
	works: ReturnType<typeof work>[],
	now = NOW,
): Record<string, string[]> {
	const result = matchWorkToShifts(shifts, works, now);
	return Object.fromEntries(
		works.map((w) => [w.id, (result.get(w) ?? []).map((s) => s.id)] as const),
	);
}

describe("matchWorkToShifts (#1989)", () => {
	it("matches a night shift's work across midnight, but not the next night's shift", () => {
		const shifts = [
			shift("night-1", "2026-11-20", "22:00", "06:00"),
			shift("night-2", "2026-11-21", "22:00", "06:00"),
		];
		const works = [work("w", at("2026-11-20", "21:55"), at("2026-11-21", "06:05"))];

		expect(matched(shifts, works)).toEqual({ w: ["night-1"] });
	});

	it("matches one clock-in over back-to-back shifts to both, earliest first", () => {
		const shifts = [
			shift("afternoon", "2026-11-20", "13:00", "17:00"),
			shift("morning", "2026-11-20", "09:00", "13:00"),
			shift("next-day", "2026-11-21", "09:00", "13:00"),
		];
		const works = [work("w", at("2026-11-20", "08:58"), at("2026-11-20", "17:02"))];

		expect(matched(shifts, works)).toEqual({ w: ["morning", "afternoon"] });
	});

	it("matches an early clock-in within two hours, and an open clock-in from earlier once it overlaps", () => {
		const shifts = [shift("s", "2026-11-23", "09:00", "17:00")];
		const works = [
			work("early", at("2026-11-23", "07:15"), at("2026-11-23", "17:00")),
			// Ended before the shift started, more than two hours ahead of it.
			work("before", at("2026-11-23", "06:30"), at("2026-11-23", "08:30")),
			// Still running at now (13:00 Berlin): it overlaps the shift.
			work("open", at("2026-11-23", "06:30"), null),
			work("after", at("2026-11-23", "17:00"), at("2026-11-23", "18:00")),
		];

		expect(matched(shifts, works)).toEqual({
			early: ["s"],
			before: [],
			open: ["s"],
			after: [],
		});
	});

	it("agrees with matching every work against every shift", () => {
		// A deterministic month of shifts and work around them, including overlaps and gaps.
		const shifts: ReturnType<typeof shift>[] = [];
		const works: ReturnType<typeof work>[] = [];
		let seed = 7;
		const next = (n: number) => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed % n;
		};
		const day = Temporal.PlainDate.from("2026-10-01");
		for (let d = 0; d < 40; d++) {
			const date = day.add({ days: d }).toString();
			const hour = next(24);
			const length = 1 + next(12);
			const end = (hour + length) % 24;
			const pad = (h: number) => `${String(h).padStart(2, "0")}:${next(2) ? "30" : "00"}`;
			shifts.push(shift(`s${d}`, date, pad(hour), pad(end)));
			const start = at(date, pad(next(24)));
			works.push(
				work(`w${d}`, start, next(10) === 0 ? null : start.add({ minutes: 15 + next(16 * 60) })),
			);
		}
		const now = at("2026-10-20", "12:00");

		const result = matchWorkToShifts(shifts, works, now);
		// The sample has matches to agree on, not only misses.
		expect(result.size).toBeGreaterThan(5);
		for (const w of works) {
			const expected = shifts
				.filter((s) => workBelongsToShift(s.interval, w, now))
				.sort((a, b) => Temporal.Instant.compare(a.interval.start, b.interval.start))
				.map((s) => s.id);
			expect([w.id, (result.get(w) ?? []).map((s) => s.id)]).toEqual([w.id, expected]);
		}
	});
});
