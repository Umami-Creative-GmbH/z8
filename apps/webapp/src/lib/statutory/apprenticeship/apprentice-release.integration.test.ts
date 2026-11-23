/**
 * #1993: BBiG § 15 / JArbSchG § 9 apprentice release (real PostgreSQL). Credited school, block
 * and exam days release required working time in Work Balance (single and range readers agree),
 * in full or in part are no working days for Absences (a vacation over them never deducts them), and Staffing warns
 * planners about shifts on them. Only employees whose terms make them apprentices are credited.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { getAbsenceDays } from "@/lib/absences/absence-days-resolver";
import { loadDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { loadDailyWorkRequirementsForEmployees } from "@/lib/calendar/work-policy-range-requirements";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	type StaffingCandidate,
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "@/lib/effect/services/staffing-suggestion.service";
import { WorkPolicyService } from "@/lib/effect/services/work-policy.service";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import { recordApprenticeRelease } from "../employee-context";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import { apprenticeReleaseScheduleContributor } from "./release-conflict-contributor";
import {
	recordApprenticeReleaseWithCredit,
	voidApprenticeReleaseWithCredit,
} from "./release-credit-view";
import { jarbschgScheduleContributor } from "../youth/jarbschg-contributor";
import { loadYouthSchoolCredits } from "../youth/school-credits";
import { localInstant, youthSeed } from "../youth/testing/youth-seed";

const staffingLayer = StaffingSuggestionServiceLive.pipe(
	Layer.provide(
		Layer.succeed(WorkPolicyService, {
			getEffectivePolicyAt: () => Effect.succeed(null),
		} as never),
	),
	Layer.provide(DatabaseServiceLive),
);

describe("apprentice release crediting (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993ap");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
	});
	afterAll(fx.cleanup);

	async function apprentice(
		key: string,
		birthday: string,
		profile: "apprentice" | "regular" = "apprentice",
	) {
		const who = await fx.employee(org, key, { birthday });
		await seed.terms(who, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: profile,
		});
		return who;
	}

	/** Tue 2 Mar 2027: 6 lessons; Thu 4 Mar: 6 lessons again; 8–12 Mar block week; exam 17 Mar. */
	async function recordReleases(who: FixtureEmployee) {
		const scope = { organizationId: org.id, employeeId: who.employeeId, actorUserId: owner.userId };
		await recordApprenticeRelease(db, {
			...scope,
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-02",
			endsOn: "2027-03-02",
			lessonCount: 6,
		});
		await recordApprenticeRelease(db, {
			...scope,
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-04",
			endsOn: "2027-03-04",
			lessonCount: 6,
		});
		await recordApprenticeRelease(db, {
			...scope,
			releaseKind: "vocational_school_block_week",
			startsOn: "2027-03-08",
			endsOn: "2027-03-12",
			schoolMinutes: 1500,
		});
		await recordApprenticeRelease(db, {
			...scope,
			releaseKind: "pre_exam_day",
			startsOn: "2027-03-16",
			endsOn: "2027-03-16",
		});
		await recordApprenticeRelease(db, {
			...scope,
			releaseKind: "exam_day",
			startsOn: "2027-03-17",
			endsOn: "2027-03-17",
		});
	}

	const RANGE = {
		startDate: new Date("2027-03-01T00:00:00+01:00"),
		endDate: new Date("2027-03-19T23:59:59+01:00"),
	};

	const requirementsOf = (who: FixtureEmployee) =>
		Effect.runPromise(
			loadDailyWorkRequirementsForEmployee({
				organizationId: org.id,
				employeeId: who.employeeId,
				...RANGE,
			}).pipe(Effect.provide(DatabaseServiceLive)),
		);

	it("releases required time on credited days without ever going negative", async () => {
		const learner = await apprentice("learner", "2005-05-05");
		await recordReleases(learner);
		const required = await requirementsOf(learner);
		const minutes = (date: string) => required[date]?.requiredMinutes;

		const workday = minutes("2027-03-01") ?? 0;
		expect(workday).toBeGreaterThan(270);
		expect(minutes("2027-03-02")).toBe(0); // First long school day of the week: a full day.
		expect(minutes("2027-03-04")).toBe(workday - 6 * 45); // Second one: its lessons.
		for (const date of ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"]) {
			expect(minutes(date)).toBe(0); // Block week of 25 h on five days.
		}
		expect(minutes("2027-03-16")).toBe(0);
		expect(minutes("2027-03-17")).toBe(0);
		expect(minutes("2027-03-18")).toBe(workday);
		expect(Object.values(required).every((day) => day.requiredMinutes >= 0)).toBe(true);
	});

	it("credits the same days through the range reader", async () => {
		const learner = await apprentice("ranged", "2005-05-05");
		await recordReleases(learner);
		const single = await requirementsOf(learner);
		const people = await db.query.employee.findMany({
			where: (table, { eq }) => eq(table.id, learner.employeeId),
			columns: {
				id: true,
				organizationId: true,
				teamId: true,
				startDate: true,
				contractType: true,
			},
			with: {
				user: { columns: { createdAt: true } },
				userSettings: { columns: { timezone: true } },
				organization: { columns: { timezone: true } },
			},
		});
		const { requirements } = await Effect.runPromise(
			loadDailyWorkRequirementsForEmployees({
				organizationId: org.id,
				employees: people,
				...RANGE,
				trackingByEmployee: new Map([
					[learner.employeeId, { startDate: "2026-01-01", timezone: org.timezone }],
				]),
			}).pipe(Effect.provide(DatabaseServiceLive)),
		);
		const ranged = requirements.get(learner.employeeId) ?? {};
		for (const date of ["2027-03-01", "2027-03-02", "2027-03-04", "2027-03-09", "2027-03-17"]) {
			expect(ranged[date]?.requiredMinutes).toBe(single[date]?.requiredMinutes);
		}
		expect(ranged["2027-03-02"]?.requiredMinutes).toBe(0);
	});

	it("credits a two-week block per school week, whatever range clock-out or Scheduling reads", async () => {
		const learner = await apprentice("twoweeks", "2011-01-01");
		await recordApprenticeRelease(db, {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
			releaseKind: "vocational_school_block_week",
			startsOn: "2027-03-01",
			endsOn: "2027-03-12",
			schoolMinutes: 1500,
		});
		const creditsOver = async (from: string, until: string) =>
			new Map(
				(
					(
						await loadYouthSchoolCredits(db, {
							organizationId: org.id,
							employeeIds: [learner.employeeId],
							from,
							until,
						})
					).get(learner.employeeId) ?? []
				).map((credit) => [credit.date, credit.minutes]),
			);
		// A clock-out on Wednesday 3 March reads its week (Sunday before to the Tuesday after).
		const clockOut = await creditsOver("2027-02-28", "2027-03-09");
		const window = await creditsOver("2027-03-01", "2027-03-15");
		for (const date of ["2027-03-01", "2027-03-03", "2027-03-05", "2027-03-08"]) {
			expect(clockOut.get(date)).toBe(480);
			expect(window.get(date)).toBe(480);
		}
		expect(window.has("2027-03-06")).toBe(false);
		expect(window.has("2027-03-07")).toBe(false);
		expect([...window.values()].reduce((total, minutes) => total + minutes, 0)).toBe(4800);
	});

	it("credits a full school day with the minor's average working day (35 h week)", async () => {
		const subareaId = await seed.subarea(org, owner);
		const scheduleWeek = async (key: string, weeklyContractMinutes: number) => {
			const minor = await fx.employee(org, key, { birthday: "2011-01-01" });
			await seed.terms(minor, {
				from: "2026-01-01",
				createdBy: owner.userId,
				employmentProfile: "apprentice",
				weeklyContractMinutes,
			});
			// Monday 1 March 2027: the week's full school day.
			await recordApprenticeRelease(db, {
				organizationId: org.id,
				employeeId: minor.employeeId,
				actorUserId: owner.userId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-01",
				endsOn: "2027-03-01",
				lessonCount: 6,
			});
			// Tuesday to Friday 08:00–17:15: 8 h 15 min of work after the 60 min youth break.
			for (const date of ["2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05"]) {
				await seed.shift(org, minor, {
					subareaId,
					creatorUserId: owner.userId,
					date,
					startTime: "08:00",
					endTime: "17:15",
				});
			}
			const credits = await loadYouthSchoolCredits(db, {
				organizationId: org.id,
				employeeIds: [minor.employeeId],
				from: "2027-03-01",
				until: "2027-03-08",
			});
			const findings = await jarbschgScheduleContributor.evaluate({
				db,
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2027-03-01", endExclusive: "2027-03-08" },
				employeeIds: [minor.employeeId],
				proposedShifts: [],
				replacesShiftId: null,
				preferences: DEFAULT_STATUTORY_PREFERENCES,
				now: localInstant("2027-02-20", "12:00", org.timezone),
			});
			return {
				monday: credits.get(minor.employeeId)?.find((credit) => credit.date === "2027-03-01"),
				kinds: findings.map((finding) => finding.kind),
			};
		};

		// 7 h + 4 × 8 h 15 min = 40 h, and Monday is a shortened day for the 8.5 h allowance.
		const parttime = await scheduleWeek("parttime", 2100);
		expect(parttime.monday?.minutes).toBe(420);
		expect(parttime.kinds).toEqual([]);

		// A 40 h minor's school day counts 8 h: the same week is too long.
		const fulltime = await scheduleWeek("fulltime", 2400);
		expect(fulltime.monday?.minutes).toBe(480);
		expect(fulltime.kinds).toContain("jarbschg_weekly_max");
	});

	it("upgrades a partly credited school day before an exam to a full release day", async () => {
		const learner = await apprentice("preexam", "2005-05-05");
		const scope = {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
		};
		// Wednesday 3 March 2027: four lessons, only partly credited.
		const partial = await recordApprenticeRelease(db, {
			...scope,
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-03",
			endsOn: "2027-03-03",
			lessonCount: 4,
		});
		// The written final exam on Thursday releases the working day before it in full.
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "exam_day",
			startsOn: "2027-03-04",
			endsOn: "2027-03-04",
			includePreExamDay: true,
		});

		const required = await requirementsOf(learner);
		expect(required["2027-03-03"]?.requiredMinutes).toBe(0);
		expect(required["2027-03-04"]?.requiredMinutes).toBe(0);
		expect(
			await getAbsenceDays(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				absence: {
					startDate: "2027-03-03",
					startPeriod: "full_day",
					endDate: "2027-03-03",
					endPeriod: "full_day",
				},
			}),
		).toBe(0);

		// The partial school day is voided with a reason; the pre-exam day replaces it.
		const { rows } = await admin.query<{
			id: string;
			release_kind: string;
			voided_at: Date | null;
			void_reason: string | null;
		}>(
			`select id, release_kind, voided_at, void_reason from employee_apprentice_release
			 where organization_id = $1 and employee_id = $2 and starts_on = '2027-03-03'
			 order by created_at`,
			[org.id, learner.employeeId],
		);
		expect(rows).toEqual([
			expect.objectContaining({
				id: partial.id,
				release_kind: "vocational_school_day",
				voided_at: expect.any(Date),
				void_reason: expect.stringContaining("pre-exam"),
			}),
			expect.objectContaining({ release_kind: "pre_exam_day", voided_at: null }),
		]);
	});

	/** The employee's active releases, oldest day first. */
	const activeReleases = async (who: FixtureEmployee) =>
		(
			await admin.query<{
				release_kind: string;
				starts_on: string;
				school_minutes: number | null;
			}>(
				`select release_kind, to_char(starts_on, 'YYYY-MM-DD') as starts_on, school_minutes
				 from employee_apprentice_release
				 where organization_id = $1 and employee_id = $2 and voided_at is null
				 order by starts_on`,
				[org.id, who.employeeId],
			)
		).rows;

	const timedExam = (who: FixtureEmployee, date: string) =>
		recordApprenticeReleaseWithCredit(db, {
			organizationId: org.id,
			employeeId: who.employeeId,
			actorUserId: owner.userId,
			releaseKind: "exam_day",
			startsOn: date,
			endsOn: date,
			examStartTime: "09:00",
			examEndTime: "13:00",
			includePreExamDay: true,
		});

	it("releases one pre-exam day before a two-day exam and keeps both exam days", async () => {
		const learner = await apprentice("twoday", "2005-05-05");
		// Wednesday 3 and Thursday 4 March 2027, recorded day by day.
		await timedExam(learner, "2027-03-03");
		await timedExam(learner, "2027-03-04");

		expect(await activeReleases(learner)).toEqual([
			{ release_kind: "pre_exam_day", starts_on: "2027-03-02", school_minutes: null },
			{ release_kind: "exam_day", starts_on: "2027-03-03", school_minutes: 240 },
			{ release_kind: "exam_day", starts_on: "2027-03-04", school_minutes: 240 },
		]);
	});

	it("moves the pre-exam day before an exam day recorded on it", async () => {
		const learner = await apprentice("twodayback", "2005-05-05");
		// Thursday first: Wednesday becomes its pre-exam day, until Wednesday is an exam day too.
		await timedExam(learner, "2027-03-04");
		await timedExam(learner, "2027-03-03");

		expect(await activeReleases(learner)).toEqual([
			{ release_kind: "pre_exam_day", starts_on: "2027-03-02", school_minutes: null },
			{ release_kind: "exam_day", starts_on: "2027-03-03", school_minutes: 240 },
			{ release_kind: "exam_day", starts_on: "2027-03-04", school_minutes: 240 },
		]);
	});

	it("voids an exam's pre-exam day with it and restores the school day it replaced", async () => {
		const learner = await apprentice("voidexam", "2005-05-05");
		const scope = {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
		};
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-03",
			endsOn: "2027-03-03",
			lessonCount: 4,
			note: "Berufsschule",
		});
		await timedExam(learner, "2027-03-04");
		const [exam] = (
			await admin.query<{ id: string }>(
				`select id from employee_apprentice_release
				 where organization_id = $1 and employee_id = $2 and release_kind = 'exam_day'`,
				[org.id, learner.employeeId],
			)
		).rows;

		await voidApprenticeReleaseWithCredit(db, {
			...scope,
			releaseId: exam.id,
			reason: "Exam moved to June",
		});

		const { rows } = await admin.query<{
			release_kind: string;
			starts_on: string;
			lesson_count: number | null;
			note: string | null;
		}>(
			`select release_kind, to_char(starts_on, 'YYYY-MM-DD') as starts_on, lesson_count, note
			 from employee_apprentice_release
			 where organization_id = $1 and employee_id = $2 and voided_at is null`,
			[org.id, learner.employeeId],
		);
		expect(rows).toEqual([
			{
				release_kind: "vocational_school_day",
				starts_on: "2027-03-03",
				lesson_count: 4,
				note: expect.stringMatching(/^Berufsschule\n.*restored.*2027-03-04/is),
			},
		]);
		const required = await requirementsOf(learner);
		expect(required["2027-03-03"]?.requiredMinutes).toBe(
			(required["2027-03-01"]?.requiredMinutes ?? 0) - 4 * 45,
		);
	});

	describe("voiding a pre-exam day restores the school day it replaced", () => {
		const schoolDay = (who: FixtureEmployee) =>
			recordApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: who.employeeId,
				actorUserId: owner.userId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-03",
				endsOn: "2027-03-03",
				lessonCount: 4,
				schoolStartTime: "08:00",
				schoolEndTime: "11:30",
				note: "Berufsschule",
			});
		const preExamDayId = async (who: FixtureEmployee) =>
			(
				await admin.query<{ id: string }>(
					`select id from employee_apprentice_release
					 where organization_id = $1 and employee_id = $2 and release_kind = 'pre_exam_day'
					   and voided_at is null`,
					[org.id, who.employeeId],
				)
			).rows[0].id;
		const restored = async (who: FixtureEmployee) =>
			(
				await admin.query<{
					release_kind: string;
					starts_on: string;
					lesson_count: number | null;
					school_minutes: number | null;
					school_start_time: string | null;
					school_end_time: string | null;
					note: string | null;
				}>(
					`select release_kind, to_char(starts_on, 'YYYY-MM-DD') as starts_on, lesson_count,
					        school_minutes, school_start_time::text, school_end_time::text, note
					 from employee_apprentice_release
					 where organization_id = $1 and employee_id = $2 and voided_at is null
					 order by starts_on`,
					[org.id, who.employeeId],
				)
			).rows;
		const wednesday = {
			release_kind: "vocational_school_day",
			starts_on: "2027-03-03",
			lesson_count: 4,
			school_minutes: 210,
			school_start_time: "08:00:00",
			school_end_time: "11:30:00",
			note: expect.stringMatching(/^Berufsschule\n.*restored.*pre-exam day/is),
		};

		it("when a pre-exam day recorded on its own is voided", async () => {
			const learner = await apprentice("standalonevoid", "2005-05-05");
			const scope = {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
			};
			await schoolDay(learner);
			await recordApprenticeReleaseWithCredit(db, {
				...scope,
				releaseKind: "pre_exam_day",
				startsOn: "2027-03-03",
				endsOn: "2027-03-03",
			});
			await voidApprenticeReleaseWithCredit(db, {
				...scope,
				releaseId: await preExamDayId(learner),
				reason: "Recorded by mistake",
			});

			expect(await restored(learner)).toEqual([wednesday]);
			const required = await requirementsOf(learner);
			expect(required["2027-03-03"]?.requiredMinutes).toBe(
				(required["2027-03-01"]?.requiredMinutes ?? 0) - 210,
			);
		});

		it("when an exam's pre-exam day is voided, and the exam stays", async () => {
			const learner = await apprentice("linkedvoid", "2005-05-05");
			await schoolDay(learner);
			await timedExam(learner, "2027-03-04");
			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: await preExamDayId(learner),
				reason: "Not the written final exam",
			});

			expect(await restored(learner)).toEqual([
				wednesday,
				expect.objectContaining({ release_kind: "exam_day", starts_on: "2027-03-04" }),
			]);
		});
	});

	it("moves the pre-exam day of a multi-day exam when its first exam day is voided", async () => {
		const learner = await apprentice("voidfirst", "2005-05-05");
		await timedExam(learner, "2027-03-03");
		await timedExam(learner, "2027-03-04");
		const [wednesday] = (
			await admin.query<{ id: string }>(
				`select id from employee_apprentice_release
				 where organization_id = $1 and employee_id = $2 and starts_on = '2027-03-03'`,
				[org.id, learner.employeeId],
			)
		).rows;

		await voidApprenticeReleaseWithCredit(db, {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
			releaseId: wednesday.id,
			reason: "Recorded on the wrong day",
		});

		expect(await activeReleases(learner)).toEqual([
			{ release_kind: "pre_exam_day", starts_on: "2027-03-03", school_minutes: null },
			{ release_kind: "exam_day", starts_on: "2027-03-04", school_minutes: 240 },
		]);
	});

	it("releases a pre-exam day in full inside a block that is no full block week, and keeps the block", async () => {
		const learner = await apprentice("partialblock", "2005-05-05");
		const scope = {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
		};
		// Monday 1 to Wednesday 3 March 2027: 15 h of school, no full block week.
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "vocational_school_block_week",
			startsOn: "2027-03-01",
			endsOn: "2027-03-03",
			schoolMinutes: 900,
		});
		const [exam] = await recordExamWithPreExamDay(learner, "2027-03-04");

		expect(await activeReleases(learner)).toEqual([
			{
				release_kind: "vocational_school_block_week",
				starts_on: "2027-03-01",
				school_minutes: 900,
			},
			{ release_kind: "pre_exam_day", starts_on: "2027-03-03", school_minutes: null },
			{ release_kind: "exam_day", starts_on: "2027-03-04", school_minutes: null },
		]);
		// Wednesday counts the average working day, not the block's 5 h of school.
		const credits = await loadYouthSchoolCredits(db, {
			organizationId: org.id,
			employeeIds: [learner.employeeId],
			from: "2027-03-01",
			until: "2027-03-08",
		});
		expect(
			Math.max(
				...(credits.get(learner.employeeId) ?? [])
					.filter((credit) => credit.date === "2027-03-03")
					.map((credit) => credit.minutes),
			),
		).toBe(480);
		const required = await requirementsOf(learner);
		const workday = required["2027-03-05"]?.requiredMinutes ?? 0;
		expect(workday).toBeGreaterThan(300);
		expect(required["2027-03-02"]?.requiredMinutes).toBe(workday - 300);
		expect(required["2027-03-03"]?.requiredMinutes).toBe(0);
		expect(Object.values(required).every((day) => day.requiredMinutes >= 0)).toBe(true);

		// An afternoon shift on Wednesday conflicts with the release.
		const subareaId = await seed.subarea(org, owner);
		const [suggestion] = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.id,
					timezone: org.timezone,
					candidates: [{ employeeId: learner.employeeId, displayName: "Learner", isActive: true }],
					shift: { subareaId, date: "2027-03-03", startTime: "13:00", endTime: "17:00" },
				});
			}).pipe(Effect.provide(staffingLayer)),
		);
		expect(
			(suggestion?.warnings ?? []).flatMap((warning) =>
				warning.type === "compliance" && warning.finding.type === "statutory"
					? [warning.finding.statutoryKind]
					: [],
			),
		).toContain("bbig_release_day_shift");

		// Voiding the exam voids its pre-exam day and leaves the block as it was.
		await voidApprenticeReleaseWithCredit(db, {
			...scope,
			releaseId: exam.id,
			reason: "Exam moved to June",
		});
		expect(await activeReleases(learner)).toEqual([
			{
				release_kind: "vocational_school_block_week",
				starts_on: "2027-03-01",
				school_minutes: 900,
			},
		]);
		expect((await requirementsOf(learner))["2027-03-03"]?.requiredMinutes).toBe(workday - 300);
	});

	describe("a block recorded over a pre-exam day", () => {
		const block = (who: FixtureEmployee, endsOn: string, schoolMinutes: number) =>
			recordApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: who.employeeId,
				actorUserId: owner.userId,
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-01",
				endsOn,
				schoolMinutes,
			});
		const idOf = async (who: FixtureEmployee, kind: string) =>
			(
				await admin.query<{ id: string }>(
					`select id from employee_apprentice_release
					 where organization_id = $1 and employee_id = $2 and release_kind = $3
					   and voided_at is null`,
					[org.id, who.employeeId, kind],
				)
			).rows[0].id;

		it("lies under the pre-exam day when it credits the day only partly, also when corrected", async () => {
			const learner = await apprentice("blocklater", "2005-05-05");
			// The exam on Friday 5 March 2027 makes Thursday its pre-exam day.
			await recordExamWithPreExamDay(learner, "2027-03-05");
			// The week's 20 h block, Monday to Thursday, entered afterwards.
			await block(learner, "2027-03-04", 1200);
			// Corrected: voided and entered again with other hours.
			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: await idOf(learner, "vocational_school_block_week"),
				reason: "Wrong hours",
			});
			await block(learner, "2027-03-04", 960);

			expect(await activeReleases(learner)).toEqual([
				{
					release_kind: "vocational_school_block_week",
					starts_on: "2027-03-01",
					school_minutes: 960,
				},
				{ release_kind: "pre_exam_day", starts_on: "2027-03-04", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-05", school_minutes: null },
			]);
			const required = await requirementsOf(learner);
			expect(required["2027-03-04"]?.requiredMinutes).toBe(0);
			expect(required["2027-03-03"]?.requiredMinutes).toBe(
				(required["2027-03-08"]?.requiredMinutes ?? 0) - 240,
			);
		});

		it("replaces the pre-exam day on a full block day, and gives it back when voided", async () => {
			const learner = await apprentice("fullblocklater", "2005-05-05");
			// The exam on Monday 8 March 2027 makes Friday 5 March its pre-exam day.
			const [exam] = await recordExamWithPreExamDay(learner, "2027-03-08");
			// A full block week, Monday to Friday, 25 h: Friday stays released in full by the block.
			await block(learner, "2027-03-05", 1500);
			expect(await activeReleases(learner)).toEqual([
				{
					release_kind: "vocational_school_block_week",
					starts_on: "2027-03-01",
					school_minutes: 1500,
				},
				{ release_kind: "exam_day", starts_on: "2027-03-08", school_minutes: null },
			]);

			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: await idOf(learner, "vocational_school_block_week"),
				reason: "Block cancelled",
			});
			expect(await activeReleases(learner)).toEqual([
				{ release_kind: "pre_exam_day", starts_on: "2027-03-05", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-08", school_minutes: null },
			]);
			// The restored pre-exam day still belongs to its exam.
			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: exam.id,
				reason: "Exam moved",
			});
			expect(await activeReleases(learner)).toEqual([]);
		});

		describe("gives back the school day a voided exam's pre-exam day replaced, whatever the order", () => {
			/**
			 * Friday 5 March 2027 a four-lesson school day; the exam on Monday 8 March makes Friday its
			 * pre-exam day, replacing the school day; then a full block week, Monday 1 to Friday 5
			 * March, replaces the pre-exam day.
			 */
			async function schoolDayUnderPreExamDayUnderBlock(who: FixtureEmployee) {
				await recordApprenticeReleaseWithCredit(db, {
					organizationId: org.id,
					employeeId: who.employeeId,
					actorUserId: owner.userId,
					releaseKind: "vocational_school_day",
					startsOn: "2027-03-05",
					endsOn: "2027-03-05",
					lessonCount: 4,
				});
				const [exam] = await recordExamWithPreExamDay(who, "2027-03-08");
				await block(who, "2027-03-05", 1500);
				return exam.id;
			}
			const voidRelease = (who: FixtureEmployee, releaseId: string) =>
				voidApprenticeReleaseWithCredit(db, {
					organizationId: org.id,
					employeeId: who.employeeId,
					actorUserId: owner.userId,
					releaseId,
					reason: "Cancelled",
				});
			const schoolFriday = {
				release_kind: "vocational_school_day",
				starts_on: "2027-03-05",
				school_minutes: null,
			};

			it("when the exam is voided first, then the block", async () => {
				const learner = await apprentice("examthenblock", "2005-05-05");
				const examId = await schoolDayUnderPreExamDayUnderBlock(learner);
				const blockId = await idOf(learner, "vocational_school_block_week");
				await voidRelease(learner, examId);
				expect(await activeReleases(learner)).toEqual([
					{
						release_kind: "vocational_school_block_week",
						starts_on: "2027-03-01",
						school_minutes: 1500,
					},
				]);
				await voidRelease(learner, blockId);
				expect(await activeReleases(learner)).toEqual([schoolFriday]);
			});

			it("when the block is voided first, then the exam", async () => {
				const learner = await apprentice("blockthenexam", "2005-05-05");
				const examId = await schoolDayUnderPreExamDayUnderBlock(learner);
				await voidRelease(learner, await idOf(learner, "vocational_school_block_week"));
				expect(await activeReleases(learner)).toEqual([
					{ release_kind: "pre_exam_day", starts_on: "2027-03-05", school_minutes: null },
					{ release_kind: "exam_day", starts_on: "2027-03-08", school_minutes: null },
				]);
				await voidRelease(learner, examId);
				expect(await activeReleases(learner)).toEqual([schoolFriday]);
			});
		});

		it("moves a multi-day exam's pre-exam day off a full block day when the first exam day is voided", async () => {
			const learner = await apprentice("blockrun", "2005-05-05");
			await block(learner, "2027-03-05", 1500);
			// Monday 8 and Tuesday 9 March 2027: their pre-exam day, Friday, is a full block day.
			const [monday] = await recordExamWithPreExamDay(learner, "2027-03-08");
			await recordExamWithPreExamDay(learner, "2027-03-09");
			expect(await activeReleases(learner)).toEqual([
				{
					release_kind: "vocational_school_block_week",
					starts_on: "2027-03-01",
					school_minutes: 1500,
				},
				{ release_kind: "exam_day", starts_on: "2027-03-08", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-09", school_minutes: null },
			]);

			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: monday.id,
				reason: "Recorded on the wrong day",
			});
			expect(await activeReleases(learner)).toEqual([
				{
					release_kind: "vocational_school_block_week",
					starts_on: "2027-03-01",
					school_minutes: 1500,
				},
				{ release_kind: "pre_exam_day", starts_on: "2027-03-08", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-09", school_minutes: null },
			]);

			// The block voided later leaves Friday free: Monday stays the only pre-exam day.
			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: await idOf(learner, "vocational_school_block_week"),
				reason: "Block cancelled",
			});
			expect(await activeReleases(learner)).toEqual([
				{ release_kind: "pre_exam_day", starts_on: "2027-03-08", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-09", school_minutes: null },
			]);
		});

		it("gives a multi-day exam its pre-exam day back when the block under it is voided first", async () => {
			const learner = await apprentice("blockrunback", "2005-05-05");
			await block(learner, "2027-03-05", 1500);
			const [monday] = await recordExamWithPreExamDay(learner, "2027-03-08");
			await recordExamWithPreExamDay(learner, "2027-03-09");

			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: await idOf(learner, "vocational_school_block_week"),
				reason: "Block cancelled",
			});
			expect(await activeReleases(learner)).toEqual([
				{ release_kind: "pre_exam_day", starts_on: "2027-03-05", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-08", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-09", school_minutes: null },
			]);

			await voidApprenticeReleaseWithCredit(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseId: monday.id,
				reason: "Recorded on the wrong day",
			});
			expect(await activeReleases(learner)).toEqual([
				{ release_kind: "pre_exam_day", starts_on: "2027-03-08", school_minutes: null },
				{ release_kind: "exam_day", starts_on: "2027-03-09", school_minutes: null },
			]);
		});

		it("gives no pre-exam day to the rest of a multi-day exam recorded without one", async () => {
			const learner = await apprentice("blockrunnone", "2005-05-05");
			await block(learner, "2027-03-05", 1500);
			const scope = {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
			};
			for (const day of ["2027-03-08", "2027-03-09"]) {
				await recordApprenticeReleaseWithCredit(db, {
					...scope,
					releaseKind: "exam_day",
					startsOn: day,
					endsOn: day,
				});
			}
			await voidApprenticeReleaseWithCredit(db, {
				...scope,
				releaseId: (await recordedExam(learner, "2027-03-08")).id,
				reason: "Recorded on the wrong day",
			});
			expect(await activeReleases(learner)).toEqual([
				{
					release_kind: "vocational_school_block_week",
					starts_on: "2027-03-01",
					school_minutes: 1500,
				},
				{ release_kind: "exam_day", starts_on: "2027-03-09", school_minutes: null },
			]);
		});

		it("is still refused over an exam day", async () => {
			const learner = await apprentice("blockexam", "2005-05-05");
			await recordExamWithPreExamDay(learner, "2027-03-04");
			await expect(block(learner, "2027-03-05", 1500)).rejects.toMatchObject({
				refusal: "apprentice_release_day_already_released",
			});
		});
	});

	/** Records a written exam on `date` with its pre-exam day; returns the exam row. */
	async function recordExamWithPreExamDay(who: FixtureEmployee, date: string) {
		await recordApprenticeReleaseWithCredit(db, {
			organizationId: org.id,
			employeeId: who.employeeId,
			actorUserId: owner.userId,
			releaseKind: "exam_day",
			startsOn: date,
			endsOn: date,
			includePreExamDay: true,
		});
		return (
			await admin.query<{ id: string }>(
				`select id from employee_apprentice_release
				 where organization_id = $1 and employee_id = $2 and release_kind = 'exam_day'
				   and starts_on = $3 and voided_at is null`,
				[org.id, who.employeeId, date],
			)
		).rows;
	}

	/** The active exam on `date`. */
	async function recordedExam(who: FixtureEmployee, date: string) {
		const [exam] = (
			await admin.query<{ id: string }>(
				`select id from employee_apprentice_release
				 where organization_id = $1 and employee_id = $2 and release_kind = 'exam_day'
				   and starts_on = $3 and voided_at is null`,
				[org.id, who.employeeId, date],
			)
		).rows;
		return exam;
	}

	it("credits a pre-exam day once: a school day entered on it is refused, the week stays lawful", async () => {
		const minor = await apprentice("onceaday", "2011-01-01");
		const scope = {
			organizationId: org.id,
			employeeId: minor.employeeId,
			actorUserId: owner.userId,
		};
		// Exam on Thursday 4 March 2027 with its pre-exam day on Wednesday.
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "exam_day",
			startsOn: "2027-03-04",
			endsOn: "2027-03-04",
			includePreExamDay: true,
		});
		// Wednesday's long school day is entered afterwards.
		await expect(
			recordApprenticeReleaseWithCredit(db, {
				...scope,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-03",
				endsOn: "2027-03-03",
				lessonCount: 6,
			}),
		).rejects.toMatchObject({ refusal: "apprentice_release_day_already_released" });

		const credits = await loadYouthSchoolCredits(db, {
			organizationId: org.id,
			employeeIds: [minor.employeeId],
			from: "2027-03-01",
			until: "2027-03-08",
		});
		expect(
			(credits.get(minor.employeeId) ?? [])
				.filter((credit) => credit.date === "2027-03-03")
				.map((credit) => credit.minutes),
		).toEqual([480]);

		// Monday, Tuesday and Friday 8 h each: 40 h with Wednesday and Thursday.
		const subareaId = await seed.subarea(org, owner);
		for (const date of ["2027-03-01", "2027-03-02", "2027-03-05"]) {
			await seed.shift(org, minor, {
				subareaId,
				creatorUserId: owner.userId,
				date,
				startTime: "08:00",
				endTime: "17:00",
			});
		}
		const findings = await jarbschgScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2027-03-01", endExclusive: "2027-03-08" },
			employeeIds: [minor.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: localInstant("2027-02-20", "12:00", org.timezone),
		});
		expect(findings.map((finding) => finding.kind)).not.toContain("jarbschg_weekly_max");
	});

	it("checks a pre-exam day recorded on its own like one recorded with its exam", async () => {
		const learner = await apprentice("standalone", "2005-05-05");
		const scope = {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
		};
		const preExamDay = (date: string) =>
			recordApprenticeReleaseWithCredit(db, {
				...scope,
				releaseKind: "pre_exam_day",
				startsOn: date,
				endsOn: date,
			});
		// An exam is never voided for a pre-exam day.
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "exam_day",
			startsOn: "2027-03-02",
			endsOn: "2027-03-02",
		});
		await expect(preExamDay("2027-03-02")).rejects.toMatchObject({
			refusal: "apprentice_release_day_already_released",
		});
		// A partly credited school day is replaced, with its reason.
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-04",
			endsOn: "2027-03-04",
			lessonCount: 4,
		});
		await preExamDay("2027-03-04");
		expect(await activeReleases(learner)).toEqual([
			{ release_kind: "exam_day", starts_on: "2027-03-02", school_minutes: null },
			{ release_kind: "pre_exam_day", starts_on: "2027-03-04", school_minutes: null },
		]);
	});

	it("keeps the pre-exam day released in full when a later school day takes the week's full credit", async () => {
		const learner = await apprentice("fullbefore", "2005-05-05");
		const scope = {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
		};
		// Thursday 4 March 2027: six lessons, for now the week's full school day.
		await recordApprenticeRelease(db, {
			...scope,
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-04",
			endsOn: "2027-03-04",
			lessonCount: 6,
		});
		// The written final exam on Friday releases Thursday in full.
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "exam_day",
			startsOn: "2027-03-05",
			endsOn: "2027-03-05",
			includePreExamDay: true,
		});
		// Monday's six-lesson school day, recorded later, is now the week's first long school day.
		await recordApprenticeReleaseWithCredit(db, {
			...scope,
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-01",
			endsOn: "2027-03-01",
			lessonCount: 6,
		});

		const required = await requirementsOf(learner);
		expect(required["2027-03-01"]?.requiredMinutes).toBe(0);
		expect(required["2027-03-04"]?.requiredMinutes).toBe(0);

		const subareaId = await seed.subarea(org, owner);
		const [suggestion] = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.id,
					timezone: org.timezone,
					candidates: [{ employeeId: learner.employeeId, displayName: "Learner", isActive: true }],
					shift: { subareaId, date: "2027-03-04", startTime: "13:00", endTime: "17:00" },
				});
			}).pipe(Effect.provide(staffingLayer)),
		);
		expect(
			(suggestion?.warnings ?? []).flatMap((warning) =>
				warning.type === "compliance" && warning.finding.type === "statutory"
					? [warning.finding.statutoryKind]
					: [],
			),
		).toContain("bbig_release_day_shift");
	});

	it("cites the release a shift conflicts with: § 9 for school, § 10 for exams, BBiG for adults", async () => {
		const adult = await apprentice("adultcite", "2005-05-05");
		const minor = await apprentice("minorcite", "2011-01-01");
		const subareaId = await seed.subarea(org, owner);
		const days = {
			"2027-03-02": "school day",
			"2027-03-09": "block week",
			"2027-03-16": "pre-exam day",
			"2027-03-17": "exam day",
		} as const;
		const releaseOfShift = new Map<string, string>();
		for (const who of [adult, minor]) {
			await recordReleases(who);
			for (const [date, release] of Object.entries(days)) {
				const id = await seed.shift(org, who, {
					subareaId,
					creatorUserId: owner.userId,
					date,
					startTime: "13:00",
					endTime: "15:00",
				});
				releaseOfShift.set(`shift:${id}`, `${who === minor ? "minor" : "adult"} ${release}`);
			}
		}

		const findings = await apprenticeReleaseScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2027-03-01", endExclusive: "2027-03-22" },
			employeeIds: [adult.employeeId, minor.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: localInstant("2027-02-20", "12:00", org.timezone),
		});
		expect(
			Object.fromEntries(
				findings.map((finding) => [releaseOfShift.get(finding.subjectKey), finding.legalReference]),
			),
		).toEqual({
			"adult school day": "§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
			"adult block week": "§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
			"adult pre-exam day": "§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
			"adult exam day": "§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
			"minor school day": "§ 9 Abs. 1 Nr. 2 JArbSchG",
			"minor block week": "§ 9 Abs. 1 Nr. 3 JArbSchG",
			"minor pre-exam day": "§ 10 Abs. 1 Nr. 2 JArbSchG",
			"minor exam day": "§ 10 Abs. 1 Nr. 1 JArbSchG",
		});
	});

	it("flags shifts during a short school day's lessons, and before lessons starting before 9", async () => {
		const adult = await apprentice("adultlessons", "2005-05-05");
		const minor = await apprentice("minorlessons", "2011-01-01");
		const subareaId = await seed.subarea(org, owner);
		// Monday 1 to Friday 5 March 2027: four lessons each day, only partly credited.
		const days = [
			{ date: "2027-03-01", school: ["08:00", "11:30"], shift: ["07:00", "12:00"], case: "during" },
			{ date: "2027-03-02", school: ["08:00", "11:30"], shift: ["06:00", "07:30"], case: "before" },
			{ date: "2027-03-03", school: ["08:00", "11:30"], shift: ["12:30", "16:00"], case: "after" },
			{ date: "2027-03-04", school: ["09:30", "12:45"], shift: ["07:00", "09:00"], case: "late" },
			{ date: "2027-03-05", school: null, shift: ["07:00", "12:00"], case: "untimed" },
		] as const;
		const caseOfShift = new Map<string, string>();
		for (const who of [adult, minor]) {
			for (const day of days) {
				await recordApprenticeReleaseWithCredit(db, {
					organizationId: org.id,
					employeeId: who.employeeId,
					actorUserId: owner.userId,
					releaseKind: "vocational_school_day",
					startsOn: day.date,
					endsOn: day.date,
					lessonCount: 4,
					schoolStartTime: day.school?.[0] ?? null,
					schoolEndTime: day.school?.[1] ?? null,
				});
				const id = await seed.shift(org, who, {
					subareaId,
					creatorUserId: owner.userId,
					date: day.date,
					startTime: day.shift[0],
					endTime: day.shift[1],
				});
				caseOfShift.set(`shift:${id}`, `${who === minor ? "minor" : "adult"} ${day.case}`);
			}
		}

		const findings = await apprenticeReleaseScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2027-03-01", endExclusive: "2027-03-08" },
			employeeIds: [adult.employeeId, minor.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: { ...DEFAULT_STATUTORY_PREFERENCES, blockJarbschgShiftPublish: true },
			now: localInstant("2027-02-20", "12:00", org.timezone),
		});
		expect(
			Object.fromEntries(
				findings.map((finding) => [
					caseOfShift.get(finding.subjectKey),
					[finding.kind, finding.severity, finding.legalReference, finding.blocksPublication],
				]),
			),
		).toEqual({
			"adult during": ["bbig_release_day_shift", "warning", "§ 15 Abs. 1 Satz 2 Nr. 1 BBiG", false],
			"adult before": ["bbig_release_day_shift", "warning", "§ 15 Abs. 1 Satz 1 BBiG", false],
			"minor during": ["bbig_release_day_shift", "critical", "§ 9 Abs. 1 Satz 1 JArbSchG", true],
			"minor before": ["bbig_release_day_shift", "critical", "§ 9 Abs. 1 Nr. 1 JArbSchG", true],
		});
	});

	it("flags night shifts running into a day released in full, whichever day they start on", async () => {
		const adult = await apprentice("adultnight", "2005-05-05");
		const minor = await apprentice("minornight", "2011-01-01");
		const subareaId = await seed.subarea(org, owner);
		// Each night shift starts on a day without a release and ends at 06:00 on the release day.
		const cases = [
			// Tue 2 Mar 2027: six lessons from 07:45, the week's full school day.
			{ case: "full school day", shiftOn: "2027-03-01", school: ["07:45", "13:00"] },
			// Tue 9 Mar: six lessons, no times recorded.
			{ case: "untimed school day", shiftOn: "2027-03-08", school: null },
			// Mon 15 to Fri 19 Mar: a full block week.
			{ case: "block day", shiftOn: "2027-03-14" },
			// Wed 24 Mar: a pre-exam day.
			{ case: "pre-exam day", shiftOn: "2027-03-23" },
			// Wed 31 Mar: an exam recorded without its time.
			{ case: "exam day", shiftOn: "2027-03-30" },
		] as const;
		const caseOfShift = new Map<string, string>();
		for (const who of [adult, minor]) {
			const scope = {
				organizationId: org.id,
				employeeId: who.employeeId,
				actorUserId: owner.userId,
			};
			for (const day of ["2027-03-02", "2027-03-09"]) {
				const timed = day === "2027-03-02";
				await recordApprenticeReleaseWithCredit(db, {
					...scope,
					releaseKind: "vocational_school_day",
					startsOn: day,
					endsOn: day,
					lessonCount: 6,
					schoolStartTime: timed ? "07:45" : null,
					schoolEndTime: timed ? "13:00" : null,
				});
			}
			await recordApprenticeReleaseWithCredit(db, {
				...scope,
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-15",
				endsOn: "2027-03-19",
				schoolMinutes: 1500,
			});
			await recordApprenticeReleaseWithCredit(db, {
				...scope,
				releaseKind: "pre_exam_day",
				startsOn: "2027-03-24",
				endsOn: "2027-03-24",
			});
			await recordApprenticeReleaseWithCredit(db, {
				...scope,
				releaseKind: "exam_day",
				startsOn: "2027-03-31",
				endsOn: "2027-03-31",
			});
			for (const night of cases) {
				const id = await seed.shift(org, who, {
					subareaId,
					creatorUserId: owner.userId,
					date: night.shiftOn,
					startTime: "22:00",
					endTime: "06:00",
				});
				caseOfShift.set(`shift:${id}`, `${who === minor ? "minor" : "adult"} ${night.case}`);
			}
		}

		const findings = await apprenticeReleaseScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2027-03-01", endExclusive: "2027-04-05" },
			employeeIds: [adult.employeeId, minor.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: { ...DEFAULT_STATUTORY_PREFERENCES, blockJarbschgShiftPublish: true },
			now: localInstant("2027-02-20", "12:00", org.timezone),
		});
		expect(
			Object.fromEntries(
				findings.map((finding) => [
					caseOfShift.get(finding.subjectKey),
					[finding.kind, finding.severity, finding.legalReference, finding.blocksPublication],
				]),
			),
		).toEqual({
			"adult full school day": [
				"bbig_release_day_shift",
				"warning",
				"§ 15 Abs. 1 Satz 1 BBiG",
				false,
			],
			"adult untimed school day": [
				"bbig_release_day_shift",
				"warning",
				"§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
				false,
			],
			"adult block day": [
				"bbig_release_day_shift",
				"warning",
				"§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
				false,
			],
			"adult pre-exam day": [
				"bbig_release_day_shift",
				"warning",
				"§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
				false,
			],
			"adult exam day": [
				"bbig_release_day_shift",
				"warning",
				"§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
				false,
			],
			"minor full school day": [
				"bbig_release_day_shift",
				"critical",
				"§ 9 Abs. 1 Nr. 1 JArbSchG",
				true,
			],
			"minor untimed school day": [
				"jarbschg_school_day_workplace_return",
				"critical",
				"§ 9 Abs. 1 Nr. 2 JArbSchG",
				true,
			],
			"minor block day": ["bbig_release_day_shift", "critical", "§ 9 Abs. 1 Nr. 3 JArbSchG", true],
			"minor pre-exam day": [
				"bbig_release_day_shift",
				"critical",
				"§ 10 Abs. 1 Nr. 2 JArbSchG",
				true,
			],
			"minor exam day": ["bbig_release_day_shift", "critical", "§ 10 Abs. 1 Nr. 1 JArbSchG", true],
		});
	});

	it("does not credit releases of an employee who is not an apprentice", async () => {
		const regular = await apprentice("regular", "2005-05-05", "regular");
		await recordReleases(regular);
		const required = await requirementsOf(regular);
		expect(required["2027-03-02"]?.requiredMinutes).toBe(required["2027-03-01"]?.requiredMinutes);
	});

	it("never counts credited release days as vacation days", async () => {
		const learner = await apprentice("vacation", "2005-05-05");
		const regular = await apprentice("colleague", "2005-05-05", "regular");
		await recordReleases(learner);
		await recordReleases(regular);
		const week = {
			startDate: "2027-03-01",
			startPeriod: "full_day" as const,
			endDate: "2027-03-05",
			endPeriod: "full_day" as const,
		};
		const days = (who: FixtureEmployee) =>
			getAbsenceDays(db, { organizationId: org.id, employeeId: who.employeeId, absence: week });
		// Tuesday is the week's full school day and Thursday a partly credited one: the apprentice's
		// vacation week costs two days less.
		expect(await days(learner)).toBe((await days(regular)) - 2);

		const blockWeek = { ...week, startDate: "2027-03-08", endDate: "2027-03-12" };
		expect(
			await getAbsenceDays(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				absence: blockWeek,
			}),
		).toBe(0);
	});

	describe("partly credited release days never cost a vacation day", () => {
		const vacation = (who: FixtureEmployee, startDate: string, endDate: string) =>
			getAbsenceDays(db, {
				organizationId: org.id,
				employeeId: who.employeeId,
				absence: { startDate, startPeriod: "full_day", endDate, endPeriod: "full_day" },
			});
		const scopeOf = (who: FixtureEmployee) => ({
			organizationId: org.id,
			employeeId: who.employeeId,
			actorUserId: owner.userId,
		});

		it.each([
			// § 19 Abs. 3 Satz 2 JArbSchG: a school day attended during a minor's vacation is given back.
			{ name: "a minor", birthday: "2011-01-01" },
			{ name: "an adult", birthday: "2005-05-05" },
		])("a short school day of $name, until the release is voided", async ({ birthday }) => {
			const learner = await apprentice("short", birthday);
			// Wednesday 3 March 2027: four lessons, only partly credited.
			const release = await recordApprenticeRelease(db, {
				...scopeOf(learner),
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-03",
				endsOn: "2027-03-03",
				lessonCount: 4,
			});
			expect(await vacation(learner, "2027-03-01", "2027-03-05")).toBe(4);

			await voidApprenticeReleaseWithCredit(db, {
				...scopeOf(learner),
				releaseId: release.id,
				reason: "Recorded in error",
			});
			expect(await vacation(learner, "2027-03-01", "2027-03-05")).toBe(5);
		});

		it("the days of a block week under 25 hours", async () => {
			const learner = await apprentice("shortblock", "2005-05-05");
			// Monday to Wednesday 8–10 March 2027, 15 h: no full block week.
			await recordApprenticeRelease(db, {
				...scopeOf(learner),
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-08",
				endsOn: "2027-03-10",
				schoolMinutes: 900,
			});
			expect(await vacation(learner, "2027-03-08", "2027-03-12")).toBe(2);
		});

		it("an exam recorded with its time", async () => {
			const learner = await apprentice("timedexam", "2005-05-05");
			await recordApprenticeReleaseWithCredit(db, {
				...scopeOf(learner),
				releaseKind: "exam_day",
				startsOn: "2027-03-17",
				endsOn: "2027-03-17",
				examStartTime: "09:00",
				examEndTime: "12:00",
			});
			expect(await vacation(learner, "2027-03-15", "2027-03-19")).toBe(4);
		});
	});

	it("warns planners in Staffing about shifts on school and exam release days", async () => {
		const adult = await apprentice("adultapp", "2005-05-05");
		const minor = await apprentice("minorapp", "2011-01-01");
		const colleague = await apprentice("colleague", "2005-05-05", "regular");
		for (const who of [adult, minor, colleague]) await recordReleases(who);
		const subareaId = await seed.subarea(org, owner);
		const candidates: StaffingCandidate[] = [
			{ employeeId: adult.employeeId, displayName: "Adult", isActive: true },
			{ employeeId: minor.employeeId, displayName: "Minor", isActive: true },
			{ employeeId: colleague.employeeId, displayName: "Colleague", isActive: true },
		];
		const suggest = (date: string, startTime = "09:00", endTime = "13:00") =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* StaffingSuggestionService;
					return yield* service.suggestForShift({
						organizationId: org.id,
						timezone: org.timezone,
						candidates,
						shift: { subareaId, date, startTime, endTime },
					});
				}).pipe(Effect.provide(staffingLayer)),
			);
		const statutoryWarnings = (suggestions: Awaited<ReturnType<typeof suggest>>, name: string) =>
			(suggestions.find((suggestion) => suggestion.displayName === name)?.warnings ?? []).flatMap(
				(warning) =>
					warning.type === "compliance" && warning.finding.type === "statutory"
						? [[warning.finding.statutoryKind, warning.finding.severity]]
						: [],
			);

		const examDay = await suggest("2027-03-17");
		expect(statutoryWarnings(examDay, "Adult")).toEqual([["bbig_release_day_shift", "warning"]]);
		// The exam day counts 8 h of working time for an under-18 (§ 10 Abs. 2 JArbSchG).
		expect(statutoryWarnings(examDay, "Minor")).toEqual([
			["jarbschg_daily_max", "critical"],
			["bbig_release_day_shift", "critical"],
		]);
		expect(statutoryWarnings(examDay, "Colleague")).toEqual([]);

		// Tuesday is the week's full school day (> 5 lessons): an under-18 may not return to work
		// afterwards (§ 9 Abs. 1 Nr. 2 JArbSchG).
		const fullSchoolDay = await suggest("2027-03-02");
		expect(statutoryWarnings(fullSchoolDay, "Adult")).toEqual([
			["bbig_release_day_shift", "warning"],
		]);
		expect(statutoryWarnings(fullSchoolDay, "Minor")).toEqual([
			["jarbschg_daily_max", "critical"],
			["jarbschg_school_day_workplace_return", "critical"],
		]);

		// An exam from 08:00 to 11:00 releases and credits its time only (§ 10 Abs. 1 Nr. 1 JArbSchG).
		await recordApprenticeReleaseWithCredit(db, {
			organizationId: org.id,
			employeeId: minor.employeeId,
			actorUserId: owner.userId,
			releaseKind: "exam_day",
			startsOn: "2027-03-24",
			endsOn: "2027-03-24",
			examStartTime: "08:00",
			examEndTime: "11:00",
		});
		const afternoon = await suggest("2027-03-24", "13:00", "17:00");
		expect(statutoryWarnings(afternoon, "Minor")).toEqual([]);
		const overlapping = await suggest("2027-03-24", "10:00", "12:00");
		expect(statutoryWarnings(overlapping, "Minor")).toEqual([
			["bbig_release_day_shift", "critical"],
		]);

		// Thursday's school day is only partly credited: returning to work afterwards is lawful.
		const partialSchoolDay = await suggest("2027-03-04");
		expect(statutoryWarnings(partialSchoolDay, "Adult")).toEqual([]);
		expect(statutoryWarnings(partialSchoolDay, "Minor")).toEqual([]);
	});
});
