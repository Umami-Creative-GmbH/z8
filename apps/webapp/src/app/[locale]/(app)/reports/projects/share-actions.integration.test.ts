/**
 * #806: creating, listing and revoking report share links on PostgreSQL. The
 * real server actions, report readers and audit trail run; only the session,
 * SSO store and logger are replaced.
 */

import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { shareLinkFixture } from "@/lib/projects/report-share/testing/share-link.fixture";
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

const fixture = shareLinkFixture("t806", "8060");
const { ids } = fixture;
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

	beforeEach(() => fixture.seed(admin));

	afterAll(() => fixture.cleanup(admin));

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
