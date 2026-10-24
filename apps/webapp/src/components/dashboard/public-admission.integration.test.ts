import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const actor = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	signedIn: true,
	mfaRequired: false,
	ssoRequired: false,
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				actor.signedIn
					? {
							user: { id: actor.userId, role: "user" },
							session: {
								id: `t1475-${actor.userId}`,
								userId: actor.userId,
								activeOrganizationId: actor.organizationId,
							},
							mfaRequired: actor.mfaRequired,
							ssoRequired: actor.ssoRequired,
						}
					: null,
		},
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const dashboard = await import("./actions");
const wellness = await import("@/app/[locale]/(app)/wellness/actions");
const { getPresenceStatus } = await import(
	"@/app/[locale]/(app)/time-tracking/actions"
);
let fixture: LifecycleDatabaseFixture;
beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
});
afterAll(async () => fixture?.close());

it("refuses the retained public team-overview action after membership approval is withdrawn", async () => {
	const subject = await fixture.seedEmployee();
	actor.userId = subject.userId;
	actor.organizationId = fixture.organizationId;
	await fixture.pool.query("update member set status='pending' where id=$1", [
		subject.memberId,
	]);
	expect(await dashboard.getTeamOverviewStats()).toMatchObject({
		success: false,
	});
});

it("refuses the retained hydration widget mutation after membership approval is withdrawn", async () => {
	const subject = await fixture.seedEmployee();
	actor.userId = subject.userId;
	actor.organizationId = fixture.organizationId;
	await fixture.pool.query("update member set status='pending' where id=$1", [
		subject.memberId,
	]);
	expect(
		await wellness.logWaterIntake({ amount: 1, source: "widget" }),
	).toMatchObject({ success: false });
});

it("refuses the retained public presence action after membership approval is withdrawn", async () => {
	const subject = await fixture.seedEmployee();
	actor.userId = subject.userId;
	actor.organizationId = fixture.organizationId;
	await fixture.pool.query("update member set status='pending' where id=$1", [
		subject.memberId,
	]);
	expect(await getPresenceStatus(subject.employeeId)).toMatchObject({
		success: false,
	});
});

it.each([
	"pending",
	"revoked",
	"inactive",
	"due-departure",
	"other-org",
	"signed-out",
	"mfa",
	"sso",
	"mfa-policy",
	"sso-policy",
] as const)(
	"denies retained Dashboard actions and mutations for %s admission",
	async (denial) => {
		const organizationId = denial.endsWith("-policy")
			? await fixture.createOrganization()
			: fixture.organizationId;
		const subject = await fixture.seedEmployee({ organizationId });
		actor.userId = subject.userId;
		actor.organizationId = organizationId;
		actor.signedIn = denial !== "signed-out";
		actor.mfaRequired = denial === "mfa";
		actor.ssoRequired = denial === "sso";
		if (denial === "mfa-policy")
			await fixture.pool.query(
				"insert into session (id,user_id,token,expires_at,created_at,updated_at) values ($1,$2,$1,'2099-01-01',now(),now())",
				[`t1475-${subject.userId}`, subject.userId],
			);
		if (denial === "mfa-policy")
			await fixture.pool.query(
				"insert into organization_mfa_policy (organization_id,enabled,grace_period_days,updated_by) values ($1,true,0,$2)",
				[organizationId, fixture.ownerUserId],
			);
		if (denial === "sso-policy")
			await fixture.pool.query(
				`insert into enterprise_identity_setup (organization_id,activated,enforcement) values ($1,true,'{"ssoRequired":true,"domainRestrictionEnabled":false,"inviteRestrictionEnabled":false}'::jsonb)`,
				[organizationId],
			);
		if (denial === "pending")
			await fixture.pool.query(
				"update member set status='pending' where id=$1",
				[subject.memberId],
			);
		if (denial === "revoked")
			await fixture.pool.query("delete from member where id=$1", [
				subject.memberId,
			]);
		if (denial === "inactive")
			await fixture.pool.query(
				"update employee set is_active=false where id=$1",
				[subject.employeeId],
			);
		if (denial === "other-org")
			actor.organizationId = await fixture.createOrganization();
		if (denial === "due-departure")
			await fixture.pool.query(
				`insert into employee_departure (organization_id,employee_id,employment_period_id,mode,last_working_day,timezone,cutoff_at,created_by,request_id,request_fingerprint,revision,status) values ($1,$2,$3,'scheduled','2026-09-14','UTC','2026-09-15T00:00:00Z',$4,gen_random_uuid(),'t1475',1,'pending')`,
				[
					fixture.organizationId,
					subject.employeeId,
					subject.employmentPeriodId,
					fixture.ownerUserId,
				],
			);
		const readers = {
			managed: () => dashboard.getManagedEmployees(),
			upcoming: () => dashboard.getUpcomingAbsences(),
			calendar: () => dashboard.getTeamCalendarData(10, 2026),
			approved: () => dashboard.getRecentlyApprovedRequests(),
			quick: () => dashboard.getQuickStats(),
			birthdays: () => dashboard.getUpcomingBirthdays(),
			team: () => dashboard.getTeamOverviewStats(),
			out: () => dashboard.getWhosOutToday(),
			vacation: () => dashboard.getVacationBalance(),
			hydration: () => dashboard.getHydrationWidgetData(),
			settings: () => dashboard.getUserSettings(),
			presence: () => getPresenceStatus(subject.employeeId),
			layoutWrite: () => dashboard.updateWidgetOrder({ order: [], hidden: [] }),
			waterWrite: () =>
				wellness.logWaterIntake({ amount: 1, source: "widget" }),
		};
		for (const [name, read] of Object.entries(readers))
			expect(await read(), name).toMatchObject({ success: false });
		await expect(dashboard.getManagerTodaySummary()).rejects.toThrow();
	},
);

it("preserves the original admitted member-only admin preferences and empty manager state", async () => {
	const subject = await fixture.seedEmployee({ role: "admin" });
	await fixture.pool.query("delete from employee where id=$1", [
		subject.employeeId,
	]);
	actor.userId = subject.userId;
	actor.organizationId = fixture.organizationId;
	actor.signedIn = true;
	actor.mfaRequired = false;
	actor.ssoRequired = false;
	expect(await dashboard.getManagerTodaySummary()).toEqual({
		role: null,
		summary: null,
	});
	expect(await dashboard.getManagedEmployees()).toEqual({
		success: true,
		data: { isManager: false, employees: [] },
	});
	expect(await dashboard.getUserSettings()).toMatchObject({ success: true });
	expect(
		await dashboard.updateWidgetOrder({ order: ["quick-stats"], hidden: [] }),
	).toMatchObject({ success: true });
	expect(await dashboard.getUserSettings()).toMatchObject({
		success: true,
		data: {
			dashboardWidgetOrder: { order: ["quick-stats"], hidden: [], version: 1 },
		},
	});
});
