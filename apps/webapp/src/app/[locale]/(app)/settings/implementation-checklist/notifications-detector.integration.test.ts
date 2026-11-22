import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("server-only", () => ({}));

import { loadImplementationChecklistForContext } from "./queries";

describe("implementation checklist notifications detector (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	const extraUserIds: string[] = [];

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
		if (extraUserIds.length > 0) {
			await fixture.pool.query(`delete from "user" where id = any($1::text[])`, [extraUserIds]);
		}
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	async function insertUser(prefix: string) {
		const id = `${prefix}-${crypto.randomUUID()}`;
		extraUserIds.push(id);
		await sql(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, $2, $3, true, now(), now())`,
			[id, id, `${id}@example.test`],
		);
		return id;
	}

	async function insertMember(
		organizationId: string,
		userId: string,
		{ role = "member", status = "approved" }: { role?: string; status?: string } = {},
	) {
		const id = `mem-${crypto.randomUUID()}`;
		await sql(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, $5, now())`,
			[id, organizationId, userId, role, status],
		);
		return id;
	}

	async function insertPreference(
		userId: string,
		{ enabled = true, notificationType = "approval_request_submitted", channel = "email" } = {},
	) {
		await sql(
			`insert into notification_preference (user_id, organization_id, notification_type, channel, enabled, created_at, updated_at)
			 values ($1, null, $2, $3, $4, now(), now())`,
			[userId, notificationType, channel, enabled],
		);
	}

	async function notificationsItem(organizationId: string, userId: string) {
		const checklist = await loadImplementationChecklistForContext({ organizationId, userId });
		return checklist.items.find((item) => item.id === "notifications");
	}

	it("marks notifications configured when a current org member saves an enabled user-level preference with null organizationId", async () => {
		const organizationId = await fixture.createOrganization();
		const memberRow = await fixture.seedEmployee({ organizationId, role: "owner" });

		expect(await notificationsItem(organizationId, memberRow.userId)).toMatchObject({
			status: "not-set-up",
			completionSource: null,
		});

		await insertPreference(memberRow.userId, { enabled: true });

		expect(await notificationsItem(organizationId, memberRow.userId)).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
	});

	it("marks notifications configured for a non-employee org admin with an enabled user-level preference", async () => {
		const organizationId = await fixture.createOrganization();
		const adminUserId = await insertUser("non-emp-admin");
		await insertMember(organizationId, adminUserId, { role: "owner", status: "approved" });
		await insertPreference(adminUserId, { enabled: true });

		expect(await notificationsItem(organizationId, adminUserId)).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
	});

	it("shares user-level preferences across multiple organizations without overwriting other organizations", async () => {
		const orgA = await fixture.createOrganization();
		const orgB = await fixture.createOrganization();
		const multiOrgUserId = await insertUser("multi-org-admin");
		await insertMember(orgA, multiOrgUserId, { role: "owner", status: "approved" });
		await insertMember(orgB, multiOrgUserId, { role: "owner", status: "approved" });
		await insertPreference(multiOrgUserId, { enabled: true });

		expect(await notificationsItem(orgA, multiOrgUserId)).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
		expect(await notificationsItem(orgB, multiOrgUserId)).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
	});

	it("ignores disabled-only preferences, pending/rejected memberships, former employees, and other organizations", async () => {
		const organizationId = await fixture.createOrganization();
		const otherOrganizationId = await fixture.createOrganization();
		const viewer = await fixture.seedEmployee({ organizationId, role: "owner" });

		// Current member with only disabled preference
		await insertPreference(viewer.userId, { enabled: false });

		// Pending and rejected applicants with enabled preferences
		const pendingUserId = await insertUser("pending");
		await insertMember(organizationId, pendingUserId, { role: "member", status: "pending" });
		await insertPreference(pendingUserId, { enabled: true });

		const rejectedUserId = await insertUser("rejected");
		await insertMember(organizationId, rejectedUserId, { role: "member", status: "rejected" });
		await insertPreference(rejectedUserId, { enabled: true });

		// Deactivated former employee with approved membership and enabled preference
		const formerDeactivated = await fixture.seedEmployee({ organizationId, role: "member" });
		await sql(`update employee set is_active = false, deactivated_at = now() where id = $1`, [
			formerDeactivated.employeeId,
		]);
		await insertPreference(formerDeactivated.userId, { enabled: true });

		// Departed former employee whose departure cutoff has already passed
		const formerDeparted = await fixture.seedEmployee({ organizationId, role: "member" });
		await sql(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-01-06', 'UTC', now() - interval '1 day', $4,
			         gen_random_uuid(), 'checklist-notif-test', 1, 'pending')`,
			[organizationId, formerDeparted.employeeId, formerDeparted.employmentPeriodId, viewer.userId],
		);
		await insertPreference(formerDeparted.userId, { enabled: true });

		// Active member of a different organization with enabled preference
		const otherOrgMember = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		await insertPreference(otherOrgMember.userId, { enabled: true });

		expect(await notificationsItem(organizationId, viewer.userId)).toMatchObject({
			status: "not-set-up",
			completionSource: null,
		});
	});

	it("still marks notifications configured when an active notification integration exists without user preferences", async () => {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });

		await sql(
			`insert into webhook_endpoint (organization_id, name, url, secret, subscribed_events, is_active, created_by, created_at, updated_at)
			 values ($1, 'Ops hook', 'https://example.test/hook', 'secret-value', '["approval.created"]'::jsonb, true, $2, now(), now())`,
			[organizationId, owner.userId],
		);

		expect(await notificationsItem(organizationId, owner.userId)).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
	});
});
