import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { causedBlockingFindings } from "../scheduling/caused-blocking";
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
	birthday?: string;
}) {
	return youthFindingsOf({
		organizationId: "org-1",
		employeeId: EMPLOYEE,
		birthday: parsePlainDate(input.birthday ?? "2011-01-01"),
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
				shift("pm", "2026-03-02", "13:00", "18:00"),
			],
			now: at("2026-03-02", "13:00"),
		});
		// 4 h worked + 5 h planned (4.5 h of work) = 8.5 h: within the 8.5 h allowance this week.
		expect(result.map((finding) => finding.kind)).toEqual([]);
		const doubled = findings({
			work: [work("am", at("2026-03-02", "08:00"), at("2026-03-02", "12:00"))],
			shifts: [
				shift("am", "2026-03-02", "08:00", "12:00"),
				shift("pm", "2026-03-02", "12:00", "18:00"),
			],
			now: at("2026-03-02", "13:00"),
		});
		expect(doubled.map((finding) => finding.kind)).toEqual(["jarbschg_daily_max"]);
	});

	describe("a shift the minor clocked out of for lunch", () => {
		// Monday to Friday 08:00–17:00: 8 h of work and the 60 min break (§ 11 JArbSchG) each day.
		const week = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"].map(
			(date) => shift(date, date, "08:00", "17:00"),
		);
		const mondayMinutes = (records: YouthWorkRecord[], now: Instant) =>
			youthIntervalsOf({ work: records, shifts: week, now, timezone: ZONE, limitsOn: () => LIMITS })
				.filter(
					(interval) => Temporal.Instant.compare(interval.start, at("2026-03-03", "00:00")) < 0,
				)
				.reduce((total, interval) => total + interval.workMinutes, 0);

		it("keeps the planned 8 h day, without findings, throughout the break", () => {
			const morning = [work("am", at("2026-03-02", "08:00"), at("2026-03-02", "12:00"))];
			for (const time of ["12:00", "12:15", "12:29"]) {
				const now = at("2026-03-02", time);
				expect(mondayMinutes(morning, now)).toBe(480);
				expect(findings({ work: morning, shifts: week, now })).toEqual([]);
			}
		});

		it("keeps the planned 8 h day once the minor clocks back in after a 30 min break", () => {
			// 08:00–12:00 worked, 30 min break, clocked in again at 12:30: the shift still owes 30 min
			// of its 60 min break, so 4 h of work remain.
			for (const clockIn of ["12:30", "12:30:42"]) {
				const records = [
					work("am", at("2026-03-02", "08:00"), at("2026-03-02", "12:00")),
					work("pm", at("2026-03-02", clockIn), null),
				];
				for (const time of ["12:30:50", "12:31", "14:00:17", "16:59:59"]) {
					const now = at("2026-03-02", time);
					expect(mondayMinutes(records, now)).toBe(480);
					expect(findings({ work: records, shifts: week, now })).toEqual([]);
				}
			}
		});

		it("keeps the figures and fingerprints of a long day steady after clocking back in", () => {
			// 06:00–12:00 worked, back at 12:30:42: 6 h worked and 4 h of the shift still to come.
			const records = [
				work("am", at("2026-03-02", "06:00"), at("2026-03-02", "12:00")),
				work("pm", at("2026-03-02", "12:30:42"), null),
			];
			const fingerprints = (now: Instant) =>
				findings({ work: records, shifts: week, now }).map((finding) => [
					finding.kind,
					finding.summary.used,
					finding.inputFingerprint,
				]);
			const first = fingerprints(at("2026-03-02", "12:31"));
			expect(mondayMinutes(records, at("2026-03-02", "12:31"))).toBe(600);
			expect(first.map(([kind]) => kind)).toEqual(
				expect.arrayContaining(["jarbschg_daily_max", "jarbschg_weekly_max"]),
			);
			for (const time of ["12:31:30", "13:45:05", "16:59:59"]) {
				expect(mondayMinutes(records, at("2026-03-02", time))).toBe(600);
				expect(fingerprints(at("2026-03-02", time))).toEqual(first);
			}
		});

		it("still flags a day the minor started two hours early", () => {
			const early = [work("am", at("2026-03-02", "06:00"), at("2026-03-02", "12:00"))];
			const now = at("2026-03-02", "12:15");
			// 6 h worked, and the 4 h of the shift still to come after the break.
			expect(mondayMinutes(early, now)).toBe(600);
			expect(findings({ work: early, shifts: week, now }).map((finding) => finding.kind)).toEqual(
				expect.arrayContaining(["jarbschg_daily_max", "jarbschg_weekly_max"]),
			);
		});
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

	it("stay current while an open clock-in overruns its shift within one material step", () => {
		// Clocked in at 17:00 for the 17:00–21:00 shift, still working past its end.
		const running = (now: Instant) =>
			nightOf(
				findings({
					work: [work("w", at("2026-03-03", "17:00"), null)],
					shifts: [planned],
					now,
				}),
			)?.inputFingerprint;
		const acknowledged = running(at("2026-03-03", "21:20"));
		expect(acknowledged).not.toBe(plannedFinding()?.inputFingerprint);
		expect(running(at("2026-03-03", "21:21"))).toBe(acknowledged);
		expect(running(at("2026-03-03", "21:29:59"))).toBe(acknowledged);
		expect(
			nightOf(
				findings({
					work: [work("w", at("2026-03-03", "17:00"), at("2026-03-03", "21:27"))],
					shifts: [planned],
					now: at("2026-03-04", "09:00"),
				}),
			)?.inputFingerprint,
		).toBe(acknowledged);
		expect(running(at("2026-03-03", "21:40"))).not.toBe(acknowledged);
	});

	describe("of work without a planned shift", () => {
		const fingerprintOf = (
			record: YouthWorkRecord,
			now: Instant,
			kind: "jarbschg_night_work" | "jarbschg_saturday_work" = "jarbschg_night_work",
		) =>
			findings({ work: [record], now }).find((finding) => finding.kind === kind)?.inputFingerprint;
		const started = at("2026-03-03", "17:00");
		// Acknowledged while the clock-in runs at 20:50: 50 night minutes, the span up to 21:00.
		const acknowledged = fingerprintOf(work("w", started, null), at("2026-03-03", "20:50"));

		it("stay current while the clock-in runs within the acknowledged span and ends there", () => {
			expect(acknowledged).toBeDefined();
			expect(fingerprintOf(work("w", started, null), at("2026-03-03", "20:58"))).toBe(acknowledged);
			expect(
				fingerprintOf(work("w", started, at("2026-03-03", "21:00")), at("2026-03-04", "09:00")),
			).toBe(acknowledged);
		});

		it("go stale when the work runs further into the night", () => {
			expect(
				fingerprintOf(work("w", started, at("2026-03-03", "23:30")), at("2026-03-04", "09:00")),
			).not.toBe(acknowledged);
			expect(fingerprintOf(work("w", started, null), at("2026-03-03", "21:20"))).not.toBe(
				acknowledged,
			);
		});

		it("go stale when Saturday work is extended", () => {
			// Saturday 7 March 2026.
			const saturday = (end: string) =>
				fingerprintOf(
					work("sat", at("2026-03-07", "10:00"), at("2026-03-07", end)),
					at("2026-03-08", "09:00"),
					"jarbschg_saturday_work",
				);
			expect(saturday("14:00")).toBeDefined();
			// Within the same 15-minute step: the same work for the exception.
			expect(saturday("13:50")).toBe(saturday("14:00"));
			expect(saturday("18:00")).not.toBe(saturday("14:00"));
		});
	});

	describe("of a shift the minor clocked out of for lunch", () => {
		// Saturday 7 March 2026, clocked in 08:00, out for lunch at 11:00.
		const morning = work("am", at("2026-03-07", "08:00"), at("2026-03-07", "11:00"));
		const saturdayOf = (end: string, now: Instant, records: YouthWorkRecord[] = [morning]) =>
			findings({
				work: records,
				shifts: [shift("sat", "2026-03-07", "08:00", end)],
				now,
			}).filter((finding) => finding.kind === "jarbschg_saturday_work");

		it("covers the worked piece and the planned rest of the shift", () => {
			// 08:00–11:00 worked, 11:30–14:00 still planned.
			expect(saturdayOf("14:00", at("2026-03-07", "11:30"))).toEqual([
				expect.objectContaining({ subjectKey: "shift:sat", coveredMinutes: 330 }),
			]);
		});

		it("is caused when the shift is extended during the break", () => {
			const now = at("2026-03-07", "11:30");
			const before = saturdayOf("14:00", now);
			const after = saturdayOf("18:00", now);
			expect(after).toEqual([expect.objectContaining({ coveredMinutes: 570 })]);
			expect(causedBlockingFindings(before, after).map((finding) => finding.kind)).toEqual([
				"jarbschg_saturday_work",
			]);
		});

		it("keeps the covered minutes of a shift worked as planned across clocking out, and an unrelated edit is not caused", () => {
			const planned = saturdayOf("14:00", at("2026-03-07", "07:00"), []);
			const working = saturdayOf("14:00", at("2026-03-07", "10:00"), [
				work("am", at("2026-03-07", "08:00"), null),
			]);
			const clockedOut = saturdayOf("14:00", at("2026-03-07", "11:00"));
			for (const list of [planned, working, clockedOut]) {
				expect(list).toEqual([expect.objectContaining({ coveredMinutes: 360 })]);
			}
			// A notes edit during the break: the same findings before and after.
			const now = at("2026-03-07", "11:20");
			expect(causedBlockingFindings(saturdayOf("14:00", now), saturdayOf("14:00", now))).toEqual(
				[],
			);
		});

		it("is caused when a 24 December shift is extended past 14:00 during the break", () => {
			// Thursday 24 December 2026: 10:00–12:00 worked, the rest of 10:00–15:00 still planned.
			const now = at("2026-12-24", "12:30");
			const eve = (end: string) =>
				findings({
					work: [work("am", at("2026-12-24", "10:00"), at("2026-12-24", "12:00"))],
					shifts: [shift("eve", "2026-12-24", "10:00", end)],
					now,
					judged: { start: "2026-12-21", endExclusive: "2026-12-28" },
				}).filter((finding) => finding.kind === "jarbschg_holiday_prohibited");
			expect(eve("15:00")).toEqual([
				expect.objectContaining({
					subjectKey: "shift:eve",
					summary: expect.objectContaining({ used: { unit: "minutes", value: 60 } }),
				}),
			]);
			expect(causedBlockingFindings(eve("15:00"), eve("19:00")).map((f) => f.kind)).toEqual([
				"jarbschg_holiday_prohibited",
			]);
			expect(causedBlockingFindings(eve("15:00"), eve("15:00"))).toEqual([]);
		});

		it("covers every night minute of a night shift clocked out of before midnight", () => {
			// Tuesday 22:00–02:00, 22:00–23:00 worked, the rest still planned from 23:30.
			const night = nightOf(
				findings({
					work: [work("first", at("2026-03-03", "22:00"), at("2026-03-03", "23:00"))],
					shifts: [shift("night", "2026-03-03", "22:00", "02:00")],
					now: at("2026-03-03", "23:30"),
				}),
			);
			expect(night).toMatchObject({
				subjectKey: "shift:night",
				summary: { used: { unit: "minutes", value: 210 } },
				coveredMinutes: 210,
			});
		});
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

describe("night work and the § 14 Abs. 2, 3, 5, 6 JArbSchG sector hours", () => {
	// Tuesday 3 March 2026; ages on that day.
	const BIRTHDAY_15 = "2011-01-01";
	const BIRTHDAY_16 = "2010-01-01";
	const BIRTHDAY_17 = "2009-01-01";
	const nightFinding = (birthday: string, start: string, end: string) =>
		nightOf(
			findings({
				birthday,
				shifts: [shift("s", "2026-03-03", start, end)],
				now: at("2026-03-01", "12:00"),
			}),
		);
	const SECTOR = "jarbschg_sector_exception";

	it("is acknowledgeable for a 15-year-old until 21:00 (Abs. 5 S. 1, transport), never later", () => {
		expect(nightFinding(BIRTHDAY_15, "15:00", "20:45")?.acknowledgementKind).toBe(SECTOR);
		const late = nightFinding(BIRTHDAY_15, "15:00", "21:30");
		expect(late).toMatchObject({ legalReference: "§ 14 JArbSchG", blocksPublication: true });
		expect(late?.acknowledgementKind).toBeNull();
	});

	it("is never acknowledgeable for a child under 15 (§ 7 S. 2 is deliberately not supported)", () => {
		// Turns 15 on Wednesday 4 March: still 14 on Tuesday.
		const child = nightFinding("2011-03-04", "15:00", "20:45");
		expect(child).toMatchObject({ acknowledgementKind: null, blocksPublication: true });
		expect(nightFinding("2011-03-04", "05:00", "11:00")?.acknowledgementKind).toBeNull();
		// Turns 15 that Tuesday: the 15-year-old's hours apply.
		expect(nightFinding("2011-03-03", "15:00", "20:45")?.acknowledgementKind).toBe(SECTOR);
	});

	it("judges the morning by the age on that morning: a 15th birthday allows 05:00", () => {
		const dawn = findings({
			birthday: "2011-03-04",
			shifts: [shift("dawn", "2026-03-04", "05:00", "11:00")],
			now: at("2026-03-01", "12:00"),
		}).find((finding) => finding.kind === "jarbschg_night_work");
		expect(dawn?.acknowledgementKind).toBe(SECTOR);
	});

	it("is acknowledgeable for a 15-year-old from 05:00 (Abs. 6, hot workplaces), never earlier", () => {
		expect(nightFinding(BIRTHDAY_15, "05:00", "11:00")?.acknowledgementKind).toBe(SECTOR);
		expect(nightFinding(BIRTHDAY_15, "04:45", "11:00")?.acknowledgementKind).toBeNull();
	});

	it("is acknowledgeable for a 16-year-old until 23:30 (Abs. 5 S. 2, multi-shift), never later", () => {
		expect(nightFinding(BIRTHDAY_16, "16:00", "23:00")?.acknowledgementKind).toBe(SECTOR);
		expect(nightFinding(BIRTHDAY_16, "16:00", "23:20")?.acknowledgementKind).toBe(SECTOR);
		expect(nightFinding(BIRTHDAY_16, "16:00", "23:45")).toMatchObject({
			acknowledgementKind: null,
			summary: { used: { unit: "minutes", value: 225 } },
			// Only the 15 minutes past 23:30 lie outside the hours: the planner names those.
			beyondSectorHours: 15,
		});
		expect(nightFinding(BIRTHDAY_16, "16:00", "23:20")).not.toHaveProperty("beyondSectorHours");
	});

	it("is acknowledgeable from 05:00 at 16, from 04:00 at 17 (bakeries), never earlier", () => {
		expect(nightFinding(BIRTHDAY_16, "05:00", "11:00")?.acknowledgementKind).toBe(SECTOR);
		expect(nightFinding(BIRTHDAY_16, "04:00", "10:00")?.acknowledgementKind).toBeNull();
		expect(nightFinding(BIRTHDAY_17, "04:00", "10:00")?.acknowledgementKind).toBe(SECTOR);
		expect(nightFinding(BIRTHDAY_17, "03:45", "10:00")?.acknowledgementKind).toBeNull();
	});

	it("judges the evening by the age that day: a 16th birthday the next day does not help", () => {
		// Turns 16 on Wednesday 4 March: on Tuesday evening a 15-year-old's 21:00 applies.
		expect(nightFinding("2010-03-04", "20:00", "22:00")?.acknowledgementKind).toBeNull();
	});

	it("judges the evening by the age that day: a 16th birthday that day allows 23:30", () => {
		expect(nightFinding("2010-03-03", "16:00", "23:30")?.acknowledgementKind).toBe(SECTOR);
	});

	it("is never acknowledgeable at 02:00, whatever the age", () => {
		for (const birthday of [BIRTHDAY_15, BIRTHDAY_16, BIRTHDAY_17]) {
			const finding = nightFinding(birthday, "22:00", "03:00");
			expect(finding?.acknowledgementKind).toBeNull();
			expect(finding?.blocksPublication).toBe(true);
		}
	});

	it("judges the morning by the age on that morning: a 17th birthday at midnight", () => {
		// Turns 17 on Wednesday 4 March: Tuesday 16:00–23:00 and Wednesday from 04:00 are covered.
		const result = findings({
			birthday: "2009-03-04",
			shifts: [
				shift("eve", "2026-03-03", "16:00", "23:00"),
				shift("dawn", "2026-03-04", "04:00", "10:00"),
			],
			now: at("2026-03-01", "12:00"),
		}).filter((finding) => finding.kind === "jarbschg_night_work");
		expect(result.map((finding) => [finding.subjectKey, finding.acknowledgementKind])).toEqual([
			["shift:eve", "jarbschg_sector_exception"],
			["shift:dawn", "jarbschg_sector_exception"],
		]);
	});

	it("judges the morning by the age on that morning: the day before a 17th birthday blocks 04:00", () => {
		// Turns 17 on Wednesday 4 March: on Tuesday morning a 16-year-old's 05:00 applies.
		expect(nightFinding("2009-03-04", "04:00", "10:00")?.acknowledgementKind).toBeNull();
	});

	it("loses its acknowledgeability once recorded work runs past the sector hours", () => {
		const result = findings({
			birthday: BIRTHDAY_16,
			shifts: [shift("s", "2026-03-03", "16:00", "22:30")],
			work: [work("w", at("2026-03-03", "16:00"), at("2026-03-03", "23:40"))],
			now: at("2026-03-04", "08:00"),
		});
		expect(nightOf(result)).toMatchObject({ subjectKey: "shift:s", acknowledgementKind: null });
	});
});

describe("the § 12 JArbSchG shift span", () => {
	const spanOf = (pmEnd: string) =>
		findings({
			shifts: [
				shift("am", "2026-03-03", "07:00", "11:00"),
				shift("pm", "2026-03-03", "15:00", pmEnd),
			],
			now: at("2026-03-01", "12:00"),
		}).find((finding) => finding.kind === "jarbschg_shift_span");

	it("is judged by its day, whichever shift ends it, and cites § 12", () => {
		const span = spanOf("19:00");
		expect(span).toMatchObject({
			subjectKey: "shift:pm",
			periodStart: "2026-03-03",
			legalReference: "§ 12 JArbSchG",
			summary: { used: { unit: "minutes", value: 720 }, limit: { unit: "minutes", value: 600 } },
			blocksPublication: true,
		});
		const earlier = { ...(span as NonNullable<typeof span>), subjectKey: "shift:am", id: "other" };
		expect(causedBlockingFindings([earlier], [span as NonNullable<typeof span>])).toEqual([]);
	});

	it("may be acknowledged as a sector exception up to 11 h, never beyond", () => {
		expect(spanOf("17:30")?.acknowledgementKind).toBe("jarbschg_sector_exception");
		expect(spanOf("18:00")?.acknowledgementKind).toBe("jarbschg_sector_exception");
		expect(spanOf("18:15")?.acknowledgementKind).toBeNull();
	});

	describe("acknowledged as a sector exception", () => {
		// Hospitality: 08:00–12:00 and 15:00–18:30, a 630 min span.
		const plannedShifts = [
			shift("am", "2026-03-03", "08:00", "12:00"),
			shift("pm", "2026-03-03", "15:00", "18:30"),
		];
		const spanFinding = (worked?: { amStart: string; pmEnd: string }) =>
			findings({
				shifts: plannedShifts,
				work: worked
					? [
							work("am", at("2026-03-03", worked.amStart), at("2026-03-03", "12:00")),
							work("pm", at("2026-03-03", "15:00"), at("2026-03-03", worked.pmEnd)),
						]
					: [],
				now: worked ? at("2026-03-03", "21:00") : at("2026-03-01", "12:00"),
			}).find((finding) => finding.kind === "jarbschg_shift_span");
		const acknowledged = () => spanFinding()?.inputFingerprint;

		it("stays current while the day is worked roughly as planned", () => {
			expect(spanFinding()).toMatchObject({
				summary: { used: { unit: "minutes", value: 630 } },
				acknowledgementKind: "jarbschg_sector_exception",
			});
			expect(spanFinding({ amStart: "07:57", pmEnd: "18:25" })?.inputFingerprint).toBe(
				acknowledged(),
			);
			expect(spanFinding({ amStart: "07:57", pmEnd: "18:30" })?.inputFingerprint).toBe(
				acknowledged(),
			);
			expect(spanFinding({ amStart: "08:00", pmEnd: "18:44" })?.inputFingerprint).toBe(
				acknowledged(),
			);
		});

		it("goes stale once the span grows by a material step of 15 minutes", () => {
			expect(spanFinding({ amStart: "08:00", pmEnd: "18:45" })?.inputFingerprint).not.toBe(
				acknowledged(),
			);
			expect(spanFinding({ amStart: "07:45", pmEnd: "18:30" })?.inputFingerprint).not.toBe(
				acknowledged(),
			);
		});

		it("goes stale when the day's shifts change", () => {
			const moved = findings({
				shifts: [
					shift("am", "2026-03-03", "08:30", "12:00"),
					shift("pm", "2026-03-03", "15:00", "19:00"),
				],
				now: at("2026-03-01", "12:00"),
			}).find((finding) => finding.kind === "jarbschg_shift_span");
			expect(moved?.inputFingerprint).not.toBe(acknowledged());
		});

		it("is never acknowledgeable past 11 hours", () => {
			const long = spanFinding({ amStart: "07:50", pmEnd: "19:00" });
			expect(long?.summary.used?.value).toBe(670);
			expect(long?.acknowledgementKind).toBeNull();
			expect(long?.inputFingerprint).not.toBe(acknowledged());
		});
	});
});
