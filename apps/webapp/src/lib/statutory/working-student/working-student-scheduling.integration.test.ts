/**
 * #1991: working-student findings reach the schedule compliance evaluation (publish handshake,
 * banner) and Staffing suggestions through the real contributor registry, wage-free.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { weekdays, workingStudentFixture } from "./working-student.test.fixture";

vi.mock("@/lib/calendar/work-policy-requirements", async () => {
	const { Effect } = await import("effect");
	return { loadDailyWorkRequirementsForEmployee: () => Effect.succeed({}) };
});

const TZ = "Europe/Berlin";
const workPolicyLayer = Layer.succeed(WorkPolicyService, {
	getEffectivePolicy: () => Effect.succeed(null),
	getEffectivePolicyAt: () => Effect.succeed(null),
} as never);

describe("working-student findings in Scheduling and Staffing (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const fx = workingStudentFixture(integrationAdminPool(), "t1991-scheduling");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	it("adds the lecture-week finding to the schedule compliance evaluation", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// Worked 25 h of lecture-week daytime in 2026-W10; a shift keeps the student in the window.
		await fx.work(org, student, weekdays("2026-03-02", "09:00", "14:00"));
		await fx.shift(org, subareaId, student, { date: "2026-03-04", start: "15:00", end: "16:00" });

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: org.id,
					startDate: shiftDateBounds("2026-03-02", TZ).start,
					endDateExclusive: shiftDateBounds("2026-03-09", TZ).start,
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
		);

		expect(result.summary.byType.statutory).toBe(1);
		expect(result.findings).toEqual([
			{
				type: "statutory",
				employeeId: student.employeeId,
				findingId: `working_student_lecture_week:${student.employeeId}:2026-W10`,
				statutoryKind: "working_student_lecture_week",
				domain: "working_student",
				severity: "critical",
				subjectKey: "2026-W10",
				legalReference: expect.stringContaining("SGB V"),
				summary: {
					tier: "exceeded",
					usedPercent: 125,
					used: { unit: "minutes", value: 1500 },
					limit: { unit: "minutes", value: 1200 },
					remaining: { unit: "minutes", value: 0 },
				},
				acknowledgementStatus: "none",
				blocksPublication: false,
			},
		]);
	});

	it("warns Staffing about the working student a proposed daytime shift pushes over 20 h", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const regular = await fx.workingStudent(org, "regular", { profile: "regular" });
		const subareaId = await fx.subarea(org, student);
		// Far in the future so the planned shifts have not started: Mon + Tue 8 h, Thu 2 h = 18 h.
		for (const person of [student, regular]) {
			await fx.shift(org, subareaId, person, { date: "2030-03-04", start: "09:00", end: "17:00" });
			await fx.shift(org, subareaId, person, { date: "2030-03-05", start: "09:00", end: "17:00" });
			await fx.shift(org, subareaId, person, { date: "2030-03-07", start: "09:00", end: "11:00" });
		}

		const suggest = (startTime: string, endTime: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* StaffingSuggestionService;
					return yield* service.suggestForShift({
						organizationId: org.id,
						timezone: TZ,
						candidates: [
							{ employeeId: student.employeeId, displayName: "Student", isActive: true },
							{ employeeId: regular.employeeId, displayName: "Regular", isActive: true },
						],
						shift: { subareaId, date: "2030-03-06", startTime, endTime },
					});
				}).pipe(
					Effect.provide(
						StaffingSuggestionServiceLive.pipe(
							Layer.provide(workPolicyLayer),
							Layer.provide(DatabaseServiceLive),
						),
					),
				),
			);

		const daytime = new Map((await suggest("08:00", "16:00")).map((s) => [s.displayName, s]));
		expect(daytime.get("Student")?.warnings).toEqual([
			{
				type: "compliance",
				findingType: "statutory",
				finding: expect.objectContaining({
					statutoryKind: "working_student_lecture_week",
					severity: "warning",
					subjectKey: "2030-W10",
					summary: expect.objectContaining({ used: { unit: "minutes", value: 1560 } }),
				}),
			},
		]);
		expect(daytime.get("Regular")?.warnings).toEqual([]);

		// The same 8 hours in the evening keep the lecture week permitted.
		const evening = new Map((await suggest("18:00", "02:00")).map((s) => [s.displayName, s]));
		expect(evening.get("Student")?.warnings).toEqual([]);
	});
});
