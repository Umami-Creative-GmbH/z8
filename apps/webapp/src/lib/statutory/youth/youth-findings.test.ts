import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { JarbschgLimits } from "./jarbschg-rules";
import { youthFindingsOf } from "./youth-findings";
import { type YouthShiftRecord, type YouthWorkRecord, youthIntervalsOf } from "./youth-intervals";

const ZONE = "Europe/Berlin";
const LIMITS: JarbschgLimits = {
	maxDailyMinutes: 480,
	maxDailyCompensatoryMinutes: 510,
	maxWeeklyMinutes: 2400,
	maxDaysPerWeek: 5,
	minRestMinutes: 720,
	breakAfter270Minutes: 30,
	breakAfter360Minutes: 60,
	minBreakSegmentMinutes: 15,
	maxUninterruptedMinutes: 270,
	nightStartMinuteOfDay: 1200,
	nightEndMinuteOfDay: 360,
};
const EMPLOYEE = "employee-1";

const at = (date: string, time: string): Instant =>
	Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(ZONE).toInstant();

function shift(id: string, date: string, start: string, end: string): YouthShiftRecord {
	const startAt = at(date, start);
	let endAt = at(date, end);
	if (Temporal.Instant.compare(endAt, startAt) <= 0) {
		endAt = at(parsePlainDate(date).add({ days: 1 }).toString(), end);
	}
	return { id, employeeId: EMPLOYEE, date: parsePlainDate(date), start: startAt, end: endAt };
}

function work(id: string, start: Instant, end: Instant | null): YouthWorkRecord {
	return {
		id,
		employeeId: EMPLOYEE,
		start,
		end,
		durationMinutes: end ? Math.round(start.until(end).total({ unit: "minutes" })) : null,
	};
}

function findings(input: {
	work?: YouthWorkRecord[];
	shifts?: YouthShiftRecord[];
	now: Instant;
	judged?: { start: string; endExclusive: string };
}) {
	return youthFindingsOf({
		organizationId: "org-1",
		employeeId: EMPLOYEE,
		birthday: parsePlainDate("2011-01-01"),
		timezone: ZONE,
		intervals: youthIntervalsOf({
			work: input.work ?? [],
			shifts: input.shifts ?? [],
			now: input.now,
			timezone: ZONE,
			limitsOn: () => LIMITS,
		}),
		judged: input.judged ?? { start: "2026-03-02", endExclusive: "2026-03-09" },
		limitsOn: () => LIMITS,
		holidays: new Set(),
		blockPublish: true,
	});
}

const nightOf = (list: ReturnType<typeof findings>) =>
	list.find((finding) => finding.kind === "jarbschg_night_work");

describe("youthIntervalsOf", () => {
	it("counts completed work of today alongside today's later shifts", () => {
		// Tuesday: 06:00–12:00 worked, an evening shift 14:00–20:00 still to come. Monday ended
		// at 20:00, so the morning start broke the rest period.
		const result = findings({
			work: [
				work("mon", at("2026-03-02", "14:00"), at("2026-03-02", "20:00")),
				work("tue", at("2026-03-03", "06:00"), at("2026-03-03", "12:00")),
			],
			shifts: [shift("eve", "2026-03-03", "14:00", "20:00")],
			now: at("2026-03-03", "13:00"),
		});
		expect(result.map((finding) => [finding.kind, finding.subjectKey])).toEqual(
			expect.arrayContaining([
				["jarbschg_rest_period", "work:tue"],
				["jarbschg_daily_max", "shift:eve"],
			]),
		);
	});

	it("keeps an open clock-in up to now plus the rest of its shift, past midnight too", () => {
		// A night shift 22:00–02:00 clocked in at 22:00, still running at 01:00.
		const night = shift("night", "2026-03-03", "22:00", "02:00");
		const result = findings({
			work: [work("open", at("2026-03-03", "22:00"), null)],
			shifts: [night],
			now: at("2026-03-04", "01:00"),
		});
		expect(nightOf(result)).toMatchObject({
			subjectKey: "shift:night",
			summary: { used: { unit: "minutes", value: 240 } },
			blocksPublication: false,
		});
	});

	it("does not count a shift twice when its work is recorded, and keeps a second shift that day", () => {
		const result = findings({
			work: [work("am", at("2026-03-02", "08:00"), at("2026-03-02", "12:00"))],
			shifts: [
				shift("am", "2026-03-02", "08:00", "12:00"),
				shift("pm", "2026-03-02", "15:00", "20:00"),
			],
			now: at("2026-03-02", "13:00"),
		});
		// 4 h worked + 5 h planned (4.5 h of work) = 8.5 h: within the 8.5 h allowance this week.
		expect(result.map((finding) => finding.kind)).toEqual([]);
		const doubled = findings({
			work: [work("am", at("2026-03-02", "08:00"), at("2026-03-02", "12:00"))],
			shifts: [
				shift("am", "2026-03-02", "08:00", "12:00"),
				shift("pm", "2026-03-02", "14:00", "20:00"),
			],
			now: at("2026-03-02", "13:00"),
		});
		expect(doubled.map((finding) => finding.kind)).toEqual(["jarbschg_daily_max"]);
	});
});

