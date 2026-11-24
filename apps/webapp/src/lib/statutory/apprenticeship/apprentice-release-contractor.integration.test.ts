/**
 * #2010 (spec #1935): BBiG release crediting and release conflicts read employee time only. An
 * External Contractor stint credits no school or exam release and conflicts with none, even for a
 * minor on apprentice terms; on a conversion day the release is credited for its employee part and
 * only shifts after the conversion instant can conflict with it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import { recordApprenticeRelease } from "../employee-context";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import { loadYouthSchoolCredits } from "../youth/school-credits";
import { localInstant, youthSeed } from "../youth/testing/youth-seed";
import { apprenticeReleaseScheduleContributor } from "./release-conflict-contributor";

describe("apprentice releases of External Contractors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2010-ap");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let subareaId: string;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		subareaId = await seed.subarea(org, owner);
	});
	afterAll(fx.cleanup);

	/** Tuesday 2 March 2027. */
	const SCHOOL_DAY = "2027-03-02";
	const at = (date: string, time: string) => localInstant(date, time, org.timezone).toString();

	async function apprentice(key: string, birthday: string) {
		const who = await fx.employee(org, key, { birthday });
		await seed.terms(who, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		return who;
	}

	/** Four lessons 07:45–11:00 on the school day; shifts 08:00–10:00 and 13:00–17:00. */
	async function schoolDayWithShifts(who: FixtureEmployee) {
		await recordApprenticeRelease(db, {
			organizationId: org.id,
			employeeId: who.employeeId,
			actorUserId: owner.userId,
			releaseKind: "vocational_school_day",
			startsOn: SCHOOL_DAY,
			endsOn: SCHOOL_DAY,
			lessonCount: 4,
			schoolMinutes: 195,
			schoolStartTime: "07:45",
			schoolEndTime: "11:00",
		});
		const shift = (startTime: string, endTime: string) =>
			seed.shift(org, who, {
				subareaId,
				creatorUserId: owner.userId,
				date: SCHOOL_DAY,
				startTime,
				endTime,
			});
		return { during: await shift("08:00", "10:00"), after: await shift("13:00", "17:00") };
	}

	const conflicts = (who: FixtureEmployee) =>
		apprenticeReleaseScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2027-03-01", endExclusive: "2027-03-08" },
			employeeIds: [who.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: localInstant("2027-02-20", "12:00", org.timezone),
		});

	const credits = async (who: FixtureEmployee) =>
		(
			await loadYouthSchoolCredits(db, {
				organizationId: org.id,
				employeeIds: [who.employeeId],
				from: "2027-03-01",
				until: "2027-03-08",
			})
		).get(who.employeeId) ?? [];

	it("credits no release and finds no conflict for a minor contractor on apprentice terms", async () => {
		const contractor = await fx.employee(org, "contractor", { birthday: "2011-01-01" });
		await fx.stint(contractor, "contractor", at("2026-01-01", "00:00"));
		await seed.terms(contractor, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		await schoolDayWithShifts(contractor);

		expect(await conflicts(contractor)).toEqual([]);
		expect(await credits(contractor)).toEqual([]);
	});

	it("credits the release and finds the conflict for an apprentice employee", async () => {
		const employee = await apprentice("employee", "2005-05-05");
		const { during } = await schoolDayWithShifts(employee);

		expect(await conflicts(employee)).toEqual([
			expect.objectContaining({ kind: "bbig_release_day_shift", subjectKey: `shift:${during}` }),
		]);
		expect(await credits(employee)).not.toEqual([]);
	});

	it("judges only shifts after the conversion instant on a conversion day", async () => {
		const converted = await fx.employee(org, "converted", { birthday: "2005-05-05" });
		const contractorStint = await fx.stint(converted, "contractor", at("2026-01-01", "00:00"));
		await fx.endStint(contractorStint, at(SCHOOL_DAY, "12:00"));
		await fx.stint(converted, "employee", at(SCHOOL_DAY, "12:00"));
		await seed.terms(converted, {
			from: SCHOOL_DAY,
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		await schoolDayWithShifts(converted);

		// The 08:00–10:00 shift during lessons is contractor time.
		expect(await conflicts(converted)).toEqual([]);
		// The release is credited: the conversion day is an employee day for its employee part.
		expect(await credits(converted)).not.toEqual([]);
	});
});
