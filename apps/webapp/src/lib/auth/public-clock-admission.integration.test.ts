import { randomUUID } from "node:crypto";
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
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

const {
	clockIn,
	clockOut,
	addBreakToActiveSession,
	startBreakInProgress,
	resumeBreakInProgress,
} = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { getTimeClockStatus } = await import(
	"@/app/[locale]/(app)/time-tracking/actions"
);
let fixture: LifecycleDatabaseFixture;
beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
});
afterAll(async () => fixture?.close());

it("refuses the public clock-in command while MFA is required", async () => {
	const subject = await fixture.seedEmployee();
	actor.userId = subject.userId;
	actor.organizationId = fixture.organizationId;
	actor.mfaRequired = true;
	expect(
		await clockIn("office", {
			browserTimezone: "UTC",
			submissionId: randomUUID(),
		}),
	).toEqual({
		success: false,
		error: "Not authenticated",
	});
});

it.each([
	"mfa",
	"sso",
	"pending",
	"revoked",
	"inactive",
	"due-departure",
	"other-org",
	"signed-out",
	"mfa-policy",
	"sso-policy",
] as const)(
	"refuses every public clock and break command for %s without changing live work",
	async (denial) => {
		const organizationId = denial.endsWith("-policy")
			? await fixture.createOrganization()
			: fixture.organizationId;
		const subject = await fixture.seedEmployee({ organizationId });
		actor.userId = subject.userId;
		actor.organizationId = organizationId;
		actor.signedIn = true;
		actor.mfaRequired = false;
		actor.ssoRequired = false;
		expect(
			await clockIn("office", {
				browserTimezone: "UTC",
				submissionId: randomUUID(),
			}),
		).toMatchObject({ success: true });
		const before = await getTimeClockStatus();
		expect(before.isClockedIn).toBe(true);
		const workPeriodId = before.activeWorkPeriod?.id;
		if (!workPeriodId)
			throw new Error("Admitted clock-in did not create live work");
		actor.mfaRequired = denial === "mfa";
		actor.ssoRequired = denial === "sso";
		actor.signedIn = denial !== "signed-out";
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
		const context = {
			browserTimezone: "UTC",
			submissionId: randomUUID(),
			workPeriodId,
		};
		const error = [
			"mfa",
			"sso",
			"signed-out",
			"mfa-policy",
			"sso-policy",
		].includes(denial)
			? "Not authenticated"
			: "Employee profile not found";
		expect(await clockIn("office", context)).toEqual({ success: false, error });
		expect(await clockOut(null, null, context)).toEqual({
			success: false,
			error,
		});
		expect(await addBreakToActiveSession(15, context)).toEqual({
			success: false,
			error,
		});
		expect(await startBreakInProgress(context)).toMatchObject({
			success: false,
			error,
		});
		expect(
			await resumeBreakInProgress({
				...context,
				breakStart: before.activeWorkPeriod?.startTime.toISOString() ?? "",
			}),
		).toMatchObject({ success: false, error });
		// Restore only this test's admission fixture, then read the authoritative public state.
		actor.organizationId = organizationId;
		actor.signedIn = true;
		actor.mfaRequired = false;
		actor.ssoRequired = false;
		await fixture.pool.query(
			"delete from organization_mfa_policy where organization_id=$1",
			[organizationId],
		);
		await fixture.pool.query(
			"delete from enterprise_identity_setup where organization_id=$1",
			[organizationId],
		);
		if (denial === "revoked")
			await fixture.pool.query(
				"insert into member (id,user_id,organization_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())",
				[subject.memberId, subject.userId, fixture.organizationId],
			);
		await fixture.pool.query(
			"update member set status='approved' where id=$1",
			[subject.memberId],
		);
		await fixture.pool.query("update employee set is_active=true where id=$1", [
			subject.employeeId,
		]);
		await fixture.pool.query(
			"delete from employee_departure where employee_id=$1",
			[subject.employeeId],
		);
		expect(await getTimeClockStatus()).toEqual(before);
	},
);
