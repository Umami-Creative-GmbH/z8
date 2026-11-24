import { describe, expect, it } from "vitest";
import {
	type EmploymentPeriodSnapshot,
	engagementKindOnDay,
	engagementPeriodDecidingDay,
} from "@/lib/contracts/resolve-contract";
import { Temporal } from "temporal-polyfill";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { isMinorOn } from "./age";
import { minorContractorEngagementFindings } from "./minor-contractor-review";

const localInstant = (date: string, time: string, zone: string) =>
	Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone).toInstant();

// #2022: a contractor under 18 on a day of an engagement in the window is one review item per
// engagement period (§ 1 Abs. 1 Nr. 3 JArbSchG); adults and employee stints raise none.

const timezone = "Europe/Berlin";
const window = { start: "2026-03-01", endExclusive: "2026-05-01" };

function stint(
	id: string,
	kind: "contractor" | "employee",
	from: string | null,
	until: string | null,
): EmploymentPeriodSnapshot {
	return {
		id,
		employeeId: "e1",
		status: until ? "closed" : "open",
		startedAt: from ? localInstant(from, "00:00", timezone) : null,
		startProvenance: from ? "recorded" : "unknown",
		endedAt: until ? localInstant(until, "00:00", timezone) : null,
		createdAt: localInstant("2026-01-01", "00:00", timezone),
		engagementKind: kind,
	};
}

function judge(input: {
	birthday: string | null;
	periods: EmploymentPeriodSnapshot[];
	employeeEngagementKind?: "contractor" | "employee";
}) {
	return minorContractorEngagementFindings({
		organizationId: "org",
		employeeId: "e1",
		birthday: input.birthday ? parsePlainDate(input.birthday) : null,
		employeeEngagementKind: input.employeeEngagementKind ?? "employee",
		periods: input.periods,
		timezone,
		window,
	});
}

