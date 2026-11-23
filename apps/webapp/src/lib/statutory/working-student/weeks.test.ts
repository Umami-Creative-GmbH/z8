import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import { buildStatutoryThresholdTable, type StatutoryThresholdRow } from "../thresholds";
import {
	evaluateWorkingStudentEmployee,
	type WorkingStudentEmployeeFacts,
	type WorkingStudentWorkInterval,
} from "./weeks";

const TZ = "Europe/Berlin";

function baseline(
	key: StatutoryThresholdRow["key"],
	value: number,
	unit: StatutoryThresholdRow["unit"],
): StatutoryThresholdRow {
	return {
		key,
		countryCode: "DE",
		value,
		unit,
		currency: null,
		effectiveFromDate: "2015-01-01",
		effectiveUntilDate: null,
		legalReference: "§ 6 Abs. 1 Nr. 3 SGB V",
		notes: null,
	};
}

const thresholds = buildStatutoryThresholdTable(
	["de_working_student_weekly_minutes", "de_working_student_max_over_20h_weeks_per_12m"],
	[
		baseline("de_working_student_weekly_minutes", 1200, "minutes"),
		baseline("de_working_student_max_over_20h_weeks_per_12m", 26, "weeks"),
	],
);

let refs = 0;
/** Completed work (or a shift) from `start` to `end` on an organization-local day. */
function work(
	date: string,
	start: string,
	end: string,
	source: WorkingStudentWorkInterval["source"] = "work",
): WorkingStudentWorkInterval {
	const from = Temporal.PlainDateTime.from(`${date}T${start}`).toZonedDateTime(TZ).toInstant();
	let to = Temporal.PlainDateTime.from(`${date}T${end}`).toZonedDateTime(TZ).toInstant();
	if (Temporal.Instant.compare(to, from) <= 0) to = to.add({ hours: 24 });
	return {
		source,
		ref: `r${++refs}`,
		start: from,
		end: to,
		netMinutes: from.until(to).total("minutes"),
	};
}

/** The same daily work on each weekday Monday–Friday of the week starting `monday`. */
function weekdays(monday: string, start: string, end: string, source?: "work" | "shift") {
	return [0, 1, 2, 3, 4].map((offset) =>
		work(Temporal.PlainDate.from(monday).add({ days: offset }).toString(), start, end, source),
	);
}

function mondays(first: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) =>
		Temporal.PlainDate.from(first).add({ weeks: index }).toString(),
	);
}

function facts(overrides: Partial<WorkingStudentEmployeeFacts>): WorkingStudentEmployeeFacts {
	return {
		employeeId: "student",
		intervals: [],
		lectureFreePeriods: [],
		priorOver20hWeeks: [],
		isWorkingStudentWeek: () => true,
		...overrides,
	};
}

function evaluate(employee: WorkingStudentEmployeeFacts, from: string, toExclusive: string) {
	return evaluateWorkingStudentEmployee({
		organizationId: "org",
		timezone: TZ,
		judgedWeeks: { from, toExclusive },
		thresholds,
		preferences: DEFAULT_STATUTORY_PREFERENCES,
		facts: employee,
	});
}

// Mon 2026-03-02 … Sun 2026-03-08 is ISO week 2026-W10.
const W10 = "2026-03-02";
const W11 = "2026-03-09";

