/**
 * #1991: the working-student monitor against PostgreSQL — the 20-hour lecture-period rule with its
 * lecture-free, evening and weekend exceptions, and the rolling 26-week ceiling with prior-employer
 * weeks aging out of the 52-week window.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { recordEmployeeStatutoryOffset, recordEmployeeStudyPeriod } from "../employee-context";
import { evaluateWorkingStudents, type WorkingStudentMonitorRequest } from "./monitor";
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
