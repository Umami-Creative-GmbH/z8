/**
 * #1993: BBiG § 15 / JArbSchG § 9 apprentice release (real PostgreSQL). Credited school, block
 * and exam days release required working time in Work Balance (single and range readers agree),
 * are no working days for Absences (a vacation over them never deducts them), and Staffing warns
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
import { recordApprenticeReleaseWithCredit } from "./release-credit-view";
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
			"adult school day": "§ 15 Abs. 2 BBiG",
			"adult block week": "§ 15 Abs. 2 BBiG",
			"adult pre-exam day": "§ 15 Abs. 2 BBiG",
			"adult exam day": "§ 15 Abs. 2 BBiG",
			"minor school day": "§ 9 Abs. 1 Nr. 2 JArbSchG",
			"minor block week": "§ 9 Abs. 1 Nr. 3 JArbSchG",
			"minor pre-exam day": "§ 10 Abs. 1 Nr. 2 JArbSchG",
			"minor exam day": "§ 10 Abs. 1 Nr. 1 JArbSchG",
		});
	});

	it("does not credit releases of an employee who is not an apprentice", async () => {
		const regular = await apprentice("regular", "2005-05-05", "regular");
		await recordReleases(regular);
		const required = await requirementsOf(regular);
		expect(required["2027-03-02"]?.requiredMinutes).toBe(required["2027-03-01"]?.requiredMinutes);
	});

	it("never counts full release days as vacation days", async () => {
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
		// Tuesday is a full school day: the apprentice's vacation week costs one day less.
		expect(await days(learner)).toBe((await days(regular)) - 1);

		const blockWeek = { ...week, startDate: "2027-03-08", endDate: "2027-03-12" };
		expect(
			await getAbsenceDays(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				absence: blockWeek,
			}),
		).toBe(0);
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