describe("working student 20-hour lecture-period rule", () => {
	it("flags a lecture week above 20 hours of weekday daytime work", () => {
		const { findings, weeks } = evaluate(
			facts({ intervals: weekdays(W10, "09:00", "14:00") }),
			W10,
			W11,
		);

		expect(weeks.at(-1)).toMatchObject({
			weekStart: W10,
			subjectKey: "2026-W10",
			totalMinutes: 1500,
			coreMinutes: 1500,
			overLimit: true,
			lectureBreach: true,
		});
		const lecture = findings.find((f) => f.kind === "working_student_lecture_week");
		expect(lecture).toMatchObject({
			id: "working_student_lecture_week:student:2026-W10",
			domain: "working_student",
			severity: "critical",
			subjectKey: "2026-W10",
			periodStart: W10,
			periodEnd: W11,
			legalReference: "§ 6 Abs. 1 Nr. 3 SGB V",
			summary: {
				tier: "exceeded",
				usedPercent: 125,
				used: { unit: "minutes", value: 1500 },
				limit: { unit: "minutes", value: 1200 },
				remaining: { unit: "minutes", value: 0 },
			},
			acknowledgementKind: "working_student_over_20h_week",
		});
		expect(lecture?.inputFingerprint).toMatch(/^v1:/);
	});

	it("allows exactly 20 hours of lecture-week daytime work", () => {
		const { findings, weeks } = evaluate(
			facts({ intervals: weekdays(W10, "09:00", "13:00") }),
			W10,
			W11,
		);
		expect(weeks.at(-1)).toMatchObject({ totalMinutes: 1200, overLimit: false });
		expect(findings).toEqual([]);
	});

	it("warns rather than flags critical while the excess is only planned", () => {
		const { findings } = evaluate(
			facts({
				intervals: [
					...weekdays(W10, "09:00", "12:00"),
					...weekdays(W10, "12:00", "14:00", "shift"),
				],
			}),
			W10,
			W11,
		);
		expect(findings.find((f) => f.kind === "working_student_lecture_week")?.severity).toBe(
			"warning",
		);
	});

	it.each([
		["weekend", [...weekdays(W10, "09:00", "13:00"), work("2026-03-07", "10:00", "15:00")]],
		["evening", [...weekdays(W10, "09:00", "12:00"), ...weekdays(W10, "18:00", "20:00")]],
		["night", [...weekdays(W10, "09:00", "12:00"), ...weekdays(W10, "22:00", "00:00")]],
	])("permits a >20 h lecture week whose excess is %s work", (_, intervals) => {
		const { findings, weeks } = evaluate(facts({ intervals }), W10, W11);
		const week = weeks.at(-1);
		expect(week?.overLimit).toBe(true);
		expect(week?.lectureBreach).toBe(false);
		expect(week?.coreMinutes).toBeLessThanOrEqual(1200);
		expect(findings.filter((f) => f.kind === "working_student_lecture_week")).toEqual([]);
	});

	it("splits work that runs from daytime into the evening at 18:00", () => {
		const { weeks } = evaluate(facts({ intervals: weekdays(W10, "13:00", "19:00") }), W10, W11);
		expect(weeks.at(-1)).toMatchObject({
			totalMinutes: 1800,
			coreMinutes: 1500,
			eveningWeekendMinutes: 300,
			lectureBreach: true,
		});
	});

	it("permits >20 h weekday work during a lecture-free period", () => {
		const { findings, weeks } = evaluate(
			facts({
				intervals: weekdays(W10, "08:00", "16:00"),
				lectureFreePeriods: [{ id: "lf", startsOn: "2026-02-16", endsOn: "2026-04-12" }],
			}),
			W10,
			W11,
		);
		expect(weeks.at(-1)).toMatchObject({
			totalMinutes: 2400,
			coreMinutes: 0,
			lectureFreeMinutes: 2400,
			overLimit: true,
			lectureBreach: false,
		});
		expect(findings.filter((f) => f.kind === "working_student_lecture_week")).toEqual([]);
	});

	it("judges the lecture days of a week a lecture-free period ends in", () => {
		const { weeks } = evaluate(
			facts({
				intervals: weekdays(W10, "08:00", "16:00"),
				// Lecture-free until Wednesday; Thursday and Friday are lecture days.
				lectureFreePeriods: [{ id: "lf", startsOn: "2026-02-16", endsOn: "2026-03-04" }],
			}),
			W10,
			W11,
		);
		expect(weeks.at(-1)).toMatchObject({
			coreMinutes: 960,
			lectureFreeMinutes: 1440,
			lectureBreach: false,
		});
	});

	it("deducts breaks proportionally from net work minutes", () => {
		const interval = { ...work(W10, "09:00", "15:00"), netMinutes: 330 };
		const { weeks } = evaluate(facts({ intervals: [interval] }), W10, W11);
		expect(weeks.at(-1)?.totalMinutes).toBe(330);
	});

	it("judges nothing in weeks the employee is not a working student", () => {
		const { findings } = evaluate(
			facts({
				intervals: weekdays(W10, "09:00", "17:00"),
				isWorkingStudentWeek: () => false,
			}),
			W10,
			W11,
		);
		expect(findings).toEqual([]);
	});

	it("keeps the fingerprint for the same inputs and changes it when an interval changes", () => {
		const intervals = weekdays(W10, "09:00", "14:00");
		const fingerprint = (employee: WorkingStudentEmployeeFacts) =>
			evaluate(employee, W10, W11).findings.find((f) => f.kind === "working_student_lecture_week")
				?.inputFingerprint;
		const original = fingerprint(facts({ intervals }));

		expect(fingerprint(facts({ intervals }))).toBe(original);
		expect(
			fingerprint(
				facts({ intervals: [...intervals.slice(1), { ...intervals[0], netMinutes: 320 }] }),
			),
		).not.toBe(original);
		expect(
			fingerprint(
				facts({
					intervals,
					// A lecture-free Saturday leaves the breach as it was but is an evaluated input.
					lectureFreePeriods: [{ id: "lf", startsOn: "2026-03-07", endsOn: "2026-03-07" }],
				}),
			),
		).not.toBe(original);
	});
});

