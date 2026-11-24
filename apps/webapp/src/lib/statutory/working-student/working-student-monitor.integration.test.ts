/**
 * #1991: the working-student monitor against PostgreSQL — the 20-hour lecture-period rule with its
 * lecture-free, evening and weekend exceptions, and the rolling 26-week ceiling with prior-employer
 * weeks aging out of the 52-week window.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import {
	recordEmployeeStatutoryOffset,
	recordEmployeeStudyPeriod,
	voidEmployeeStudyPeriod,
} from "../employee-context";
import { evaluateWorkingStudents, type WorkingStudentMonitorRequest } from "./monitor";
import { acknowledgeWorkingStudentFinding, loadWorkingStudentMonitor } from "./views";
import {
	addWeeks,
	weekdays,
	weekendOver20h,
	workingStudentFixture,
} from "./working-student.test.fixture";

// Mon 2026-03-02 … Sun 2026-03-08 is ISO week 2026-W10.
const W10 = "2026-03-02";
const AFTER_W10 = "2026-03-09";
/** Long after the seeded work, so persisted shifts in these weeks no longer count. */
const LATER = Temporal.Instant.from("2026-06-01T00:00:00Z");

describe("working-student monitor (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const fx = workingStudentFixture(integrationAdminPool(), "t1991-monitor");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	function evaluate(
		organizationId: string,
		employeeIds: string[],
		overrides: Partial<WorkingStudentMonitorRequest> = {},
	) {
		return evaluateWorkingStudents(db, {
			organizationId,
			timezone: "Europe/Berlin",
			window: { start: W10, endExclusive: AFTER_W10 },
			employeeIds,
			now: LATER,
			...overrides,
		});
	}

	function findingsOf(
		evaluations: Awaited<ReturnType<typeof evaluate>>,
		employeeId: string,
		kind: string,
	) {
		return (
			evaluations
				.find((e) => e.employeeId === employeeId)
				?.findings.filter((f) => f.kind === kind) ?? []
		);
	}

	it("flags an unexcused lecture week and permits lecture-free, evening and weekend >20 h weeks", async () => {
		const org = await fx.organization("a");
		const admin = await fx.user("admin");
		const lecture = await fx.workingStudent(org, "lecture");
		const semesterBreak = await fx.workingStudent(org, "break");
		const evening = await fx.workingStudent(org, "evening");
		const weekend = await fx.workingStudent(org, "weekend");

		await fx.work(org, lecture, weekdays(W10, "09:00", "14:00")); // 25 h daytime
		await fx.work(org, semesterBreak, weekdays(W10, "09:00", "14:00"));
		await recordEmployeeStudyPeriod(db, {
			organizationId: org.id,
			employeeId: semesterBreak.employeeId,
			actorUserId: admin.userId,
			startsOn: "2026-02-16",
			endsOn: "2026-04-12",
		});
		await fx.work(org, evening, [
			...weekdays(W10, "09:00", "12:00"),
			...weekdays(W10, "18:00", "20:00"),
		]);
		await fx.work(org, weekend, [
			...weekdays(W10, "09:00", "13:00"),
			{ date: "2026-03-07", start: "10:00", end: "15:00" },
		]);

		const evaluations = await evaluate(org.id, [
			lecture.employeeId,
			semesterBreak.employeeId,
			evening.employeeId,
			weekend.employeeId,
		]);

		expect(findingsOf(evaluations, lecture.employeeId, "working_student_lecture_week")).toEqual([
			expect.objectContaining({
				id: `working_student_lecture_week:${lecture.employeeId}:2026-W10`,
				organizationId: org.id,
				severity: "critical",
				subjectKey: "2026-W10",
				summary: expect.objectContaining({
					tier: "exceeded",
					used: { unit: "minutes", value: 1500 },
					limit: { unit: "minutes", value: 1200 },
				}),
				acknowledgementKind: "working_student_over_20h_week",
			}),
		]);
		for (const permitted of [semesterBreak, evening, weekend]) {
			const evaluation = evaluations.find((e) => e.employeeId === permitted.employeeId);
			expect(evaluation?.weeks.at(-1)).toMatchObject({
				subjectKey: "2026-W10",
				overLimit: true,
				lectureBreach: false,
				rollingOver20hWeeks: 1,
			});
			expect(evaluation?.findings).toEqual([]);
		}
	});

	it("passes 26 rolling >20 h weeks with a warning and flags the 27th critical, counting prior-employer weeks", async () => {
		const org = await fx.organization("a");
		const admin = await fx.user("admin");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);

		// 16 prior-employer weeks; the oldest starts 52 weeks before W10 and has aged out by then.
		await recordEmployeeStatutoryOffset(db, {
			organizationId: org.id,
			employeeId: student.employeeId,
			actorUserId: admin.userId,
			offsetKind: "prior_working_student_over_20h_weeks",
			firstWeekStartsOn: addWeeks(W10, -52),
			count: 16,
			note: "Certificate of the previous employer",
		});
		// 10 own permitted weeks before W10, plus W10 itself: 15 + 11 = 26.
		await fx.work(
			org,
			student,
			Array.from({ length: 11 }, (_, index) => weekendOver20h(addWeeks(W10, index - 10))),
		);

		const twentySix = await evaluate(org.id, [student.employeeId]);
		expect(twentySix[0]?.weeks.at(-1)).toMatchObject({ rollingOver20hWeeks: 26 });
		expect(findingsOf(twentySix, student.employeeId, "working_student_26_week_ceiling")).toEqual([
			expect.objectContaining({
				severity: "warning",
				subjectKey: "2026-W10",
				summary: expect.objectContaining({
					used: { unit: "weeks", value: 26 },
					remaining: { unit: "weeks", value: 0 },
				}),
			}),
		]);

		// The next week, one more prior week has aged out, so a planned >20 h week is the 26th again…
		const nextWeek = { start: AFTER_W10, endExclusive: addWeeks(AFTER_W10, 1) };
		await fx.shift(org, subareaId, student, weekendOver20h(AFTER_W10));
		const planned = await evaluate(org.id, [student.employeeId], {
			window: nextWeek,
			now: Temporal.Instant.from("2026-03-09T06:00:00Z"),
		});
		expect(planned[0]?.weeks.at(-1)).toMatchObject({
			subjectKey: "2026-W11",
			rollingOver20hWeeks: 26,
		});

		// …until the prior-employer run is one week longer: then it is the 27th and critical.
		await fx.cleanup();
		const org2 = await fx.organization("b");
		const admin2 = await fx.user("admin");
		const student2 = await fx.workingStudent(org2, "student");
		await recordEmployeeStatutoryOffset(db, {
			organizationId: org2.id,
			employeeId: student2.employeeId,
			actorUserId: admin2.userId,
			offsetKind: "prior_working_student_over_20h_weeks",
			firstWeekStartsOn: addWeeks(W10, -51),
			count: 16,
			note: "Certificate of the previous employer",
		});
		await fx.work(
			org2,
			student2,
			Array.from({ length: 11 }, (_, index) => weekendOver20h(addWeeks(W10, index - 10))),
		);
		const twentySeven = await evaluate(org2.id, [student2.employeeId]);
		expect(findingsOf(twentySeven, student2.employeeId, "working_student_26_week_ceiling")).toEqual(
			[
				expect.objectContaining({
					severity: "critical",
					summary: expect.objectContaining({
						tier: "exceeded",
						used: { unit: "weeks", value: 27 },
					}),
				}),
			],
		);
	});

	it("ages own >20 h weeks out of the rolling window after 52 weeks", async () => {
		const org = await fx.organization("a");
		const student = await fx.workingStudent(org, "student", { from: "2024-06-01" });
		// 26 permitted weeks ending 52 weeks before W10 have aged out; W10 is the only one left.
		await fx.work(org, student, [
			...Array.from({ length: 26 }, (_, index) => weekendOver20h(addWeeks(W10, index - 77))),
			weekendOver20h(W10),
		]);
		const [evaluation] = await evaluate(org.id, [student.employeeId]);
		expect(evaluation?.weeks.at(-1)?.rollingOver20hWeeks).toBe(1);
		expect(evaluation?.findings).toEqual([]);
	});

	it("combines completed work with shifts that have not started, and leaves out a replaced shift", async () => {
		const org = await fx.organization("a");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// Monday–Wednesday worked (12 h), Thursday–Friday planned (8 h each).
		await fx.work(org, student, weekdays(W10, "09:00", "13:00").slice(0, 3));
		await fx.shift(org, subareaId, student, { date: "2026-03-05", start: "09:00", end: "13:00" });
		const friday = await fx.shift(org, subareaId, student, {
			date: "2026-03-06",
			start: "09:00",
			end: "17:00",
		});
		const now = Temporal.Instant.from("2026-03-04T20:00:00Z");

		const [planned] = await evaluate(org.id, [student.employeeId], { now });
		expect(planned?.weeks.at(-1)).toMatchObject({ totalMinutes: 1440, coreMinutes: 1440 });
		expect(planned?.findings.find((f) => f.kind === "working_student_lecture_week")).toMatchObject({
			// The excess is only planned: still avoidable.
			severity: "warning",
		});

		const [replaced] = await evaluate(org.id, [student.employeeId], {
			now,
			replacesShiftId: friday,
			proposedShifts: [
				{
					employeeId: student.employeeId,
					date: "2026-03-06",
					startTime: "18:00",
					endTime: "22:00",
				},
			],
		});
		expect(replaced?.weeks.at(-1)).toMatchObject({
			totalMinutes: 1200,
			coreMinutes: 960,
			eveningWeekendMinutes: 240,
		});
		expect(replaced?.findings).toEqual([]);

		// Once the week has passed, unworked shifts no longer count.
		const [after] = await evaluate(org.id, [student.employeeId]);
		expect(after?.weeks.at(-1)?.totalMinutes).toBe(720);
	});

	it("counts >20 h weeks worked under another profile toward the 26-week ceiling", async () => {
		const org = await fx.organization("a");
		// Short-term for 16 weeks, then a working student for 12: 28 weeks above 20 h.
		const student = await fx.workingStudent(org, "student", {
			from: "2025-01-06",
			profile: "short_term",
		});
		await fx.terms(org, student, { from: addWeeks(W10, -11), profile: "working_student" });
		await fx.work(
			org,
			student,
			Array.from({ length: 28 }, (_, index) => weekendOver20h(addWeeks(W10, index - 27))),
		);

		const evaluations = await evaluate(org.id, [student.employeeId]);
		const evaluation = evaluations[0];
		expect(evaluation?.weeks.at(-1)).toMatchObject({ rollingOver20hWeeks: 28 });
		expect(evaluation?.weeks.find((week) => week.weekStart === addWeeks(W10, -12))).toMatchObject({
			isWorkingStudentWeek: false,
			overLimit: true,
		});
		expect(findingsOf(evaluations, student.employeeId, "working_student_26_week_ceiling")).toEqual([
			expect.objectContaining({
				severity: "critical",
				summary: expect.objectContaining({ used: { unit: "weeks", value: 28 } }),
				adminDetail: { facts: expect.objectContaining({ ownOver20hWeeks: 28 }) },
			}),
		]);
	});

	it("judges only the working-student days of a week the profile changes in", async () => {
		const org = await fx.organization("a");
		// Regular until Wednesday, a working student from Thursday 2026-03-05.
		const student = await fx.workingStudent(org, "student", { profile: "regular" });
		await fx.terms(org, student, { from: "2026-03-05", profile: "working_student" });
		await fx.work(org, student, weekdays(W10, "08:00", "16:00"));

		const [evaluation] = await evaluate(org.id, [student.employeeId]);
		expect(evaluation?.weeks.at(-1)).toMatchObject({
			isWorkingStudentWeek: true,
			totalMinutes: 2400,
			coreMinutes: 960,
			otherProfileMinutes: 1440,
			overLimit: true,
			lectureBreach: false,
			rollingOver20hWeeks: 1,
		});
		expect(evaluation?.findings).toEqual([]);
	});

	it("counts a shift in progress: the running clock-in so far and the rest of the shift", async () => {
		const org = await fx.organization("a");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 16 h worked Monday and Tuesday; clocked in on Wednesday's 08:00–16:00 shift.
		await fx.work(org, student, weekdays(W10, "08:00", "16:00").slice(0, 2));
		await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "08:00", end: "16:00" });
		await fx.openWork(org, student, { date: "2026-03-04", start: "08:00" });

		const evaluations = await evaluate(org.id, [student.employeeId], {
			now: Temporal.Instant.from("2026-03-04T11:00:00Z"), // 12:00 in Berlin
			proposedShifts: [
				{
					employeeId: student.employeeId,
					date: "2026-03-05",
					startTime: "09:00",
					endTime: "13:00",
				},
			],
		});
		expect(evaluations[0]?.weeks.at(-1)).toMatchObject({ totalMinutes: 1680, coreMinutes: 1680 });
		expect(findingsOf(evaluations, student.employeeId, "working_student_lecture_week")).toEqual([
			expect.objectContaining({
				severity: "warning",
				summary: expect.objectContaining({ used: { unit: "minutes", value: 1680 } }),
			}),
		]);

		// A proposed shift that has started without a clock-in counts in full, one that has ended not at all.
		const covering = await fx.workingStudent(org, "covering");
		const proposalsAt = (now: string, proposals: [string, string, string][]) =>
			evaluate(org.id, [covering.employeeId], {
				now: Temporal.Instant.from(now),
				proposedShifts: proposals.map(([date, startTime, endTime]) => ({
					employeeId: covering.employeeId,
					date,
					startTime,
					endTime,
				})),
			});
		// 13:00 in Berlin on Wednesday: the 09:00–17:00 shift is running, Tuesday's is over.
		const wednesday13 = "2026-03-04T12:00:00Z";
		const [started] = await proposalsAt(wednesday13, [
			["2026-03-04", "09:00", "17:00"],
			["2026-03-03", "09:00", "17:00"],
		]);
		expect(started?.weeks.at(-1)).toMatchObject({ totalMinutes: 480, coreMinutes: 480 });

		// Already clocked in on that shift since 09:00: clock-in to shift end, once.
		await fx.openWork(org, covering, { date: "2026-03-04", start: "09:00" });
		const [clockedIn] = await proposalsAt(wednesday13, [["2026-03-04", "09:00", "17:00"]]);
		expect(clockedIn?.weeks.at(-1)).toMatchObject({ totalMinutes: 480, coreMinutes: 480 });
	});

	it("keeps a running shift's total and fingerprint steady through a clock-in with seconds", async () => {
		const org = await fx.organization("a");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 16 h worked Monday and Tuesday; Wednesday's 09:00–17:00 shift clocked in at 09:00:42.
		await fx.work(org, student, weekdays(W10, "08:00", "16:00").slice(0, 2));
		await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "09:00", end: "17:00" });
		await fx.openWork(org, student, { date: "2026-03-04", start: "09:00:42" });

		const at = async (now: string) => {
			const evaluations = await evaluate(org.id, [student.employeeId], {
				now: Temporal.Instant.from(now),
			});
			return {
				coreMinutes: evaluations[0]?.weeks.at(-1)?.coreMinutes,
				fingerprint: findingsOf(evaluations, student.employeeId, "working_student_lecture_week")[0]
					?.inputFingerprint,
			};
		};
		// 960 + 480 minutes (from the clock-in's minute), on either side of its 42-second mark.
		const before = await at("2026-03-04T12:00:30Z");
		expect(before.coreMinutes).toBe(1440);
		expect(before.fingerprint).toMatch(/^v1:/);
		for (const now of [
			"2026-03-04T12:00:41.999Z",
			"2026-03-04T12:00:42Z",
			"2026-03-04T12:00:50Z",
			"2026-03-04T13:17:13.5Z",
		]) {
			expect(await at(now), now).toEqual(before);
		}
	});

	it("keeps counting the rest of a running shift through a clocked-out break", async () => {
		const org = await fx.organization("a");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// Wednesday's 08:00–18:00 shift: worked 08:00–12:00, on a break 12:00–12:30.
		await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "08:00", end: "18:00" });
		const morning = await fx.openWork(org, student, { date: "2026-03-04", start: "08:00" });
		await fx.clockOut(org, morning, { date: "2026-03-04", end: "12:00" });

		const totalAt = async (now: string) =>
			(
				await evaluate(org.id, [student.employeeId], { now: Temporal.Instant.from(now) })
			)[0]?.weeks.at(-1)?.totalMinutes;
		// 12:15 in Berlin: 4 h worked plus the 6 h of the shift after it, through the break.
		expect(await totalAt("2026-03-04T11:15:00Z")).toBe(600);
		expect(await totalAt("2026-03-04T11:16:00Z")).toBe(600);

		await fx.openWork(org, student, { date: "2026-03-04", start: "12:30" });
		// 13:00: 4 h worked, then clocked in from 12:30 to the shift's end.
		expect(await totalAt("2026-03-04T12:00:00Z")).toBe(570);
		// Once the shift is over, only the recorded work is left (the afternoon is still running).
		expect(await totalAt("2026-03-04T17:00:00Z")).toBe(240 + 330);
	});

	describe("keeps lecture-week figures and acknowledgements steady while work is in progress", () => {
		const lectureWeekAt = async (organizationId: string, employeeId: string, now: string) => {
			const evaluations = await evaluate(organizationId, [employeeId], {
				now: Temporal.Instant.from(now),
			});
			const finding = findingsOf(evaluations, employeeId, "working_student_lecture_week")[0];
			return {
				coreMinutes: evaluations[0]?.weeks.at(-1)?.coreMinutes,
				used: finding?.summary.used.value,
				fingerprint: finding?.inputFingerprint,
			};
		};

		/**
		 * The admin sees the finding at `seenAt` and acknowledges it a minute later; at `laterAt` the
		 * Employee Detail card still shows the acknowledgement as current.
		 */
		const acknowledgementStaysCurrent = async (
			org: { id: string },
			employeeId: string,
			times: { seenAt: string; acknowledgedAt: string; laterAt: string },
		) => {
			const admin = await fx.user("admin");
			const seen = await lectureWeekAt(org.id, employeeId, times.seenAt);
			expect(seen.fingerprint).toMatch(/^v1:/);
			await acknowledgeWorkingStudentFinding(db, {
				organizationId: org.id,
				actorUserId: admin.userId,
				employeeId,
				findingKind: "working_student_lecture_week",
				weekStart: W10,
				expectedInputFingerprint: seen.fingerprint ?? "",
				reason: "Exam period ends this week",
				now: Temporal.Instant.from(times.acknowledgedAt),
			});
			const card = await loadWorkingStudentMonitor(db, {
				organizationId: org.id,
				employeeId,
				now: Temporal.Instant.from(times.laterAt),
				audience: "full",
			});
			const finding = card.findings.find(
				(candidate) =>
					candidate.kind === "working_student_lecture_week" && candidate.periodStart === W10,
			);
			expect(finding && "acknowledgement" in finding && finding.acknowledgement).toMatchObject({
				status: "current",
			});
		};

		it("counts a running shift without a clock-in in full", async () => {
			const org = await fx.organization("a");
			const student = await fx.workingStudent(org, "student");
			const subareaId = await fx.subarea(org, student);
			// 16 h worked Monday and Tuesday; Wednesday's 09:00–17:00 shift started, nobody clocked in.
			await fx.work(org, student, weekdays(W10, "08:00", "16:00").slice(0, 2));
			await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "09:00", end: "17:00" });

			// Berlin is UTC+1 in March: 10:00:30, 10:01:15 and 13:47 on Wednesday.
			const first = await lectureWeekAt(org.id, student.employeeId, "2026-03-04T09:00:30Z");
			expect(first).toMatchObject({ coreMinutes: 1440, used: 1440 });
			for (const now of ["2026-03-04T09:01:15Z", "2026-03-04T12:47:00Z"]) {
				expect(await lectureWeekAt(org.id, student.employeeId, now), now).toEqual(first);
			}
			await acknowledgementStaysCurrent(org, student.employeeId, {
				seenAt: "2026-03-04T09:00:30Z",
				acknowledgedAt: "2026-03-04T09:01:45Z",
				laterAt: "2026-03-04T12:47:00Z",
			});
		});

		it("counts a clock-in made before its shift as its early minutes so far plus the shift", async () => {
			const org = await fx.organization("a");
			const student = await fx.workingStudent(org, "student");
			const subareaId = await fx.subarea(org, student);
			// 16 h worked; clocked in at 08:45:42 for Wednesday's 09:00–17:00 shift.
			await fx.work(org, student, weekdays(W10, "08:00", "16:00").slice(0, 2));
			await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "09:00", end: "17:00" });
			await fx.openWork(org, student, { date: "2026-03-04", start: "08:45:42" });

			// 960 + the minutes from 08:45 so far + the 480 planned: the early minutes grow until the
			// shift starts (08:50, 08:50, 08:51, then 09:00 and 12:13), the fingerprint holds.
			const first = await lectureWeekAt(org.id, student.employeeId, "2026-03-04T07:50:10Z");
			expect(first).toMatchObject({ coreMinutes: 1445, used: 1445 });
			for (const [now, minutes] of [
				["2026-03-04T07:50:50Z", 1445],
				["2026-03-04T07:51:20Z", 1446],
				["2026-03-04T08:00:00Z", 1455],
				["2026-03-04T11:13:42.5Z", 1455],
			] as const) {
				expect(await lectureWeekAt(org.id, student.employeeId, now), now).toEqual({
					coreMinutes: minutes,
					used: minutes,
					fingerprint: first.fingerprint,
				});
			}
			await acknowledgementStaysCurrent(org, student.employeeId, {
				seenAt: "2026-03-04T07:50:10Z",
				acknowledgedAt: "2026-03-04T07:51:20Z",
				laterAt: "2026-03-04T11:13:42.5Z",
			});
		});

		it("keeps an acknowledgement current when a planned shift is clocked in seconds after the minute", async () => {
			const org = await fx.organization("a");
			const admin = await fx.user("admin");
			const student = await fx.workingStudent(org, "student");
			const subareaId = await fx.subarea(org, student);
			// 16 h worked Monday and Tuesday; Wednesday's 08:00–16:00 shift planned.
			await fx.work(org, student, weekdays(W10, "08:00", "16:00").slice(0, 2));
			await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "08:00", end: "16:00" });

			// Berlin is UTC+1 in March: seen and acknowledged at 07:50 and 07:51, before the shift.
			const planned = await lectureWeekAt(org.id, student.employeeId, "2026-03-04T06:50:00Z");
			expect(planned).toMatchObject({ coreMinutes: 1440, used: 1440 });
			await acknowledgeWorkingStudentFinding(db, {
				organizationId: org.id,
				actorUserId: admin.userId,
				employeeId: student.employeeId,
				findingKind: "working_student_lecture_week",
				weekStart: W10,
				expectedInputFingerprint: planned.fingerprint ?? "",
				reason: "Exam period ends this week",
				now: Temporal.Instant.from("2026-03-04T06:51:00Z"),
			});

			// Clocked in at 08:00:42 on that shift: worked as planned.
			await fx.openWork(org, student, { date: "2026-03-04", start: "08:00:42" });
			const now = "2026-03-04T09:13:42.5Z";
			expect(await lectureWeekAt(org.id, student.employeeId, now)).toEqual(planned);
			const card = await loadWorkingStudentMonitor(db, {
				organizationId: org.id,
				employeeId: student.employeeId,
				now: Temporal.Instant.from(now),
				audience: "full",
			});
			const finding = card.findings.find(
				(candidate) =>
					candidate.kind === "working_student_lecture_week" && candidate.periodStart === W10,
			);
			expect(finding && "acknowledgement" in finding && finding.acknowledgement).toMatchObject({
				status: "current",
			});
		});

		it("lets a clock-in without a shift grow the figures but not the fingerprint", async () => {
			const org = await fx.organization("a");
			const student = await fx.workingStudent(org, "student");
			// 20 h worked Monday and Tuesday; clocked in at 09:00:42 on Wednesday without a shift.
			await fx.work(org, student, weekdays(W10, "08:00", "18:00").slice(0, 2));
			await fx.openWork(org, student, { date: "2026-03-04", start: "09:00:42" });

			// 11:00:05 in Berlin: 1200 + 120 minutes (09:00 to 11:00 on the minute grid).
			const first = await lectureWeekAt(org.id, student.employeeId, "2026-03-04T10:00:05Z");
			expect(first).toMatchObject({ coreMinutes: 1320, used: 1320 });
			// Steady within the minute, whatever the clock-in's seconds.
			expect(await lectureWeekAt(org.id, student.employeeId, "2026-03-04T10:00:55Z")).toEqual(
				first,
			);
			// Later the clock-in has grown the figures, not the fingerprint.
			const later = await lectureWeekAt(org.id, student.employeeId, "2026-03-04T10:30:05Z");
			expect(later).toEqual({ coreMinutes: 1350, used: 1350, fingerprint: first.fingerprint });

			await acknowledgementStaysCurrent(org, student.employeeId, {
				seenAt: "2026-03-04T10:00:05Z",
				acknowledgedAt: "2026-03-04T10:01:30Z",
				laterAt: "2026-03-04T10:30:05Z",
			});

			// Clocked out, it is recorded work like any other: its minutes now decide the week.
			const clockIn = await fx.openWork(org, student, { date: "2026-03-05", start: "09:00" });
			await fx.clockOut(org, clockIn, { date: "2026-03-05", end: "10:00" });
			expect(
				(await lectureWeekAt(org.id, student.employeeId, "2026-03-05T10:00:00Z")).fingerprint,
			).not.toBe(first.fingerprint);
		});
	});

	it("keeps the lecture-week fingerprint through a shift worked as planned, and only then", async () => {
		const org = await fx.organization("a");
		const admin = await fx.user("admin");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 16 h worked Monday and Tuesday, Wednesday's 08:00–16:00 shift planned: 24 h of core time.
		await fx.work(org, student, weekdays(W10, "08:00", "16:00").slice(0, 2));
		await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "08:00", end: "16:00" });
		const lectureFree = {
			organizationId: org.id,
			employeeId: student.employeeId,
			actorUserId: admin.userId,
			startsOn: "2026-03-05",
			endsOn: "2026-03-06",
		};
		const recorded = await recordEmployeeStudyPeriod(db, lectureFree);

		// Berlin is UTC+1 in March.
		const fingerprintAt = async (now: string) => {
			const evaluations = await evaluate(org.id, [student.employeeId], {
				now: Temporal.Instant.from(now),
			});
			return findingsOf(evaluations, student.employeeId, "working_student_lecture_week")[0]
				?.inputFingerprint;
		};
		const planned = await fingerprintAt("2026-03-04T06:00:00Z");
		expect(planned).toMatch(/^v1:/);
		expect(await fingerprintAt("2026-03-04T07:00:00Z"), "shift start").toBe(planned);

		const clockIn = await fx.openWork(org, student, { date: "2026-03-04", start: "08:00" });
		expect(await fingerprintAt("2026-03-04T07:00:00Z"), "clock-in").toBe(planned);
		expect(await fingerprintAt("2026-03-04T11:00:00Z"), "while clocked in").toBe(planned);

		await fx.clockOut(org, clockIn, { date: "2026-03-04", end: "16:00" });
		expect(await fingerprintAt("2026-03-04T15:00:00Z"), "clock-out at shift end").toBe(planned);
		const after = "2026-03-04T16:00:00Z";
		expect(await fingerprintAt(after), "after the shift").toBe(planned);

		await fx.shift(org, subareaId, student, { date: "2026-03-07", start: "10:00", end: "18:00" });
		expect(await fingerprintAt(after), "a Saturday shift").toBe(planned);

		await voidEmployeeStudyPeriod(db, {
			...lectureFree,
			periodId: recorded.id,
			reason: "Recorded twice by mistake",
		});
		await recordEmployeeStudyPeriod(db, lectureFree);
		expect(await fingerprintAt(after), "an identical lecture-free period").toBe(planned);

		await fx.work(org, student, [{ date: "2026-03-04", start: "16:00", end: "17:00" }]);
		expect(await fingerprintAt(after), "an extra hour of core work").not.toBe(planned);
	});

	it("splits a Sunday-to-Monday overnight shift across compliance weeks and keeps DST nights real", async () => {
		const org = await fx.organization("a");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		await fx.shift(org, subareaId, student, { date: "2026-03-08", start: "22:00", end: "06:00" });
		// Clocks go forward on Sunday 2026-03-29: the 22:00–06:00 night is 7 hours long.
		await fx.shift(org, subareaId, student, { date: "2026-03-28", start: "22:00", end: "06:00" });
		const now = Temporal.Instant.from("2026-03-01T00:00:00Z");

		const [overnight] = await evaluate(org.id, [student.employeeId], {
			now,
			window: { start: W10, endExclusive: addWeeks(W10, 2) },
		});
		const byStart = new Map(overnight?.weeks.map((week) => [week.weekStart, week]));
		expect(byStart.get(W10)).toMatchObject({ totalMinutes: 120, eveningWeekendMinutes: 120 });
		expect(byStart.get(AFTER_W10)).toMatchObject({ totalMinutes: 360, eveningWeekendMinutes: 360 });

		const [dst] = await evaluate(org.id, [student.employeeId], {
			now,
			window: { start: "2026-03-23", endExclusive: "2026-03-30" },
		});
		expect(dst?.weeks.at(-1)).toMatchObject({ weekStart: "2026-03-23", totalMinutes: 420 });
	});

	it("counts a running night shift that started the day before now, and no ended shift", async () => {
		const org = await fx.organization("a");
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// Sunday's night shift ended Monday 06:00; Monday's runs until Tuesday 06:00.
		await fx.shift(org, subareaId, student, { date: "2026-03-01", start: "22:00", end: "06:00" });
		await fx.shift(org, subareaId, student, { date: "2026-03-02", start: "22:00", end: "06:00" });

		const [evaluation] = await evaluate(org.id, [student.employeeId], {
			now: Temporal.Instant.from("2026-03-03T01:00:00Z"), // Tuesday 02:00 in Berlin
		});
		expect(evaluation?.weeks.at(-1)).toMatchObject({
			weekStart: W10,
			// Not clocked in: the whole running shift, Monday 22:00 to Tuesday 06:00.
			totalMinutes: 480,
			eveningWeekendMinutes: 480,
		});
	});

	it("judges only working students of the organization, in weeks they are working students", async () => {
		const org = await fx.organization("a");
		const other = await fx.organization("b");
		const regular = await fx.workingStudent(org, "regular", { profile: "regular" });
		const later = await fx.workingStudent(org, "later", { from: "2026-03-09" });
		const foreign = await fx.workingStudent(other, "foreign");
		for (const person of [regular, later]) {
			await fx.work(org, person, weekdays(W10, "09:00", "15:00"));
		}
		await fx.work(other, foreign, weekdays(W10, "09:00", "15:00"));

		expect(
			await evaluate(org.id, [regular.employeeId, later.employeeId, foreign.employeeId]),
		).toEqual([]);
	});
});