describe("sector exception fingerprints", () => {
	const planned = shift("late", "2026-03-03", "17:00", "21:00");
	const plannedFinding = () =>
		nightOf(findings({ shifts: [planned], now: at("2026-03-01", "12:00") }));

	it("stay current when the shift is worked as planned", () => {
		const worked = nightOf(
			findings({
				work: [work("w", at("2026-03-03", "17:05"), at("2026-03-03", "21:00"))],
				shifts: [planned],
				now: at("2026-03-04", "09:00"),
			}),
		);
		expect(worked?.subjectKey).toBe("shift:late");
		expect(worked?.inputFingerprint).toBe(plannedFinding()?.inputFingerprint);
	});

	it("stay current while the shift is being worked, as time passes and past midnight", () => {
		const open = (now: Instant) =>
			nightOf(
				findings({
					work: [work("w", at("2026-03-03", "17:00"), null)],
					shifts: [planned],
					now,
				}),
			)?.inputFingerprint;
		expect(open(at("2026-03-03", "18:00"))).toBe(plannedFinding()?.inputFingerprint);
		expect(open(at("2026-03-03", "20:59"))).toBe(plannedFinding()?.inputFingerprint);
		const fromMonday = (now: Instant) =>
			nightOf(
				findings({
					shifts: [planned],
					now,
					judged: { start: "2026-03-03", endExclusive: "2026-03-04" },
				}),
			)?.inputFingerprint;
		expect(fromMonday(at("2026-03-02", "23:59"))).toBe(fromMonday(at("2026-03-03", "00:01")));
	});

	it("change when the shift moves", () => {
		const moved = nightOf(
			findings({
				shifts: [shift("late", "2026-03-03", "17:30", "21:00")],
				now: at("2026-03-01", "12:00"),
			}),
		);
		expect(moved?.inputFingerprint).not.toBe(plannedFinding()?.inputFingerprint);
	});

	it("change when the work overruns the shift into the night", () => {
		const overrun = nightOf(
			findings({
				work: [work("w", at("2026-03-03", "17:00"), at("2026-03-04", "01:30"))],
				shifts: [planned],
				now: at("2026-03-04", "09:00"),
			}),
		);
		expect(overrun?.subjectKey).toBe("shift:late");
		expect(overrun?.summary.used).toEqual({ unit: "minutes", value: 330 });
		expect(overrun?.inputFingerprint).not.toBe(plannedFinding()?.inputFingerprint);
	});

	it("do not depend on the judged days when a shift's work spans midnight", () => {
		// A night shift 22:00–02:00 clocked as two pieces, before and after midnight.
		const night = shift("night", "2026-03-03", "22:00", "02:00");
		const pieces = (secondEnd: string) => [
			work("before", at("2026-03-03", "22:00"), at("2026-03-04", "00:00")),
			work("after", at("2026-03-04", "00:00"), at("2026-03-04", secondEnd)),
		];
		const fingerprint = (secondEnd: string, judged: { start: string; endExclusive: string }) =>
			nightOf(
				findings({
					work: pieces(secondEnd),
					shifts: [night],
					now: at("2026-03-05", "09:00"),
					judged,
				}),
			)?.inputFingerprint;
		const tuesday = { start: "2026-03-03", endExclusive: "2026-03-04" };
		const wednesday = { start: "2026-03-04", endExclusive: "2026-03-05" };
		const week = { start: "2026-03-02", endExclusive: "2026-03-09" };
		const planned = nightOf(findings({ shifts: [night], now: at("2026-03-01", "12:00") }));

		expect(fingerprint("02:00", tuesday)).toBe(planned?.inputFingerprint);
		expect(fingerprint("02:00", wednesday)).toBe(planned?.inputFingerprint);
		expect(fingerprint("02:00", week)).toBe(planned?.inputFingerprint);
		// The second piece overruns to 03:30: stale whichever day is judged.
		expect(fingerprint("03:30", tuesday)).not.toBe(planned?.inputFingerprint);
		expect(fingerprint("03:30", tuesday)).toBe(fingerprint("03:30", wednesday));
		expect(fingerprint("03:30", week)).toBe(fingerprint("03:30", wednesday));
	});
});