describe("working student rolling 26-week ceiling", () => {
	// 27 consecutive weeks of 25 h weekend-heavy (permitted) work ending with ISO week 2026-W10.
	const first = Temporal.PlainDate.from(W10).subtract({ weeks: 26 }).toString();
	const permittedWeek = (monday: string) => [
		...weekdays(monday, "09:00", "13:00"),
		work(Temporal.PlainDate.from(monday).add({ days: 5 }).toString(), "09:00", "14:00"),
	];

	function ceiling(result: ReturnType<typeof evaluate>, subjectKey = "2026-W10") {
		return result.findings.find(
			(f) => f.kind === "working_student_26_week_ceiling" && f.subjectKey === subjectKey,
		);
	}

	it("lets the 26th >20 h week pass with a warning and flags the 27th critical", () => {
		const twentySix = evaluate(
			facts({ intervals: mondays(first, 27).slice(1).flatMap(permittedWeek) }),
			W10,
			W11,
		);
		expect(twentySix.weeks.at(-1)?.rollingOver20hWeeks).toBe(26);
		expect(ceiling(twentySix)).toMatchObject({
			id: "working_student_26_week_ceiling:student:2026-W10",
			severity: "warning",
			summary: {
				tier: "critical",
				usedPercent: 100,
				used: { unit: "weeks", value: 26 },
				limit: { unit: "weeks", value: 26 },
				remaining: { unit: "weeks", value: 0 },
			},
			acknowledgementKind: "working_student_over_20h_week",
		});

		const twentySeven = evaluate(
			facts({ intervals: mondays(first, 27).flatMap(permittedWeek) }),
			W10,
			W11,
		);
		expect(ceiling(twentySeven)).toMatchObject({
			severity: "critical",
			summary: {
				tier: "exceeded",
				used: { unit: "weeks", value: 27 },
				remaining: { unit: "weeks", value: 0 },
			},
		});
	});

	it("counts prior-employer >20 h weeks and ages each one out after 52 weeks", () => {
		const own = mondays(first, 27).slice(16).flatMap(permittedWeek); // 11 own weeks
		// 16 prior-employer weeks: the oldest starts 52 weeks before W10, so it has aged out.
		const priorStart = Temporal.PlainDate.from(W10).subtract({ weeks: 52 }).toString();
		const prior = [
			{
				id: "offset",
				from: priorStart,
				until: Temporal.PlainDate.from(priorStart).add({ weeks: 16 }).toString(),
			},
		];
		const result = evaluate(facts({ intervals: own, priorOver20hWeeks: prior }), W10, W11);
		expect(result.weeks.at(-1)).toMatchObject({ rollingOver20hWeeks: 26, priorOver20hWeek: false });
		expect(ceiling(result)?.severity).toBe("warning");

		// One week later the second prior week ages out as well.
		const next = evaluate(
			facts({
				intervals: [...own, ...permittedWeek(W11)],
				priorOver20hWeeks: prior,
			}),
			W11,
			Temporal.PlainDate.from(W11).add({ weeks: 1 }).toString(),
		);
		expect(next.weeks.at(-1)?.rollingOver20hWeeks).toBe(26);
	});

	it("raises no ceiling finding for a week at or under 20 h", () => {
		const intervals = [
			...mondays(first, 26).flatMap(permittedWeek),
			...weekdays(W10, "09:00", "12:00"),
		];
		const result = evaluate(facts({ intervals }), W10, W11);
		expect(result.weeks.at(-1)?.rollingOver20hWeeks).toBe(26);
		expect(ceiling(result)).toBeUndefined();
	});

	it("warns from the organization's warning tier", () => {
		const intervals = mondays(first, 27).slice(6).flatMap(permittedWeek); // 21 weeks = 80 %
		const result = evaluate(facts({ intervals }), W10, W11);
		expect(ceiling(result)).toMatchObject({
			severity: "warning",
			summary: { tier: "warning", usedPercent: 80, remaining: { unit: "weeks", value: 5 } },
		});
	});
});
