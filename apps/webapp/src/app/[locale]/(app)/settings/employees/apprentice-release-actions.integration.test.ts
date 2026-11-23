/**
 * #1993: apprentice release actions (real PostgreSQL). Org admins record and void release days
 * for apprentices only, an exam day can release the working day before it, the employee's
 * managers read the credits of employees they manage, and the employee reads their own.
 */
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
