import { NextRequest } from "next/server";
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

const routes = await import("./route");
const count = await import("./count/route");
let fixture: LifecycleDatabaseFixture;
beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
});
afterAll(async () => fixture?.close());

async function requestNotification(
	method: "COUNT" | "GET" | "PATCH" | "DELETE",
	body: Record<string, unknown> = { markAllRead: true, deleteAll: true },
) {
	const request = new NextRequest("https://z8.test/api/notifications", {
		method: method === "COUNT" ? "GET" : method,
		headers: { "content-type": "application/json" },
		...(method === "PATCH" || method === "DELETE"
			? { body: JSON.stringify(body) }
			: {}),
	});
	return method === "COUNT" ? count.GET(request) : routes[method](request);
}

it.each([
	"pending",
	"revoked",
	"inactive",
	"due-departure",
	"other-org",
	"member-only-admin",
	"signed-out",
	"mfa",
	"sso",
	"mfa-policy",
	"sso-policy",
] as const)(
	"denies notification count, list and writes for %s admission",
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
		if (denial === "member-only-admin") {
			await fixture.pool.query("update member set role='admin' where id=$1", [
				subject.memberId,
			]);
			await fixture.pool.query("delete from employee where id=$1", [
				subject.employeeId,
			]);
		}
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
		for (const method of ["COUNT", "GET", "PATCH", "DELETE"] as const) {
			const response = await requestNotification(method);
			const sessionDenied = ["signed-out", "mfa", "sso"].includes(denial);
			expect(response.status, method).toBe(sessionDenied ? 401 : 400);
			expect(await response.json()).toEqual({
				error: sessionDenied
					? "Unauthorized"
					: "No active employee record in this organization",
			});
		}
	},
);

it("retains admitted notification reads and immediate scoped write visibility", async () => {
	const subject = await fixture.seedEmployee();
	actor.userId = subject.userId;
	actor.organizationId = fixture.organizationId;
	actor.signedIn = true;
	actor.mfaRequired = false;
	actor.ssoRequired = false;
	await fixture.pool.query(
		"insert into notification (user_id,organization_id,type,title,message) values ($1,$2,'password_changed','Owned notification','Owned body')",
		[subject.userId, fixture.organizationId],
	);
	expect(await (await requestNotification("COUNT")).json()).toEqual({
		count: 1,
	});
	expect(await (await requestNotification("GET")).json()).toMatchObject({
		total: 1,
		unreadCount: 1,
	});
	expect(await (await requestNotification("PATCH")).json()).toEqual({
		success: true,
		updatedCount: 1,
	});
	expect(await (await requestNotification("COUNT")).json()).toEqual({
		count: 0,
	});
	expect(await (await requestNotification("DELETE")).json()).toEqual({
		success: true,
		deletedCount: 1,
	});
	expect(await (await requestNotification("GET")).json()).toMatchObject({
		notifications: [],
		total: 0,
	});
});
