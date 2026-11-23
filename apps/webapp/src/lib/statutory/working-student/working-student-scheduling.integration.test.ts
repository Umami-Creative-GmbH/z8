/**
 * #1991: working-student findings reach the schedule compliance evaluation (publish handshake,
 * banner) and Staffing suggestions through the real contributor registry, wage-free.
 */
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
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
import {
	addWeeks,
	weekdays,
	weekendOver20h,
	workingStudentFixture,
} from "./working-student.test.fixture";

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

	it("keeps the publish fingerprint steady while a clock-in without a shift runs", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 20 h worked Monday and Tuesday; clocked in at 09:00:42 on Wednesday without a shift. A
		// Friday evening shift keeps the student in the window.
		await fx.work(org, student, weekdays("2026-03-02", "08:00", "18:00").slice(0, 2));
		await fx.openWork(org, student, { date: "2026-03-04", start: "09:00:42" });
		await fx.shift(org, subareaId, student, { date: "2026-03-06", start: "18:00", end: "19:00" });

		const evaluate = async (now: string) => {
			// The service judges at the system clock.
			const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from(now));
			try {
				return await Effect.runPromise(
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
			} finally {
				clock.mockRestore();
			}
		};
		const usedOf = (result: Awaited<ReturnType<typeof evaluate>>) =>
			result.findings.flatMap((finding) =>
				finding.type === "statutory" && finding.statutoryKind === "working_student_lecture_week"
					? [finding.summary.used?.value]
					: [],
			);

		// Berlin is UTC+1 in March: 11:00:10 and 11:01:10 on Wednesday.
		const first = await evaluate("2026-03-04T10:00:10Z");
		const second = await evaluate("2026-03-04T10:01:10Z");

		// The running clock-in grew the week by a minute; what the planner acknowledges did not change.
		expect([usedOf(first), usedOf(second)]).toEqual([[1200 + 120], [1200 + 121]]);
		expect(second.fingerprint).toBe(first.fingerprint);
		// An hour later, too.
		expect((await evaluate("2026-03-04T11:07:55Z")).fingerprint).toBe(first.fingerprint);
	});

	it("makes the publish acknowledgement stale when a lecture-week breach deepens", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// Already 22 h of lecture-week daytime by plan in 2030-W10: Mon 8 h, Tue 8 h, Wed 6 h.
		await fx.shift(org, subareaId, student, { date: "2030-03-04", start: "09:00", end: "17:00" });
		await fx.shift(org, subareaId, student, { date: "2030-03-05", start: "09:00", end: "17:00" });
		await fx.shift(org, subareaId, student, { date: "2030-03-06", start: "09:00", end: "15:00" });
		const fingerprint = async () =>
			(
				await Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* ScheduleComplianceService;
						return yield* service.evaluateScheduleWindow({
							organizationId: org.id,
							startDate: shiftDateBounds("2030-03-04", TZ).start,
							endDateExclusive: shiftDateBounds("2030-03-11", TZ).start,
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
			).fingerprint;
		const shown = await fingerprint();

		// A Saturday shift is permitted weekend work: the lecture week is as deep as before.
		await fx.shift(org, subareaId, student, { date: "2030-03-09", start: "10:00", end: "12:00" });
		expect(await fingerprint()).toBe(shown);

		// A Thursday daytime shift deepens it, 22 h → 30 h, at the same severity and tier.
		await fx.shift(org, subareaId, student, { date: "2030-03-07", start: "09:00", end: "17:00" });
		expect(await fingerprint()).not.toBe(shown);
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

	it("warns Staffing when a proposed daytime shift deepens a lecture week already over 20 h", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// Already 22 h of lecture-week daytime by plan: Mon 8 h, Tue 8 h, Wed 6 h.
		await fx.shift(org, subareaId, student, { date: "2030-03-04", start: "09:00", end: "17:00" });
		await fx.shift(org, subareaId, student, { date: "2030-03-05", start: "09:00", end: "17:00" });
		await fx.shift(org, subareaId, student, { date: "2030-03-06", start: "09:00", end: "15:00" });

		const suggestions = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.id,
					timezone: TZ,
					candidates: [{ employeeId: student.employeeId, displayName: "Student", isActive: true }],
					shift: { subareaId, date: "2030-03-07", startTime: "09:00", endTime: "17:00" },
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

		expect(
			suggestions[0]?.warnings.filter(
				(warning) => warning.type === "compliance" && warning.findingType === "statutory",
			),
		).toEqual([
			{
				type: "compliance",
				findingType: "statutory",
				finding: expect.objectContaining({
					statutoryKind: "working_student_lecture_week",
					severity: "warning",
					subjectKey: "2030-W10",
					summary: expect.objectContaining({
						used: { unit: "minutes", value: 1800 },
						limit: { unit: "minutes", value: 1200 },
					}),
				}),
			},
		]);
	});

	// Mon 2030-03-04 … Sun 2030-03-10 is ISO week 2030-W10; planned shifts there have not started.
	const W10_2030 = "2030-03-04";

	it("adds the 26-week ceiling finding to the schedule compliance evaluation", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 26 planned permitted weekend weeks above 20 h before W10, and a 27th in W10.
		for (let index = -26; index <= 0; index++) {
			await fx.shift(org, subareaId, student, weekendOver20h(addWeeks(W10_2030, index)));
		}

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: org.id,
					startDate: shiftDateBounds(W10_2030, TZ).start,
					endDateExclusive: shiftDateBounds(addWeeks(W10_2030, 1), TZ).start,
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

		expect(result.findings.filter((finding) => finding.type === "statutory")).toEqual([
			expect.objectContaining({
				type: "statutory",
				employeeId: student.employeeId,
				findingId: `working_student_26_week_ceiling:${student.employeeId}:2030-W10`,
				statutoryKind: "working_student_26_week_ceiling",
				severity: "critical",
				subjectKey: "2030-W10",
				summary: expect.objectContaining({
					tier: "exceeded",
					used: { unit: "weeks", value: 27 },
					limit: { unit: "weeks", value: 26 },
				}),
				blocksPublication: false,
			}),
		]);
	});

	it("leaves later ceiling weeks out of a window whose own weeks stay within 20 h", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 22 planned weekend weeks above 20 h in W12–W33; W10 itself has 10 h of lecture-week work.
		for (let index = 2; index <= 23; index++) {
			await fx.shift(org, subareaId, student, weekendOver20h(addWeeks(W10_2030, index)));
		}
		await fx.shift(org, subareaId, student, { date: W10_2030, start: "09:00", end: "14:00" });
		await fx.shift(org, subareaId, student, { date: "2030-03-05", start: "09:00", end: "14:00" });

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: org.id,
					startDate: shiftDateBounds(W10_2030, TZ).start,
					endDateExclusive: shiftDateBounds(addWeeks(W10_2030, 1), TZ).start,
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

		expect(result.findings.filter((finding) => finding.type === "statutory")).toEqual([]);
		expect(result.summary.byType.statutory).toBe(0);
	});

	it("warns Staffing when a proposed shift makes the 27th week above 20 h", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const regular = await fx.workingStudent(org, "regular", { profile: "regular" });
		const subareaId = await fx.subarea(org, student);
		for (const person of [student, regular]) {
			for (let index = -26; index <= -1; index++) {
				await fx.shift(org, subareaId, person, weekendOver20h(addWeeks(W10_2030, index)));
			}
		}

		const suggestions = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.id,
					timezone: TZ,
					candidates: [
						{ employeeId: student.employeeId, displayName: "Student", isActive: true },
						{ employeeId: regular.employeeId, displayName: "Regular", isActive: true },
					],
					// A 22-hour Saturday: permitted weekend work, but the week is above 20 h.
					shift: { subareaId, date: "2030-03-09", startTime: "00:00", endTime: "22:00" },
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
		const statutoryWarnings = (name: string) =>
			suggestions
				.find((s) => s.displayName === name)
				?.warnings.filter(
					(warning) => warning.type === "compliance" && warning.findingType === "statutory",
				);
		expect(statutoryWarnings("Student")).toEqual([
			{
				type: "compliance",
				findingType: "statutory",
				finding: expect.objectContaining({
					statutoryKind: "working_student_26_week_ceiling",
					severity: "critical",
					subjectKey: "2030-W10",
					summary: expect.objectContaining({ used: { unit: "weeks", value: 27 } }),
				}),
			},
		]);
		expect(statutoryWarnings("Regular")).toEqual([]);
	});

	it("warns Staffing when a proposed >20 h week makes a later planned week the 27th", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 25 planned >20 h weeks before W10, and one five weeks later (2030-W15): 26 so far.
		for (let index = -25; index <= -1; index++) {
			await fx.shift(org, subareaId, student, weekendOver20h(addWeeks(W10_2030, index)));
		}
		await fx.shift(org, subareaId, student, weekendOver20h(addWeeks(W10_2030, 5)));

		const suggestions = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.id,
					timezone: TZ,
					candidates: [{ employeeId: student.employeeId, displayName: "Student", isActive: true }],
					// A 22-hour Saturday in W10: that week becomes the 26th, so W15 becomes the 27th.
					shift: { subareaId, date: "2030-03-09", startTime: "00:00", endTime: "22:00" },
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

		const ceiling = suggestions[0]?.warnings.flatMap((warning) =>
			warning.type === "compliance" && warning.findingType === "statutory" ? [warning.finding] : [],
		);
		expect(ceiling).toEqual([
			expect.objectContaining({
				statutoryKind: "working_student_26_week_ceiling",
				severity: "warning",
				subjectKey: "2030-W10",
				summary: expect.objectContaining({ used: { unit: "weeks", value: 26 } }),
			}),
			expect.objectContaining({
				statutoryKind: "working_student_26_week_ceiling",
				severity: "critical",
				subjectKey: "2030-W15",
				summary: expect.objectContaining({ used: { unit: "weeks", value: 27 } }),
			}),
		]);
	});

	it("does not warn Staffing about later ceiling weeks a proposed >20 h week leaves at their tier", async () => {
		const org = await fx.organization("a", TZ);
		const student = await fx.workingStudent(org, "student");
		const subareaId = await fx.subarea(org, student);
		// 20 planned >20 h weeks before W10, and W11–W14: 21 to 24 of 26 weeks, all at warning tier.
		for (const index of [...Array.from({ length: 20 }, (_, i) => i - 20), 1, 2, 3, 4]) {
			await fx.shift(org, subareaId, student, weekendOver20h(addWeeks(W10_2030, index)));
		}

		const suggestions = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.id,
					timezone: TZ,
					candidates: [{ employeeId: student.employeeId, displayName: "Student", isActive: true }],
					// A 22-hour Saturday pushes W10 above 20 h: every later week counts one more.
					shift: { subareaId, date: "2030-03-09", startTime: "00:00", endTime: "22:00" },
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

		const ceiling = suggestions[0]?.warnings.flatMap((warning) =>
			warning.type === "compliance" && warning.findingType === "statutory" ? [warning.finding] : [],
		);
		// W10 is new; W14 moves from 24 to 25 of 26 weeks, the critical tier; W11–W13 stay warnings.
		expect(ceiling).toEqual([
			expect.objectContaining({
				statutoryKind: "working_student_26_week_ceiling",
				subjectKey: "2030-W10",
				summary: expect.objectContaining({ tier: "warning", used: { unit: "weeks", value: 21 } }),
			}),
			expect.objectContaining({
				statutoryKind: "working_student_26_week_ceiling",
				subjectKey: "2030-W14",
				summary: expect.objectContaining({ tier: "critical", used: { unit: "weeks", value: 25 } }),
			}),
		]);
	});
});
