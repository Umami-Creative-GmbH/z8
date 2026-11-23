/**
 * #1993: apprentice release actions (real PostgreSQL). Org admins record and void release days
 * for apprentices only, an exam day can release the working day before it, the employee's
 * managers read the credits of employees they manage, and the employee reads their own.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import { youthSeed } from "@/lib/statutory/youth/testing/youth-seed";

const harness = vi.hoisted(() => ({ caller: null as StubCaller | null }));

vi.mock("@/lib/effect/runtime", async () => {
	const { db } = await import("@/db");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, { db }),
	);
});

const {
	getApprenticeReleaseCreditsAction,
	getOwnApprenticeReleaseCreditsAction,
	recordApprenticeReleaseAction,
	voidApprenticeReleaseAction,
} = await import("./apprentice-release-actions");

describe("apprentice release actions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993ac");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let learner: FixtureEmployee;

	const as = (
		who: FixtureEmployee,
		membershipRole: string,
		role: "employee" | "manager" | "admin",
	) => {
		harness.caller = {
			userId: who.userId,
			activeOrganizationId: org.id,
			membershipRole,
			employee: { id: who.employeeId, role, former: false },
		};
	};

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		learner = await fx.employee(org, "learner", { birthday: "2010-05-05" });
		await fx.membership(org, learner, "member");
		await seed.terms(learner, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		as(owner, "owner", "admin");
	});
	afterAll(fx.cleanup);

	it("records school and exam days with their credits, and releases the day before the exam", async () => {
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-02",
				endsOn: "2027-03-02",
				lessonCount: 4,
			}),
		).toMatchObject({ success: true });
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-09",
				endsOn: "2027-03-09",
				lessonCount: 6,
			}),
		).toMatchObject({ success: true });
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "exam_day",
				startsOn: "2027-05-12",
				endsOn: "2027-05-12",
				includePreExamDay: true,
			}),
		).toMatchObject({ success: true });

		const result = await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId });
		if (!result.success) throw new Error(result.error);
		expect(result.data.isApprentice).toBe(true);
		expect(result.data.releases).toEqual([
			expect.objectContaining({ releaseKind: "exam_day", startsOn: "2027-05-12", fullDays: 1 }),
			expect.objectContaining({ releaseKind: "pre_exam_day", startsOn: "2027-05-11", fullDays: 1 }),
			expect.objectContaining({
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-09",
				fullDays: 1,
				// The week's full school day: an under-18 may not return to work afterwards.
				flagsWorkplaceReturn: true,
			}),
			expect.objectContaining({
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-02",
				fullDays: 0,
				creditedMinutes: 180,
				// A partly credited school day: returning to work afterwards is lawful.
				flagsWorkplaceReturn: false,
			}),
		]);
	});

	it("moves the pre-exam release day off a public holiday to the working day before it", async () => {
		// The exam is on Tuesday 30 March 2027; Monday 29 March is a public holiday here.
		const holidayId = await seed.publicHoliday(org, owner, "2027-03-29");
		expect(holidayId).toBeTruthy();
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "exam_day",
				startsOn: "2027-03-30",
				endsOn: "2027-03-30",
				includePreExamDay: true,
			}),
		).toMatchObject({ success: true });
		const result = await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId });
		if (!result.success) throw new Error(result.error);
		expect(result.data.releases).toContainEqual(
			expect.objectContaining({ releaseKind: "pre_exam_day", startsOn: "2027-03-26" }),
		);
	});

	it("credits a short school day with its school time including breaks", async () => {
		// Four lessons from 08:00 to 11:30: 210 minutes of school time, not 4 × 45 = 180.
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-02",
				endsOn: "2027-03-02",
				lessonCount: 4,
				schoolStartTime: "08:00",
				schoolEndTime: "11:30",
			}),
		).toMatchObject({ success: true });
		// Without its times a school day still counts its lessons.
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-03",
				endsOn: "2027-03-03",
				lessonCount: 4,
			}),
		).toMatchObject({ success: true });
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-04",
				endsOn: "2027-03-04",
				lessonCount: 4,
				schoolStartTime: "11:30",
				schoolEndTime: "08:00",
			}),
		).toMatchObject({ success: false, refusal: "apprentice_release_school_time_invalid" });

		const result = await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId });
		if (!result.success) throw new Error(result.error);
		expect(
			result.data.releases.map((release) => [release.startsOn, release.creditedMinutes]),
		).toEqual([
			["2027-03-03", 180],
			["2027-03-02", 210],
		]);
	});

	it("records the exam when the working day before it is already released", async () => {
		// Friday 7 May 2027 ends a full block-release week, which releases it in full and is never
		// split; the exam is on Monday.
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-05-03",
				endsOn: "2027-05-07",
				schoolMinutes: 1500,
			}),
		).toMatchObject({ success: true });
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "exam_day",
				startsOn: "2027-05-10",
				endsOn: "2027-05-10",
				includePreExamDay: true,
			}),
		).toMatchObject({ success: true });

		const result = await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId });
		if (!result.success) throw new Error(result.error);
		expect(result.data.releases.map((release) => [release.releaseKind, release.startsOn])).toEqual([
			["exam_day", "2027-05-10"],
			["vocational_school_block_week", "2027-05-03"],
		]);
	});

	it("refuses release days for employees who are not apprentices, and a school day without lessons", async () => {
		const regular = await fx.employee(org, "regular", { birthday: "2000-01-01" });
		expect(
			await recordApprenticeReleaseAction({
				employeeId: regular.employeeId,
				releaseKind: "exam_day",
				startsOn: "2027-05-12",
				endsOn: "2027-05-12",
			}),
		).toMatchObject({ success: false, refusal: "apprentice_release_not_apprentice" });
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_day",
				startsOn: "2027-03-02",
				endsOn: "2027-03-02",
			}),
		).toMatchObject({ success: false, refusal: "apprentice_release_lessons_required" });
	});

	it("refreshes the stored work balance when a release is recorded or voided, also months back", async () => {
		const { getEmployeeWorkBalance, refreshEmployeeWorkBalanceFromPeriods } =
			await import("@/lib/work-balance/service");
		await admin.query("update employee set start_date = $2 where id = $1", [
			learner.employeeId,
			new Date("2026-01-01T00:00:00Z"),
		]);
		const scope = { organizationId: org.id, employeeId: learner.employeeId };
		await refreshEmployeeWorkBalanceFromPeriods({ ...scope, forceFullRebuild: true });
		const before = await getEmployeeWorkBalance(scope);
		expect(before).not.toBeNull();

		// A Tuesday about three months back: outside the work balance's recomputed hot window.
		const back = Temporal.Now.plainDateISO(org.timezone).subtract({ days: 91 });
		const tuesday = back.subtract({ days: (back.dayOfWeek + 5) % 7 }).toString();
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "vocational_school_day",
				startsOn: tuesday,
				endsOn: tuesday,
				lessonCount: 6,
			}),
		).toMatchObject({ success: true });
		const credited = await getEmployeeWorkBalance(scope);
		// The full school day releases the day's 8 h requirement.
		expect(credited?.requiredMinutes).toBe((before?.requiredMinutes ?? 0) - 480);

		const listed = await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId });
		const releaseId = listed.success ? listed.data.releases[0]?.id : undefined;
		expect(
			await voidApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseId: releaseId ?? "",
				reason: "Recorded by mistake",
			}),
		).toMatchObject({ success: true });
		expect((await getEmployeeWorkBalance(scope))?.requiredMinutes).toBe(before?.requiredMinutes);
	});

	it("lets only org admins record and void, managers read whom they manage, employees read their own", async () => {
		await recordApprenticeReleaseAction({
			employeeId: learner.employeeId,
			releaseKind: "exam_day",
			startsOn: "2027-05-12",
			endsOn: "2027-05-12",
		});
		const manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		const stranger = await fx.employee(org, "stranger", { role: "manager" });
		await fx.membership(org, stranger, "member");
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[learner.employeeId, manager.employeeId, owner.userId],
		);

		as(manager, "member", "manager");
		const managed = await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId });
		expect(managed).toMatchObject({
			success: true,
			data: { releases: [{ releaseKind: "exam_day" }] },
		});
		expect(
			await recordApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseKind: "exam_day",
				startsOn: "2027-06-01",
				endsOn: "2027-06-01",
			}),
		).toMatchObject({ success: false });

		as(stranger, "member", "manager");
		expect(
			await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId }),
		).toMatchObject({ success: false, code: "AuthorizationError" });

		as(learner, "member", "employee");
		const own = await getOwnApprenticeReleaseCreditsAction();
		expect(own).toMatchObject({ success: true, data: { isApprentice: true } });
		const releaseId = own.success ? own.data.releases[0]?.id : undefined;
		expect(releaseId).toBeDefined();
		expect(
			await voidApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseId: releaseId ?? "",
				reason: "mine",
			}),
		).toMatchObject({ success: false });

		as(owner, "owner", "admin");
		expect(
			await voidApprenticeReleaseAction({
				employeeId: learner.employeeId,
				releaseId: releaseId ?? "",
				reason: "Exam moved",
			}),
		).toMatchObject({ success: true });
		const after = await getApprenticeReleaseCreditsAction({ employeeId: learner.employeeId });
		expect(after).toMatchObject({ success: true, data: { releases: [] } });
	});
});
