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
import { youthSeed } from "../youth/testing/youth-seed";

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
		const suggest = (date: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* StaffingSuggestionService;
					return yield* service.suggestForShift({
						organizationId: org.id,
						timezone: org.timezone,
						candidates,
						shift: { subareaId, date, startTime: "09:00", endTime: "13:00" },
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

		// Thursday's school day is only partly credited: returning to work afterwards is lawful.
		const partialSchoolDay = await suggest("2027-03-04");
		expect(statutoryWarnings(partialSchoolDay, "Adult")).toEqual([]);
		expect(statutoryWarnings(partialSchoolDay, "Minor")).toEqual([]);
	});
});