describe("minorContractorEngagementFindings (#2022)", () => {
	it("raises one acknowledgeable warning per contractor engagement of a minor", () => {
		const findings = judge({
			birthday: "2010-06-01",
			periods: [
				stint("p1", "contractor", "2026-01-01", "2026-03-10"),
				stint("p2", "employee", "2026-03-10", "2026-04-01"),
				stint("p3", "contractor", "2026-04-01", null),
			],
		});

		expect(findings).toHaveLength(2);
		expect(findings[0]).toMatchObject({
			id: "jarbschg_minor_contractor:e1:engagement:p1",
			organizationId: "org",
			employeeId: "e1",
			domain: "youth_protection",
			kind: "jarbschg_minor_contractor",
			severity: "warning",
			subjectKey: "engagement:p1",
			periodStart: "2026-01-01",
			periodEnd: "2026-03-10",
			legalReference: "§ 1 Abs. 1 Nr. 3 JArbSchG",
			acknowledgementKind: "jarbschg_minor_contractor_review",
			blocksPublication: false,
		});
		// An open-ended engagement shows the window's end, and says it is open-ended.
		expect(findings[1]).toMatchObject({
			subjectKey: "engagement:p3",
			periodStart: "2026-04-01",
			periodEnd: "2026-05-01",
			adminDetail: { facts: { openEnded: true } },
		});
	});

	it("gives a stint that starts and ends at the same midnight its one day, not an end before its start", () => {
		const findings = judge({
			birthday: "2010-06-01",
			periods: [stint("p1", "contractor", "2026-03-10", "2026-03-10")],
		});

		// Its last day is its first: the day after it is the day after the start.
		expect(findings).toEqual([
			expect.objectContaining({
				subjectKey: "engagement:p1",
				periodStart: "2026-03-10",
				periodEnd: "2026-03-11",
			}),
		]);
	});

	it("raises nothing for an adult contractor, a minor employee or an unknown birthday", () => {
		const contractor = [stint("p1", "contractor", "2026-01-01", null)];
		expect(judge({ birthday: "2000-01-01", periods: contractor })).toEqual([]);
		expect(judge({ birthday: null, periods: contractor })).toEqual([]);
		expect(
			judge({ birthday: "2010-06-01", periods: [stint("p1", "employee", "2026-01-01", null)] }),
		).toEqual([]);
	});

	it("raises it when the contractor is under 18 on any day of the engagement in the window", () => {
		// Turns 18 on 2026-03-15: a minor on the window's first days of the engagement.
		expect(
			judge({ birthday: "2008-03-15", periods: [stint("p1", "contractor", "2025-01-01", null)] }),
		).toHaveLength(1);
		// An engagement that starts after the 18th birthday, following employment, is an adult's.
		expect(
			judge({
				birthday: "2008-03-15",
				periods: [
					stint("p0", "employee", "2025-01-01", "2026-03-15"),
					stint("p1", "contractor", "2026-03-15", null),
				],
			}),
		).toEqual([]);
		// With no stint before it, the days before its start are its contractor days (as the monitor
		// counts them), and the contractor is still a minor on those.
		expect(
			judge({ birthday: "2008-03-15", periods: [stint("p1", "contractor", "2026-03-15", null)] }),
		).toEqual([
			expect.objectContaining({ subjectKey: "engagement:p1", periodStart: "2026-03-15" }),
		]);
		// An engagement that ended before the window, followed by employment, is not judged.
		expect(
			judge({
				birthday: "2010-06-01",
				periods: [
					stint("p1", "contractor", "2025-01-01", "2026-03-01"),
					stint("p2", "employee", "2026-03-01", null),
				],
			}),
		).toEqual([]);
		// One ending on the window's first day still has that day.
		expect(
			judge({
				birthday: "2010-06-01",
				periods: [stint("p1", "contractor", "2025-01-01", "2026-03-02")],
			}),
		).toHaveLength(1);
	});

	// The youth protection monitor skips every day the resolver counts as a contractor day
	// (`engagementKindOnDay`), also days outside every stint. Each such day needs a review item.
	describe("days outside every stint, as the monitor decides them", () => {
		const reviewWindow = { start: "2026-11-17", endExclusive: "2027-01-20" };
		const judgeIn = (periods: EmploymentPeriodSnapshot[], birthday = "2010-06-01") =>
			minorContractorEngagementFindings({
				organizationId: "org",
				employeeId: "e1",
				birthday: parsePlainDate(birthday),
				employeeEngagementKind: "employee",
				periods,
				timezone,
				window: reviewWindow,
			});

		it("raises the ended stint's item while the person stays on the roster as a contractor", () => {
			// Contractor 2026-09-01 – 2026-10-31; the monitor skips a 2026-12-05 night shift.
			const findings = judgeIn([stint("p1", "contractor", "2026-09-01", "2026-11-01")]);

			expect(findings).toEqual([
				expect.objectContaining({
					subjectKey: "engagement:p1",
					periodStart: "2026-09-01",
					periodEnd: "2026-11-01",
					adminDetail: {
						facts: expect.objectContaining({
							openEnded: false,
							startRecorded: true,
							contractorAfterEnd: true,
							contractorBeforeStart: false,
						}),
					},
				}),
			]);
		});

		it("raises the first stint's item for days before a first contractor stint", () => {
			const findings = judgeIn([stint("p1", "contractor", "2027-02-01", null)]);

			expect(findings).toEqual([
				expect.objectContaining({
					subjectKey: "engagement:p1",
					periodStart: "2027-02-01",
					adminDetail: {
						facts: expect.objectContaining({
							openEnded: true,
							contractorAfterEnd: false,
							contractorBeforeStart: true,
						}),
					},
				}),
			]);
		});

		it("raises one item per deciding stint, with a fingerprint the window does not move", () => {
			const periods = [stint("p1", "contractor", "2026-09-01", "2026-11-01")];
			const [finding] = judgeIn(periods);
			const later = minorContractorEngagementFindings({
				organizationId: "org",
				employeeId: "e1",
				birthday: parsePlainDate("2010-06-01"),
				employeeEngagementKind: "employee",
				periods,
				timezone,
				window: { start: "2026-12-01", endExclusive: "2027-02-03" },
			});

			expect(later).toHaveLength(1);
			expect(later[0]?.inputFingerprint).toBe(finding.inputFingerprint);
			// A stint ending inside the window covers its own days and those after it: one item.
			expect(judgeIn([stint("p1", "contractor", "2026-09-01", "2026-12-01")])).toHaveLength(1);
		});

		it("re-opens a documentation once the window reaches days after the stint ended, then holds", () => {
			// 2026-09-01 – 2027-02-28, no later stint. Documented on 2026-11-24, while the window
			// (to 2027-01-20) still ended inside the stint.
			const periods = [stint("p1", "contractor", "2026-09-01", "2027-03-01")];
			const judgeWindow = (start: string, endExclusive: string) =>
				minorContractorEngagementFindings({
					organizationId: "org",
					employeeId: "e1",
					birthday: parsePlainDate("2010-06-01"),
					employeeEngagementKind: "employee",
					periods,
					timezone,
					window: { start, endExclusive },
				})[0];
			const documented = judgeWindow("2026-11-17", "2027-01-20");
			const insideOnly = judgeWindow("2026-12-29", "2027-03-01");
			const afterEnd = judgeWindow("2026-12-30", "2027-03-02");
			const later = judgeWindow("2027-01-20", "2027-03-25");

			expect(documented?.adminDetail?.facts).toMatchObject({ contractorAfterEnd: false });
			expect(insideOnly?.inputFingerprint).toBe(documented?.inputFingerprint);
			// From 2027-03-01 the monitor skips shifts as this stint's contractor days.
			expect(afterEnd?.adminDetail?.facts).toMatchObject({ contractorAfterEnd: true });
			expect(afterEnd?.inputFingerprint).not.toBe(documented?.inputFingerprint);
			expect(later?.inputFingerprint).toBe(afterEnd?.inputFingerprint);
		});

		it("keeps the documentation when the only days after the stint ended are an adult's", () => {
			// Turns 18 on 2026-12-20; contractor 2026-09-01 – 2027-01-31, no later stint. Documented on
			// 2026-11-24. On 2026-12-07 the window reaches 2027-02-01, after the 18th birthday.
			const periods = [stint("p1", "contractor", "2026-09-01", "2027-02-01")];
			const judgeWindow = (start: string, endExclusive: string) =>
				minorContractorEngagementFindings({
					organizationId: "org",
					employeeId: "e1",
					birthday: parsePlainDate("2008-12-20"),
					employeeEngagementKind: "employee",
					periods,
					timezone,
					window: { start, endExclusive },
				})[0];
			const documented = judgeWindow("2026-11-17", "2027-01-20");
			const later = judgeWindow("2026-11-30", "2027-02-02");

			expect(later?.adminDetail?.facts).toMatchObject({ contractorAfterEnd: false });
			expect(later?.inputFingerprint).toBe(documented?.inputFingerprint);
		});

		it("keeps the fingerprint as the window passes the start of a first stint", () => {
			const periods = [stint("p1", "contractor", "2027-02-01", null)];
			const fingerprintIn = (start: string, endExclusive: string) =>
				minorContractorEngagementFindings({
					organizationId: "org",
					employeeId: "e1",
					birthday: parsePlainDate("2010-06-01"),
					employeeEngagementKind: "employee",
					periods,
					timezone,
					window: { start, endExclusive },
				})[0]?.inputFingerprint;

			expect(fingerprintIn("2027-02-02", "2027-04-07")).toBe(
				fingerprintIn("2026-11-17", "2027-01-20"),
			);
		});

		it("re-opens a documentation once removing another stint hands it the days before the first start", () => {
			// Employee stint p0 decides the days before a first-day conversion: employee e 08–12, then
			// contractor c from 12:00. Removing p0 leaves c deciding every day before 2026-03-10.
			const at = (date: string, time: string) => localInstant(date, time, timezone);
			const p0 = stint("p0", "employee", "2026-03-01", "2026-03-05");
			const e = {
				...stint("e", "employee", "2026-03-10", null),
				startedAt: at("2026-03-10", "08:00"),
				endedAt: at("2026-03-10", "12:00"),
				status: "closed" as const,
			};
			const c = {
				...stint("c", "contractor", "2026-03-10", null),
				startedAt: at("2026-03-10", "12:00"),
			};
			const withP0 = judge({ birthday: "2010-06-01", periods: [p0, e, c] });
			const withoutP0 = judge({ birthday: "2010-06-01", periods: [e, c] });

			expect(withP0.map((finding) => finding.subjectKey)).toEqual(["engagement:c"]);
			expect(withoutP0.map((finding) => finding.subjectKey)).toEqual(["engagement:c"]);
			expect(withoutP0[0]?.inputFingerprint).not.toBe(withP0[0]?.inputFingerprint);

			// The window moving past the first start keeps it: only the data changed it.
			const later = minorContractorEngagementFindings({
				organizationId: "org",
				employeeId: "e1",
				birthday: parsePlainDate("2010-06-01"),
				employeeEngagementKind: "employee",
				periods: [e, c],
				timezone,
				window: { start: "2026-03-11", endExclusive: "2026-05-11" },
			});
			expect(later[0]?.inputFingerprint).toBe(withoutP0[0]?.inputFingerprint);
		});

		it("raises none for an adult or for a minor whose outside days are employee days", () => {
			expect(
				judgeIn([stint("p1", "contractor", "2026-09-01", "2026-11-01")], "2000-01-01"),
			).toEqual([]);
			expect(judgeIn([stint("p1", "employee", "2026-09-01", "2026-11-01")])).toEqual([]);
			expect(judgeIn([stint("p1", "employee", "2027-02-01", null)])).toEqual([]);
		});
	});

	// The review and the youth protection monitor must agree: the monitor skips the contractor days
	// `engagementKindOnDay` gives over the window (on a conversion day, only its contractor part),
	// and every such day of a minor needs a review item, one per stint that decides it.
	describe("agrees with the days the youth protection monitor skips", () => {
		/** A review item, worked out by hand. */
		interface Item {
			readonly subject: string;
			/** A day of a minor after the stint ended is its contractor day. */
			readonly afterEnd: boolean;
			/** A day of a minor before the first stint started is its contractor day. */
			readonly beforeStart: boolean;
		}
		interface Case {
			readonly name: string;
			readonly birthday: string;
			readonly periods: EmploymentPeriodSnapshot[];
			readonly employeeEngagementKind?: "contractor" | "employee";
			readonly items: readonly Item[];
			/**
			 * The window's contractor days of a minor by the subject that decides them, listed by hand
			 * as `[first day, day after the last]` ranges.
			 */
			readonly minorContractorDays?: Readonly<Record<string, readonly [string, string][]>>;
		}
		const minor = "2010-06-01";
		const item = (subject: string, afterEnd = false, beforeStart = false): Item => ({
			subject: `engagement:${subject}`,
			afterEnd,
			beforeStart,
		});
		const cases: Case[] = [
			{
				name: "an employee stint inside an open-ended contractor stint",
				birthday: minor,
				periods: [
					stint("p1", "contractor", "2026-01-01", null),
					stint("p2", "employee", "2026-03-10", "2026-04-01"),
				],
				items: [item("p1")],
				minorContractorDays: {
					"engagement:p1": [
						["2026-03-01", "2026-03-10"],
						["2026-04-01", "2026-05-01"],
					],
				},
			},
			{
				name: "a contractor stint ending the day an employee stint starts",
				birthday: minor,
				periods: [
					stint("p1", "contractor", "2026-01-01", "2026-03-15"),
					stint("p2", "employee", "2026-03-15", null),
				],
				items: [item("p1")],
				minorContractorDays: { "engagement:p1": [["2026-03-01", "2026-03-15"]] },
			},
			{
				name: "the same rehire for someone turning 18 that day",
				birthday: "2008-03-15",
				periods: [
					stint("p1", "contractor", "2026-01-01", "2026-03-15"),
					stint("p2", "employee", "2026-03-15", null),
				],
				items: [item("p1")],
			},
			{
				name: "an employee stint ending the day a contractor stint starts, turning 18 that day",
				birthday: "2008-03-15",
				periods: [
					stint("p1", "employee", "2026-01-01", "2026-03-15"),
					stint("p2", "contractor", "2026-03-15", null),
				],
				items: [],
				minorContractorDays: {},
			},
			{
				name: "a gap between two contractor stints",
				birthday: minor,
				periods: [
					stint("p1", "contractor", "2026-01-01", "2026-03-10"),
					stint("p2", "contractor", "2026-04-01", null),
				],
				// The gap is the earlier stint's: the one that ended last before it.
				items: [item("p1", true), item("p2")],
				minorContractorDays: {
					"engagement:p1": [["2026-03-01", "2026-04-01"]],
					"engagement:p2": [["2026-04-01", "2026-05-01"]],
				},
			},
			{
				name: "a gap between two contractor stints, 18 during the gap",
				birthday: "2008-03-20",
				periods: [
					stint("p1", "contractor", "2026-01-01", "2026-03-10"),
					stint("p2", "contractor", "2026-04-01", null),
				],
				items: [item("p1", true)],
				minorContractorDays: { "engagement:p1": [["2026-03-01", "2026-03-20"]] },
			},
			{
				name: "a contractor stint ending on the 18th birthday, with no later stint",
				birthday: "2008-03-10",
				periods: [stint("p1", "contractor", "2025-01-01", "2026-03-10")],
				// Its days after the end are an adult's: they need no review of their own.
				items: [item("p1")],
				minorContractorDays: { "engagement:p1": [["2026-03-01", "2026-03-10"]] },
			},
			{
				name: "a contractor stint with no recorded start, then a recorded contractor stint",
				birthday: minor,
				periods: [
					stint("p1", "contractor", null, "2026-03-20"),
					stint("p2", "contractor", "2026-04-01", null),
				],
				items: [item("p1", true), item("p2")],
			},
			{
				name: "a contractor stint with no recorded start, then a recorded employee stint",
				birthday: minor,
				periods: [
					stint("p1", "contractor", null, "2026-03-20"),
					stint("p2", "employee", "2026-04-01", null),
				],
				items: [item("p1", true)],
			},
			{
				name: "an employee stint with no recorded start, then a recorded contractor stint",
				birthday: minor,
				periods: [
					stint("p1", "employee", null, "2026-03-20"),
					stint("p2", "contractor", "2026-04-01", null),
				],
				items: [item("p2")],
			},
			{
				name: "only days before a first contractor stint",
				birthday: minor,
				periods: [stint("p1", "contractor", "2026-06-01", null)],
				items: [item("p1", false, true)],
				minorContractorDays: { "engagement:p1": [["2026-03-01", "2026-05-01"]] },
			},
			{
				name: "only days after a contractor stint ended, 18 inside the window",
				birthday: "2008-04-15",
				periods: [stint("p1", "contractor", "2025-01-01", "2026-03-01")],
				items: [item("p1", true)],
			},
			{
				name: "only days after a contractor stint ended, 18 before the window",
				birthday: "2008-02-15",
				periods: [stint("p1", "contractor", "2025-01-01", "2026-03-01")],
				items: [],
			},
			{
				name: "a contractor with no stint, 18 inside the window",
				birthday: "2008-04-15",
				periods: [],
				employeeEngagementKind: "contractor",
				items: [item("unrecorded")],
				minorContractorDays: { "engagement:unrecorded": [["2026-03-01", "2026-04-15"]] },
			},
			{
				name: "an employee with no stint, 18 inside the window",
				birthday: "2008-04-15",
				periods: [],
				employeeEngagementKind: "employee",
				items: [],
			},
		];

		const daysOf = (ranges: readonly [string, string][]) =>
			ranges.flatMap(([from, until]) => {
				const days: string[] = [];
				for (let day = parsePlainDate(from); day.toString() < until; day = day.add({ days: 1 })) {
					days.push(day.toString());
				}
				return days;
			});

		/** The window's contractor days, as `engagementKindOnDay` decides them. */
		function monitorContractorDays(c: Case): PlainDate[] {
			const days: PlainDate[] = [];
			const until = parsePlainDate(window.endExclusive);
			for (
				let day = parsePlainDate(window.start);
				day.until(until).sign > 0;
				day = day.add({ days: 1 })
			) {
				const kind = engagementKindOnDay({
					periods: c.periods,
					day,
					employeeCalendarTimezone: timezone,
					employeeEngagementKind: c.employeeEngagementKind ?? "employee",
				});
				if (kind === "contractor") days.push(day);
			}
			return days;
		}

		it.each(cases)("$name", (c) => {
			const findings = judge({
				birthday: c.birthday,
				periods: c.periods,
				employeeEngagementKind: c.employeeEngagementKind,
			});
			const minorDays = monitorContractorDays(c).filter((day) =>
				isMinorOn(parsePlainDate(c.birthday), day),
			);
			const raised = findings.map((finding) => finding.subjectKey);

			// Exactly the items worked out by hand, one per subject, with their facts.
			expect(new Set(raised).size).toBe(raised.length);
			expect(
				findings
					.map((finding) => ({
						subject: finding.subjectKey,
						afterEnd: finding.adminDetail?.facts?.contractorAfterEnd,
						beforeStart: finding.adminDetail?.facts?.contractorBeforeStart,
					}))
					.sort((left, right) => left.subject.localeCompare(right.subject)),
			).toEqual([...c.items].sort((left, right) => left.subject.localeCompare(right.subject)));

			if (c.minorContractorDays) {
				// The days the monitor skips for a minor, listed by hand, and one item per stint
				// deciding them.
				expect(minorDays.map(String)).toEqual(
					daysOf(Object.values(c.minorContractorDays).flat()).sort(),
				);
				expect([...raised].sort()).toEqual(Object.keys(c.minorContractorDays).sort());
			} else {
				// One item per stint deciding a day the monitor skips for a minor.
				const decidingSubjects = new Set(
					minorDays.map(
						(day) =>
							`engagement:${engagementPeriodDecidingDay(c.periods, day, timezone)?.period.id ?? "unrecorded"}`,
					),
				);
				expect([...raised].sort()).toEqual([...decidingSubjects].sort());
			}
		});
	});

	it("treats an employee with no recorded stint by their engagement kind", () => {
		const [finding] = judge({
			birthday: "2010-06-01",
			periods: [],
			employeeEngagementKind: "contractor",
		});
		expect(finding).toMatchObject({
			id: "jarbschg_minor_contractor:e1:engagement:unrecorded",
			subjectKey: "engagement:unrecorded",
			periodEnd: "2026-05-01",
		});
		expect(judge({ birthday: "2010-06-01", periods: [] })).toEqual([]);
	});

	it("fingerprints the engagement period and the birthday, not the window", () => {
		const base = judge({
			birthday: "2010-06-01",
			periods: [stint("p1", "contractor", "2026-01-01", null)],
		})[0];
		const fingerprintOf = (birthday: string, period: EmploymentPeriodSnapshot) =>
			judge({ birthday, periods: [period] })[0]?.inputFingerprint;

		expect(fingerprintOf("2010-06-01", stint("p1", "contractor", "2026-01-01", null))).toBe(
			base.inputFingerprint,
		);
		expect(
			minorContractorEngagementFindings({
				organizationId: "org",
				employeeId: "e1",
				birthday: parsePlainDate("2010-06-01"),
				employeeEngagementKind: "employee",
				periods: [stint("p1", "contractor", "2026-01-01", null)],
				timezone,
				window: { start: "2026-03-02", endExclusive: "2026-05-02" },
			})[0]?.inputFingerprint,
		).toBe(base.inputFingerprint);
		expect(fingerprintOf("2010-07-01", stint("p1", "contractor", "2026-01-01", null))).not.toBe(
			base.inputFingerprint,
		);
		expect(
			fingerprintOf("2010-06-01", stint("p1", "contractor", "2026-01-01", "2026-06-01")),
		).not.toBe(base.inputFingerprint);
		expect(fingerprintOf("2010-06-01", stint("p1", "contractor", "2026-02-01", null))).not.toBe(
			base.inputFingerprint,
		);
	});
});
