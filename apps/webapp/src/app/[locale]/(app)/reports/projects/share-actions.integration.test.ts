/**
 * #806: creating, listing and revoking report share links on PostgreSQL. The
 * real server actions, report readers and audit trail run; only the session,
 * SSO store and logger are replaced.
 */

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t806-org",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t806-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { createReportShareLink, listReportShareLinks, revokeReportShareLink } = await import(
	"./share-actions"
);

const ids = {
	organization: "t806-org",
	otherOrganization: "t806-other-org",
	ownerUser: "t806-owner-user",
	pmUser: "t806-pm-user",
	teamManagerUser: "t806-team-manager-user",
	workerUser: "t806-worker-user",
	otherUser: "t806-other-user",
	owner: "80600000-0000-4000-8000-000000000001",
	pm: "80600000-0000-4000-8000-000000000002",
	teamManager: "80600000-0000-4000-8000-000000000003",
	worker: "80600000-0000-4000-8000-000000000004",
	otherEmployee: "80600000-0000-4000-8000-000000000005",
	acme: "80600000-0000-4000-8000-0000000000c1",
	globex: "80600000-0000-4000-8000-0000000000c2",
	foreignCustomer: "80600000-0000-4000-8000-0000000000c3",
	website: "80600000-0000-4000-8000-0000000000a1",
	support: "80600000-0000-4000-8000-0000000000a2",
	portal: "80600000-0000-4000-8000-0000000000a3",
	foreignProject: "80600000-0000-4000-8000-0000000000a4",
} as const;
const users = [ids.ownerUser, ids.pmUser, ids.teamManagerUser, ids.workerUser, ids.otherUser];
const period = { fromDay: "2026-03-01", toDay: "2026-03-31" };

function actAs(userId: string, organizationId: string = ids.organization) {
	harness.userId = userId;
	harness.organizationId = organizationId;
}

async function unwrap<T>(
	result: Promise<{ success: true; data: T } | { success: false; error: string }>,
) {
	const settled = await result;
	if (!settled.success) throw new Error(settled.error);
	return settled.data;
}

async function refusal(
	result: Promise<{ success: true } | { success: false; error: string }>,
): Promise<string> {
	const settled = await result;
	if (settled.success) throw new Error("Expected the action to be refused");
	return settled.error;
}

