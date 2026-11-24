/**
 * #2017: the working-student weekday daytime band is an organization statutory preference. Every
 * working-student evaluation (monitor card, Reviews & Conflicts, Scheduling, Staffing) counts the
 * lecture-week minutes inside the organization's own band, and changing the band makes the lecture
 * week's acknowledgement stale.
 */
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import {
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "@/lib/effect/services/staffing-suggestion.service";
import { WorkPolicyService } from "@/lib/effect/services/work-policy.service";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { integrationAdminPool } from "@/test/integration-database";
import type { FixtureOrganization } from "@/test/statutory-fixtures";
import {
	DEFAULT_STATUTORY_PREFERENCES,
	saveOrganizationStatutoryPreferences,
} from "../preferences";
import { evaluateWorkingStudents } from "./monitor";
import {
	acknowledgeWorkingStudentFinding,
	listWorkingStudentReviewItems,
	loadWorkingStudentMonitor,
} from "./views";
import { weekdays, workingStudentFixture } from "./working-student.test.fixture";

vi.mock("@/lib/calendar/work-policy-requirements", async () => {
	const { Effect } = await import("effect");
	return { loadDailyWorkRequirementsForEmployee: () => Effect.succeed({}) };
});

const TZ = "Europe/Berlin";
// Mon 2026-03-02 … Sun 2026-03-08 is ISO week 2026-W10.
const W10 = "2026-03-02";
const AFTER_W10 = "2026-03-09";
/** Long after the seeded work, so persisted shifts in these weeks no longer count. */
const LATER = Temporal.Instant.from("2026-06-01T00:00:00Z");

const workPolicyLayer = Layer.succeed(WorkPolicyService, {
	getEffectivePolicy: () => Effect.succeed(null),
	getEffectivePolicyAt: () => Effect.succeed(null),
} as never);

describe("working-student daytime band per organization (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const fx = workingStudentFixture(integrationAdminPool(), "t2017-band");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	async function setBand(org: FixtureOrganization, start: string, end: string) {
		const admin = await fx.user(`band-admin-${start}-${end}`.replaceAll(":", ""));
		const minute = (time: string) => {
			const [hours = 0, minutes = 0] = time.split(":").map(Number);
			return hours * 60 + minutes;
		};
		await saveOrganizationStatutoryPreferences(db, {
			...DEFAULT_STATUTORY_PREFERENCES,
			organizationId: org.id,
			actorUserId: admin.userId,
			workingStudentDaytimeStartMinute: minute(start),
			workingStudentDaytimeEndMinute: minute(end),
		});
	}

	async function lectureWeek(org: FixtureOrganization, employeeId: string) {
		const [evaluation] = await evaluateWorkingStudents(db, {
			organizationId: org.id,
			timezone: TZ,
			window: { start: W10, endExclusive: AFTER_W10 },
			employeeIds: [employeeId],
			now: LATER,
		});
		return {
			week: evaluation?.weeks.at(-1),
			finding: evaluation?.findings.find((f) => f.kind === "working_student_lecture_week"),
		};
	}

	it("counts each organization's lecture weeks inside its own band in the monitor and Reviews", async () => {
		const late = await fx.organization("late", TZ);
		const standard = await fx.organization("standard", TZ);
		await setBand(late, "07:00", "19:00");
		const lateStudent = await fx.workingStudent(late, "student");
		const standardStudent = await fx.workingStudent(standard, "student");
		// 4.5 h a weekday from 06:30: 22.5 h inside 06:00–18:00, 20 h inside 07:00–19:00.
		for (const [org, person] of [
			[late, lateStudent],
			[standard, standardStudent],
		] as const) {
			await fx.work(org, person, weekdays(W10, "06:30", "11:00"));
		}

		const lateWeek = await lectureWeek(late, lateStudent.employeeId);
		const standardWeek = await lectureWeek(standard, standardStudent.employeeId);

		expect(lateWeek.week).toMatchObject({
			coreMinutes: 1200,
			eveningWeekendMinutes: 150,
			lectureBreach: false,
		});
		expect(lateWeek.finding).toBeUndefined();
		expect(standardWeek.week).toMatchObject({ coreMinutes: 1350, lectureBreach: true });
		expect(standardWeek.finding?.summary.used).toEqual({ unit: "minutes", value: 1350 });

		const reviews = async (org: FixtureOrganization) =>
			(
				await listWorkingStudentReviewItems(db, {
					organizationId: org.id,
					now: Temporal.Instant.from("2026-03-09T12:00:00Z"),
				})
			).map((item) => item.finding.kind);
		expect(await reviews(late)).toEqual([]);
		expect(await reviews(standard)).toEqual(["working_student_lecture_week"]);

		// The card names the band it judged by, for every reader.
		const card = await loadWorkingStudentMonitor(db, {
			organizationId: late.id,
			employeeId: lateStudent.employeeId,
			now: Temporal.Instant.from("2026-03-04T12:00:00Z"),
			audience: "restricted",
		});
		expect(card.daytimeBand).toEqual({ startMinute: 420, endMinute: 1140 });
		expect(card.weeks.find((week) => week.weekStart === W10)).toMatchObject({
			coreMinutes: 1200,
			eveningWeekendMinutes: 150,
		});
	});

	it("makes a lecture week's acknowledgement stale when the band changes its figures", async () => {
		const org = await fx.organization("org", TZ);
		const admin = await fx.user("admin");
		const student = await fx.workingStudent(org, "student");
		await fx.work(org, student, weekdays(W10, "06:00", "11:30")); // 27.5 h inside 06:00–18:00
		const before = await lectureWeek(org, student.employeeId);
		await acknowledgeWorkingStudentFinding(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			employeeId: student.employeeId,
			findingKind: "working_student_lecture_week",
			weekStart: W10,
			expectedInputFingerprint: before.finding?.inputFingerprint ?? "",
			reason: "Exam preparation agreed with the university",
			now: LATER,
		});
		const status = async () => {
			const card = await loadWorkingStudentMonitor(db, {
				organizationId: org.id,
				employeeId: student.employeeId,
				now: Temporal.Instant.from("2026-03-09T12:00:00Z"),
				audience: "full",
			});
			const finding = card.findings.find(
				(candidate) =>
					candidate.kind === "working_student_lecture_week" && candidate.periodStart === W10,
			);
			return {
				used: finding?.summary.used,
				acknowledgement:
					finding && "acknowledgement" in finding ? finding.acknowledgement?.status : undefined,
			};
		};
		expect(await status()).toEqual({
			used: { unit: "minutes", value: 1650 },
			acknowledgement: "current",
		});

		await setBand(org, "07:00", "19:00");
		expect(await status()).toEqual({
			used: { unit: "minutes", value: 1350 },
			acknowledgement: "stale",
		});

		// Back to the band the admin acknowledged under: the same figures, current again.
		await setBand(org, "06:00", "18:00");
		expect(await status()).toEqual({
			used: { unit: "minutes", value: 1650 },
			acknowledgement: "current",
		});
	});

	it("counts the organization's band in the schedule compliance evaluation", async () => {
		const org = await fx.organization("org", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 27.5 h of 06:00–18:00 daytime in 2026-W10; a shift keeps the student in the window.
		await fx.work(org, student, weekdays(W10, "06:00", "11:30"));
		await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "15:00", end: "16:00" });
		const statutory = async () =>
			(
				await Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* ScheduleComplianceService;
						return yield* service.evaluateScheduleWindow({
							organizationId: org.id,
							startDate: shiftDateBounds(W10, TZ).start,
							endDateExclusive: shiftDateBounds(AFTER_W10, TZ).start,
							timezone: TZ,
						});
					}).pipe(
						Effect.provide(
							ScheduleComplianceServiceLive.pipe(
								Layer.provide(workPolicyLayer),
								Layer.provide(DatabaseServiceLive),
							),
						),
					),
				)
			).findings
				.filter((finding) => finding.type === "statutory")
				.map((finding) => ("summary" in finding ? finding.summary.used : null));

		expect(await statutory()).toEqual([{ unit: "minutes", value: 1650 }]);

		await setBand(org, "07:00", "19:00");

		expect(await statutory()).toEqual([{ unit: "minutes", value: 1350 }]);
	});

	it("warns Staffing about a proposed shift only by its minutes inside the organization's band", async () => {
		const org = await fx.organization("org", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// Far in the future so the planned shifts have not started: Mon + Tue 8 h, Thu 2 h = 18 h.
		await fx.shift(org, subareaId, student, { date: "2030-03-04", start: "09:00", end: "17:00" });
		await fx.shift(org, subareaId, student, { date: "2030-03-05", start: "09:00", end: "17:00" });
		await fx.shift(org, subareaId, student, { date: "2030-03-07", start: "09:00", end: "11:00" });
		const suggest = async () =>
			(
				await Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* StaffingSuggestionService;
						return yield* service.suggestForShift({
							organizationId: org.id,
							timezone: TZ,
							candidates: [
								{ employeeId: student.employeeId, displayName: "Student", isActive: true },
							],
							// Wednesday 16:00–20:00: 2 h inside 06:00–18:00, 3 h inside 07:00–19:00.
							shift: { subareaId, date: "2030-03-06", startTime: "16:00", endTime: "20:00" },
						});
					}).pipe(
						Effect.provide(
							StaffingSuggestionServiceLive.pipe(
								Layer.provide(workPolicyLayer),
								Layer.provide(DatabaseServiceLive),
							),
						),
					),
				)
			)[0]?.warnings ?? [];

		// 18 h + 2 h = 20 h: within the limit.
		expect(await suggest()).toEqual([]);

		await setBand(org, "07:00", "19:00");

		// 18 h + 3 h = 21 h of lecture-week daytime.
		expect(await suggest()).toEqual([
			{
				type: "compliance",
				findingType: "statutory",
				finding: expect.objectContaining({
					statutoryKind: "working_student_lecture_week",
					summary: expect.objectContaining({ used: { unit: "minutes", value: 1260 } }),
				}),
			},
		]);
	});
});
