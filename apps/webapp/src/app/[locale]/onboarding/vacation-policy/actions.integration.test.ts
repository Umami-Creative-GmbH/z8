import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const request = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	securityRefused: false,
}));

vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				request.userId
					? {
							user: {
								id: request.userId,
								name: "Caller",
								email: "caller@example.test",
								role: "user",
							},
							session: {
								id: `session-${request.userId}`,
								userId: request.userId,
								activeOrganizationId: request.organizationId,
							},
						}
					: null,
		},
	},
	runAuthMutation: async (mutation: () => Promise<unknown>) => mutation(),
}));
vi.mock("@/lib/organization-mfa/organization-access", async (original) => ({
	...(await original<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => !request.securityRefused,
}));

const { checkIsAdmin, createVacationPolicyOnboarding, skipVacationPolicySetup } = await import(
	"./actions"
);
const input = {
	name: "Onboarding standard",
	defaultAnnualDays: 25,
	accrualType: "annual" as const,
	allowCarryover: true,
	maxCarryoverDays: 5,
};

describe("vacation onboarding authority on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	const callers: Record<string, string> = {};

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		callers.owner = fixture.ownerUserId;
		callers.admin = (await fixture.seedEmployee({ role: "admin" })).userId;
		callers.member = (await fixture.seedEmployee()).userId;
		const workforce = await fixture.seedEmployee();
		await fixture.pool.query("update employee set role='admin' where id=$1", [
			workforce.employeeId,
		]);
		callers.workforce = workforce.userId;
		const pending = await fixture.seedEmployee({ role: "admin" });
		await fixture.pool.query("update member set status='pending' where id=$1", [pending.memberId]);
		callers.pending = pending.userId;
		callers.former = (await fixture.seedEmployee({ role: "owner", isActive: false })).userId;
		const due = await fixture.seedEmployee({ role: "admin" });
		const cutoff = Temporal.Now.instant().subtract({ hours: 24 });
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id,employee_id,employment_period_id,mode,last_working_day,timezone,
			 cutoff_at,created_by,request_id,request_fingerprint,revision,status)
			 values ($1,$2,$3,'scheduled',$4,'UTC',$5,$6,gen_random_uuid(),'onboarding-test',1,'pending')`,
			[
				fixture.organizationId,
				due.employeeId,
				due.employmentPeriodId,
				cutoff.toZonedDateTimeISO("UTC").toPlainDate().toString(),
				cutoff.toString(),
				fixture.ownerUserId,
			],
		);
		callers.due = due.userId;
		const foreign = await fixture.createOrganization();
		callers.foreign = (
			await fixture.seedEmployee({ organizationId: foreign, role: "owner" })
		).userId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function signIn(userId: string | null, organizationId: string | null = fixture.organizationId) {
		request.userId = userId;
		request.organizationId = organizationId;
		request.securityRefused = false;
	}

	async function snapshot(userId: string, organizationIds = [fixture.organizationId]) {
		return {
			policies: (
				await fixture.pool.query(
					"select * from vacation_allowance where organization_id=any($1::text[]) order by id",
					[organizationIds],
				)
			).rows,
			settings: (await fixture.pool.query("select * from user_settings where user_id=$1", [userId]))
				.rows,
		};
	}

	it.each(["member", "workforce", "pending", "former", "due", "foreign"])(
		"refuses %s admission, create and Skip without policy/progress writes",
		async (kind) => {
			const userId = callers[kind];
			signIn(userId);
			const before = await snapshot(userId);
			const admission = await checkIsAdmin();
			expect.soft(admission.success && admission.data).toBe(false);
			expect.soft(await createVacationPolicyOnboarding(input)).toMatchObject({ success: false });
			expect.soft(await skipVacationPolicySetup()).toMatchObject({ success: false });
			expect.soft(await snapshot(userId)).toEqual(before);
		},
	);

	it.each(["no-organization", "security-gate"])("refuses %s before writes", async (kind) => {
		signIn(callers.owner, kind === "no-organization" ? null : fixture.organizationId);
		request.securityRefused = kind === "security-gate";
		const before = await snapshot(callers.owner);
		expect(await createVacationPolicyOnboarding(input)).toMatchObject({ success: false });
		expect(await skipVacationPolicySetup()).toMatchObject({ success: false });
		expect(await snapshot(callers.owner)).toEqual(before);
	});

	it("refuses a demoted administrator after successful admission", async () => {
		const actor = await fixture.seedEmployee({ role: "admin" });
		signIn(actor.userId);
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		await fixture.pool.query("update member set role='member' where id=$1", [actor.memberId]);
		const before = await snapshot(actor.userId);
		expect(await createVacationPolicyOnboarding(input)).toMatchObject({ success: false });
		expect(await skipVacationPolicySetup()).toMatchObject({ success: false });
		expect(await snapshot(actor.userId)).toEqual(before);
	});

	it("refuses an A draft after an authorized actor switches to B", async () => {
		const actor = await fixture.seedEmployee({ role: "admin" });
		const otherOrganization = await fixture.createOrganization();
		await fixture.pool.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'admin','approved',now())",
			[randomUUID(), otherOrganization, actor.userId],
		);
		signIn(actor.userId);
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		const expected = { userId: actor.userId, organizationId: fixture.organizationId };
		request.organizationId = otherOrganization;
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		const organizations = [fixture.organizationId, otherOrganization];
		const before = await snapshot(actor.userId, organizations);
		expect
			.soft(await createVacationPolicyOnboarding(input, expected))
			.toMatchObject({ success: false });
		expect.soft(await skipVacationPolicySetup(expected)).toMatchObject({ success: false });
		expect.soft(await snapshot(actor.userId, organizations)).toEqual(before);
	});

	it.each(["owner", "admin"] as const)("preserves %s creation and Skip semantics", async (role) => {
		const organizationId = await fixture.createOrganization();
		const actor = await fixture.seedEmployee({ organizationId, role });
		signIn(actor.userId, organizationId);
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		expect(await createVacationPolicyOnboarding(input)).toMatchObject({ success: true });
		const read = await fixture.pool.query(
			"select name,default_annual_days,accrual_type,allow_carryover,max_carryover_days,carryover_expiry_months,prorate_in_start_and_exit_year from vacation_allowance where organization_id=$1",
			[organizationId],
		);
		expect(read.rows).toEqual([
			{
				name: input.name,
				default_annual_days: "25",
				accrual_type: "annual",
				allow_carryover: true,
				max_carryover_days: "5",
				carryover_expiry_months: 3,
				prorate_in_start_and_exit_year: true,
			},
		]);
		expect(await skipVacationPolicySetup()).toMatchObject({ success: true });
		expect(
			(
				await fixture.pool.query("select onboarding_step from user_settings where user_id=$1", [
					actor.userId,
				])
			).rows,
		).toEqual([{ onboarding_step: "work_templates" }]);
		expect(
			(
				await fixture.pool.query(
					"select count(*)::int as n from vacation_allowance where organization_id=$1",
					[organizationId],
				)
			).rows[0].n,
		).toBe(1);
	});

	it("admits an approved owner with no employee in the active organization", async () => {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'owner','approved',now())",
			[randomUUID(), organizationId, callers.owner],
		);
		signIn(callers.owner, organizationId);
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		expect(await createVacationPolicyOnboarding(input)).toMatchObject({ success: true });
	});
});