describe("report share links on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		for (const organizationId of [ids.organization, ids.otherOrganization]) {
			await admin.query("delete from audit_log where organization_id = $1", [organizationId]);
			await admin.query("delete from report_share_link where organization_id = $1", [
				organizationId,
			]);
			await admin.query("delete from work_period where organization_id = $1", [organizationId]);
			await admin.query("delete from time_entry where organization_id = $1", [organizationId]);
		}
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function work(options: {
		employeeId: string;
		projectId: string;
		start: string;
		end: string;
		minutes: number;
		organizationId?: string;
	}) {
		const organizationId = options.organizationId ?? ids.organization;
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			[clockOutId, "clock_out", options.end],
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'Etc/UTC', 'user_setting', $7, $6)`,
				[entryId, options.employeeId, organizationId, type, timestamp, ids.ownerUser, `hash-${entryId}`],
			);
		}
		await admin.query(
			`insert into work_period
			 (id, employee_id, organization_id, clock_in_id, clock_out_id, project_id, is_billable, start_time,
			  end_time, duration_minutes, is_active, approval_status, updated_at)
			 values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, false, 'approved', now())`,
			[
				randomUUID(),
				options.employeeId,
				organizationId,
				clockInId,
				clockOutId,
				options.projectId,
				options.start,
				options.end,
				options.minutes,
			],
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T806 GmbH', $1, 'UTC', true, true, now()), ($2, 'T806 other', $2, 'UTC', true, true, now())`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'EUR')`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t806-m-owner', $1, $2, 'owner', 'approved', now()),
			 ('t806-m-pm', $1, $3, 'member', 'approved', now()),
			 ('t806-m-tm', $1, $4, 'member', 'approved', now()),
			 ('t806-m-worker', $1, $5, 'member', 'approved', now()),
			 ('t806-m-other', $6, $7, 'owner', 'approved', now())`,
			[
				ids.organization,
				ids.ownerUser,
				ids.pmUser,
				ids.teamManagerUser,
				ids.workerUser,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', now()),
			 ($3, $4, $11, 'employee', now()),
			 ($5, $6, $11, 'manager', now()),
			 ($7, $8, $11, 'employee', now()),
			 ($9, $10, $12, 'admin', now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.pm,
				ids.pmUser,
				ids.teamManager,
				ids.teamManagerUser,
				ids.worker,
				ids.workerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $2, 'Acme', $3, now()), ($4, $2, 'Globex', $3, now()), ($5, $6, 'Foreign customer', $7, now())`,
			[
				ids.acme,
				ids.organization,
				ids.ownerUser,
				ids.globex,
				ids.foreignCustomer,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, customer_id, billable_default, created_by, updated_at) values
			 ($1, $5, 'Website', 'active', $6, true, $7, now()),
			 ($2, $5, 'Support', 'active', $6, true, $7, now()),
			 ($3, $5, 'Portal', 'active', $8, true, $7, now()),
			 ($4, $9, 'Foreign project', 'active', $10, true, $11, now())`,
			[
				ids.website,
				ids.support,
				ids.portal,
				ids.foreignProject,
				ids.organization,
				ids.acme,
				ids.ownerUser,
				ids.globex,
				ids.otherOrganization,
				ids.foreignCustomer,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $3, $4), ($2, $3, $4)`,
			[ids.website, ids.support, ids.pm, ids.ownerUser],
		);
		await work({
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-03-02T08:00:00Z",
			end: "2026-03-02T16:00:00Z",
			minutes: 480,
		});
		await work({
			employeeId: ids.worker,
			projectId: ids.support,
			start: "2026-03-03T08:00:00Z",
			end: "2026-03-03T10:00:00Z",
			minutes: 120,
		});
		await work({
			employeeId: ids.worker,
			projectId: ids.portal,
			start: "2026-03-04T08:00:00Z",
			end: "2026-03-04T12:00:00Z",
			minutes: 240,
		});
	});

	afterAll(cleanup);

	function projectLink(projectId: string, overrides: Record<string, unknown> = {}) {
		return {
			kind: "project" as const,
			projectId,
			...period,
			figures: "hours" as const,
			includeEmployees: false,
			locale: "de",
			...overrides,
		};
	}

	async function storedLink(id: string) {
		const { rows } = await admin.query("select * from report_share_link where id = $1", [id]);
		return rows[0];
	}

	it("lets a project manager share only their own projects and nobody without report access", async () => {
		actAs(ids.pmUser);
		const created = await unwrap(createReportShareLink(projectLink(ids.website)));
		expect(created.path).toMatch(/^\/share\/[A-Za-z0-9_-]{43}$/);
		await expect(refusal(createReportShareLink(projectLink(ids.portal)))).resolves.toMatch(
			/permission/i,
		);

		actAs(ids.workerUser);
		await expect(refusal(createReportShareLink(projectLink(ids.website)))).resolves.toMatch(
			/permission/i,
		);
	});

	it("puts exactly one customer's projects into a customer link", async () => {
		actAs(ids.ownerUser);
		const created = await unwrap(
			createReportShareLink({
				kind: "customer",
				customerId: ids.acme,
				...period,
				figures: "revenue",
				locale: "en",
			}),
		);

		const link = await storedLink(created.id);
		expect(link.project_ids.sort()).toEqual([ids.website, ids.support].sort());
		const json = JSON.stringify(link.snapshot);
		expect(json).toContain("Acme");
		expect(json).toContain("Website");
		expect(json).toContain("Support");
		expect(json).not.toContain("Globex");
		expect(json).not.toContain("Portal");
		expect(link.snapshot.customer).toMatchObject({ totalMinutes: 600, workPeriodCount: 2 });
	});

	it("leaves cost, margin, unpriced and pending figures out of an owner's snapshot", async () => {
		actAs(ids.ownerUser);
		const created = await unwrap(
			createReportShareLink(projectLink(ids.website, { figures: "revenue" })),
		);

		const { snapshot } = await storedLink(created.id);
		expect(snapshot.summary.billable).toMatchObject({ access: "shared", revenue: "0.00" });
		const json = JSON.stringify(snapshot);
		for (const key of ["cost", "margin", "marginPercent", "unpricedWorkCount", "pendingReviewCount"]) {
			expect(json).not.toContain(`"${key}"`);
		}
	});

	it("refuses hours + revenue to a creator whose billable access has no revenue", async () => {
		// An employee-role manager sees every project's hours but no money.
		actAs(ids.teamManagerUser);
		await expect(
			refusal(createReportShareLink(projectLink(ids.website, { figures: "revenue" }))),
		).resolves.toMatch(/revenue/i);
		await unwrap(createReportShareLink(projectLink(ids.website, { figures: "hours" })));
	});

	it("expires a link after 30 days by default and refuses more than 90 days or no expiry", async () => {
		actAs(ids.pmUser);
		const created = await unwrap(createReportShareLink(projectLink(ids.website)));
		const link = await storedLink(created.id);
		expect(link.expires_at.getTime() - link.created_at.getTime()).toBe(30 * 24 * 3600 * 1000);

		await expect(
			refusal(createReportShareLink(projectLink(ids.website, { expiresInDays: 91 }))),
		).resolves.toMatch(/90 days/);
		await expect(
			refusal(createReportShareLink(projectLink(ids.website, { expiresInDays: null }))),
		).resolves.toMatch(/expires/i);
	});

	it("stores only a digest of the token, so the database cannot give back a working URL", async () => {
		actAs(ids.pmUser);
		const created = await unwrap(createReportShareLink(projectLink(ids.website)));
		const token = created.path.slice("/share/".length);

		const link = await storedLink(created.id);
		expect(link.token_digest).toBe(createHash("sha256").update(token).digest("hex"));
		expect(JSON.stringify(link)).not.toContain(token);
		const { rows } = await admin.query(
			"select * from audit_log where organization_id = $1",
			[ids.organization],
		);
		expect(JSON.stringify(rows)).not.toContain(token);
	});

	it("audits creating and revoking a link, deletes the snapshot and keeps the link record", async () => {
		actAs(ids.pmUser);
		const created = await unwrap(createReportShareLink(projectLink(ids.website)));
		actAs(ids.ownerUser);
		await unwrap(revokeReportShareLink(created.id));

		const link = await storedLink(created.id);
		expect(link).toMatchObject({
			snapshot: null,
			revoke_reason: "manual",
			revoked_by: ids.ownerUser,
		});
		expect(link.revoked_at).toBeInstanceOf(Date);
		const { rows } = await admin.query(
			"select action, performed_by, entity_id from audit_log where organization_id = $1 order by timestamp",
			[ids.organization],
		);
		expect(rows).toEqual([
			{ action: "report_share_link.created", performed_by: ids.pmUser, entity_id: created.id },
			{ action: "report_share_link.revoked", performed_by: ids.ownerUser, entity_id: created.id },
		]);

		actAs(ids.pmUser);
		const [summary] = await unwrap(listReportShareLinks({ kind: "project", projectId: ids.website }));
		expect(summary).toMatchObject({
			id: created.id,
			status: "revoked",
			revokeReason: "manual",
			reportName: "Website",
			viewCount: 0,
		});
	});

	it("lets only the creator or an owner revoke a link", async () => {
		actAs(ids.pmUser);
		const created = await unwrap(createReportShareLink(projectLink(ids.website)));

		actAs(ids.teamManagerUser);
		await expect(refusal(revokeReportShareLink(created.id))).resolves.toMatch(/permission/i);
		expect(await listReportShareLinks()).toEqual({ success: true, data: [] });

		actAs(ids.pmUser);
		await unwrap(revokeReportShareLink(created.id));
	});

	it("never lists or revokes one organization's links from another", async () => {
		actAs(ids.ownerUser);
		const created = await unwrap(createReportShareLink(projectLink(ids.website)));

		actAs(ids.otherUser, ids.otherOrganization);
		expect(await listReportShareLinks()).toEqual({ success: true, data: [] });
		await expect(refusal(revokeReportShareLink(created.id))).resolves.toMatch(/not found/i);
		await expect(
			refusal(createReportShareLink(projectLink(ids.website))),
		).resolves.toBeTruthy();
		expect((await storedLink(created.id)).revoked_at).toBeNull();
	});
});
