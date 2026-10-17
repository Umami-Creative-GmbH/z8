/**
 * #1364 (spec #889): kiosk badge management on PostgreSQL, through the employee
 * page's server actions. Who may issue, replace and revoke a badge, the
 * organization boundary, one active badge per employee under concurrency, and
 * that the credential leaves the server only inside the issuance PDF. Which
 * credential is valid is observed through `resolveActiveKioskBadge`, the
 * verification kiosks use.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";
import { pdfQrCodeText, pdfTexts } from "./badge-pdf.test.fixture";

const session = vi.hoisted(() => ({
	current: null as null | { userId: string; organizationId: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-organization-actor", () => ({
	requireOrganizationActor: async (refusal: () => Error) => {
		if (!session.current) throw refusal();
		return session.current;
	},
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

const {
	getEmployeeKioskStateAction,
	issueEmployeeKioskBadgeAction,
	replaceEmployeeKioskBadgeAction,
	revokeEmployeeKioskBadgeAction,
} = await import("@/app/[locale]/(app)/settings/employees/kiosk-actions");
const { resolveActiveKioskBadge } = await import("./badge-store");
const { issueKioskPin, verifyEmployeeKioskPin } = await import("./pin-store");

const ids = {
	organization: "t1364-badge-org",
	otherOrganization: "t1364-badge-other-org",
	ownerUser: "t1364-badge-owner-user",
	adminUser: "t1364-badge-admin-user",
	managerUser: "t1364-badge-manager-user",
	otherManagerUser: "t1364-badge-other-manager-user",
	workerUser: "t1364-badge-worker-user",
	kioskOnlyUser: "t1364-badge-kiosk-only-user",
	inactiveUser: "t1364-badge-inactive-user",
	foreignUser: "t1364-badge-foreign-user",
	owner: "d1364000-0000-4000-8000-000000000001",
	admin: "d1364000-0000-4000-8000-000000000002",
	manager: "d1364000-0000-4000-8000-000000000003",
	otherManager: "d1364000-0000-4000-8000-000000000004",
	worker: "d1364000-0000-4000-8000-000000000005",
	kioskOnly: "d1364000-0000-4000-8000-000000000006",
	inactive: "d1364000-0000-4000-8000-000000000007",
	foreign: "d1364000-0000-4000-8000-000000000008",
	workerPeriod: "d1364000-0000-4000-8000-0000000000a5",
	inactivePeriod: "d1364000-0000-4000-8000-0000000000a7",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.otherManagerUser,
	ids.workerUser,
	ids.kioskOnlyUser,
	ids.inactiveUser,
	ids.foreignUser,
];
const org = ids.organization;
const now = parseInstant("2026-10-17T08:00:00Z");

function signIn(userId: string, organizationId: string = org) {
	session.current = { userId, organizationId };
}

type IssueResult = Awaited<ReturnType<typeof issueEmployeeKioskBadgeAction>>;

/** The credential a scanner reads from the issued PDF. */
function credentialOf(result: IssueResult): string {
	if (!result.success) throw new Error(`Expected an issued badge, got ${result.code}`);
	const credential = pdfQrCodeText(Buffer.from(result.data.pdf, "base64"));
	if (!credential) throw new Error("The badge PDF has no readable QR code");
	return credential;
}

function codeOf(result: { success: boolean; code?: string }) {
	return result.success ? "success" : result.code;
}

async function badgeHolder(credential: string, organizationId: string = org, at = now) {
	const badge = await resolveActiveKioskBadge(db, { organizationId, credential, now: at });
	return badge?.employeeId ?? null;
}

describe("kiosk badge management on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	beforeEach(async () => {
		session.current = null;
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'Bäckerei T1364', $1, 'Europe/Berlin', $3), ($2, 'T1364 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, first_name, last_name, email, created_at, updated_at)
			 select user_id, user_id, 'First ' || user_id, 'Last', email, $3, $3
			 from unnest($1::text[], $2::text[]) as seeded(user_id, email)`,
			[
				users,
				users.map((id) =>
					id === ids.kioskOnlyUser ? `${id}@kiosk.invalid` : `${id}@example.test`,
				),
				timestamp,
			],
		);
		await pool.query(`update "user" set first_name = 'Jürgen', last_name = 'Weiß' where id = $1`, [
			ids.workerUser,
		]);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1364-m-owner', $1, $2, 'owner', 'approved', $3),
			 ('t1364-m-admin', $1, $4, 'admin', 'approved', $3),
			 ('t1364-m-manager', $1, $5, 'member', 'approved', $3),
			 ('t1364-m-other-manager', $1, $6, 'member', 'approved', $3),
			 ('t1364-m-worker', $1, $7, 'member', 'approved', $3),
			 ('t1364-m-kiosk-only', $1, $8, 'member', 'approved', $3),
			 ('t1364-m-inactive', $1, $9, 'member', 'approved', $3),
			 ('t1364-m-foreign', $10, $11, 'owner', 'approved', $3)`,
			[
				org,
				ids.ownerUser,
				timestamp,
				ids.adminUser,
				ids.managerUser,
				ids.otherManagerUser,
				ids.workerUser,
				ids.kioskOnlyUser,
				ids.inactiveUser,
				ids.otherOrganization,
				ids.foreignUser,
			],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $17, 'admin', true, now()),
			 ($3, $4, $17, 'admin', true, now()),
			 ($5, $6, $17, 'manager', true, now()),
			 ($7, $8, $17, 'manager', true, now()),
			 ($9, $10, $17, 'employee', true, now()),
			 ($11, $12, $17, 'employee', true, now()),
			 ($13, $14, $17, 'employee', false, now()),
			 ($15, $16, $18, 'admin', true, now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.admin,
				ids.adminUser,
				ids.manager,
				ids.managerUser,
				ids.otherManager,
				ids.otherManagerUser,
				ids.worker,
				ids.workerUser,
				ids.kioskOnly,
				ids.kioskOnlyUser,
				ids.inactive,
				ids.inactiveUser,
				ids.foreign,
				ids.foreignUser,
				org,
				ids.otherOrganization,
			],
		);
		// The kiosk-only employee has no recorded period yet, as when created (ADR 0006).
		await pool.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, start_provenance) values
			 ($1, $3, $2, 'open', $5, 'recorded'), ($4, $3, $6, 'open', $5, 'recorded')`,
			[ids.workerPeriod, ids.worker, org, ids.inactivePeriod, timestamp, ids.inactive],
		);
		await pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by) values
			 ($1, $3, true, $4), ($2, $3, true, $4), ($5, $3, true, $4)`,
			[ids.worker, ids.kioskOnly, ids.manager, ids.ownerUser, ids.inactive],
		);
	});

	afterAll(cleanup);

	it("issues a printable badge whose QR code is the only copy of the credential", async () => {
		signIn(ids.ownerUser);
		const result = await issueEmployeeKioskBadgeAction(ids.worker);
		const credential = credentialOf(result);

		expect(result.success && result.data.filename).toBe("kiosk-badge-jurgen-wei.pdf");
		const texts = pdfTexts(Buffer.from(result.success ? result.data.pdf : "", "base64"));
		expect(texts).toContain("Jürgen Weiß");
		expect(texts).toContain("Bäckerei T1364");
		expect(await badgeHolder(credential)).toBe(ids.worker);

		const state = await getEmployeeKioskStateAction(ids.worker);
		expect(state).toMatchObject({
			success: true,
			data: {
				badge: { activeIssuedAt: expect.any(String), lastRevokedAt: null, lastRevokedReason: null },
			},
		});
		expect(JSON.stringify(state)).not.toContain(credential);

		const stored = await pool.query(
			"select * from employee_kiosk_badge where organization_id = $1",
			[org],
		);
		expect(stored.rows).toHaveLength(1);
		expect(JSON.stringify(stored.rows)).not.toContain(credential);
		const audit = await pool.query("select * from audit_log where organization_id = $1", [org]);
		expect(JSON.stringify(audit.rows)).not.toContain(credential);
	});

	it("lets owners, admins and the direct manager manage a badge, and nobody else", async () => {
		signIn(ids.managerUser);
		credentialOf(await issueEmployeeKioskBadgeAction(ids.worker));
		signIn(ids.adminUser);
		credentialOf(await replaceEmployeeKioskBadgeAction(ids.worker));
		signIn(ids.ownerUser);
		credentialOf(await replaceEmployeeKioskBadgeAction(ids.worker));

		for (const actor of [ids.otherManagerUser, ids.workerUser, ids.kioskOnlyUser]) {
			signIn(actor);
			expect(codeOf(await replaceEmployeeKioskBadgeAction(ids.worker))).toBe("not_allowed");
			expect(codeOf(await revokeEmployeeKioskBadgeAction(ids.worker))).toBe("not_allowed");
			expect(codeOf(await issueEmployeeKioskBadgeAction(ids.manager))).toBe("not_allowed");
			expect(await getEmployeeKioskStateAction(ids.worker)).toEqual({ success: true, data: null });
		}

		// A foreign owner reaches neither through their own organization nor through ours.
		signIn(ids.foreignUser, ids.otherOrganization);
		expect(codeOf(await revokeEmployeeKioskBadgeAction(ids.worker))).toBe("employee_not_found");
		signIn(ids.foreignUser, org);
		expect(codeOf(await revokeEmployeeKioskBadgeAction(ids.worker))).toBe("not_allowed");
		signIn(ids.ownerUser);
		expect(codeOf(await issueEmployeeKioskBadgeAction(ids.foreign))).toBe("employee_not_found");
		session.current = null;
		expect(codeOf(await revokeEmployeeKioskBadgeAction(ids.worker))).toBe("sign_in_required");
	});

	it("gives kiosk-only employees a badge and refuses inactive employees", async () => {
		signIn(ids.managerUser);
		const credential = credentialOf(await issueEmployeeKioskBadgeAction(ids.kioskOnly));
		expect(await badgeHolder(credential)).toBe(ids.kioskOnly);

		expect(codeOf(await issueEmployeeKioskBadgeAction(ids.inactive))).toBe("employee_inactive");
		const stored = await pool.query(
			"select count(*)::int as count from employee_kiosk_badge where employee_id = $1",
			[ids.inactive],
		);
		expect(stored.rows[0].count).toBe(0);
	});

	it("keeps one badge per employee: a second issue is refused, replacement invalidates every old copy", async () => {
		signIn(ids.ownerUser);
		const first = credentialOf(await issueEmployeeKioskBadgeAction(ids.worker));
		expect(codeOf(await issueEmployeeKioskBadgeAction(ids.worker))).toBe("badge_exists");
		expect(codeOf(await replaceEmployeeKioskBadgeAction(ids.manager))).toBe("no_badge");
		expect(codeOf(await revokeEmployeeKioskBadgeAction(ids.manager))).toBe("no_badge");

		const second = credentialOf(await replaceEmployeeKioskBadgeAction(ids.worker));

		expect(second).not.toBe(first);
		expect(await badgeHolder(first)).toBeNull();
		expect(await badgeHolder(second)).toBe(ids.worker);
		const audit = await pool.query(
			`select action, performed_by, employee_id, entity_type, entity_id, metadata
			 from audit_log where organization_id = $1 and entity_type = 'kiosk_badge'
			 order by timestamp`,
			[org],
		);
		expect(audit.rows).toEqual([
			expect.objectContaining({
				action: "kiosk_badge.issued",
				performed_by: ids.ownerUser,
				employee_id: ids.worker,
				metadata: null,
			}),
			expect.objectContaining({
				action: "kiosk_badge.replaced",
				performed_by: ids.ownerUser,
				employee_id: ids.worker,
				metadata: JSON.stringify({ replacedBadgeId: audit.rows[0].entity_id }),
			}),
		]);
	});

	it("revokes a badge for good without touching the employee's kiosk PIN", async () => {
		const { pin } = await issueKioskPin(db, {
			organizationId: org,
			actorUserId: ids.ownerUser,
			employeeId: ids.worker,
		});
		signIn(ids.managerUser);
		const revokedCredential = credentialOf(await issueEmployeeKioskBadgeAction(ids.worker));

		expect(await revokeEmployeeKioskBadgeAction(ids.worker)).toEqual({
			success: true,
			data: { revoked: true },
		});

		expect(await badgeHolder(revokedCredential)).toBeNull();
		await expect(
			verifyEmployeeKioskPin(db, { organizationId: org, employeeId: ids.worker, pin }),
		).resolves.toEqual({ status: "verified" });
		expect(await getEmployeeKioskStateAction(ids.worker)).toMatchObject({
			data: {
				hasPin: true,
				badge: {
					activeIssuedAt: null,
					lastRevokedAt: expect.any(String),
					lastRevokedReason: "revoked",
				},
			},
		});
		const audit = await pool.query(
			`select performed_by, employee_id from audit_log
			 where organization_id = $1 and action = 'kiosk_badge.revoked'`,
			[org],
		);
		expect(audit.rows).toEqual([{ performed_by: ids.managerUser, employee_id: ids.worker }]);

		// A new badge is a new credential; the revoked one never comes back.
		const fresh = credentialOf(await issueEmployeeKioskBadgeAction(ids.worker));
		expect(await badgeHolder(fresh)).toBe(ids.worker);
		expect(await badgeHolder(revokedCredential)).toBeNull();
	});

	it("leaves exactly one active badge when issues, replacements and revocations race", async () => {
		signIn(ids.ownerUser);
		const issues = await Promise.all(
			Array.from({ length: 5 }, () => issueEmployeeKioskBadgeAction(ids.worker)),
		);
		expect(issues.map(codeOf).sort()).toEqual([
			"badge_exists",
			"badge_exists",
			"badge_exists",
			"badge_exists",
			"success",
		]);

		const replacements = await Promise.all(
			Array.from({ length: 5 }, () => replaceEmployeeKioskBadgeAction(ids.worker)),
		);
		expect(replacements.every((result) => result.success)).toBe(true);
		const holders = await Promise.all(
			[...issues.filter((result) => result.success), ...replacements].map((result) =>
				badgeHolder(credentialOf(result)),
			),
		);
		expect(holders.filter((holder) => holder === ids.worker)).toHaveLength(1);

		await Promise.all([
			replaceEmployeeKioskBadgeAction(ids.worker),
			revokeEmployeeKioskBadgeAction(ids.worker),
			replaceEmployeeKioskBadgeAction(ids.worker),
			issueEmployeeKioskBadgeAction(ids.worker),
		]);
		const active = await pool.query(
			`select count(*)::int as count from employee_kiosk_badge
			 where employee_id = $1 and revoked_at is null`,
			[ids.worker],
		);
		expect(active.rows[0].count).toBeLessThanOrEqual(1);
	});

	it("never expires a badge and never accepts it in another organization or after access ends", async () => {
		signIn(ids.ownerUser);
		const credential = credentialOf(await issueEmployeeKioskBadgeAction(ids.worker));

		expect(await badgeHolder(credential, org, parseInstant("2076-10-17T08:00:00Z"))).toBe(
			ids.worker,
		);
		expect(await badgeHolder(credential, ids.otherOrganization)).toBeNull();
		expect(await badgeHolder(credential.toLowerCase())).toBe(ids.worker);
		expect(await badgeHolder(`${credential}0`)).toBeNull();

		await pool.query("update employee set is_active = false where id = $1", [ids.worker]);
		expect(await badgeHolder(credential)).toBeNull();
		// Revocation still works for an employee who is no longer active.
		expect(codeOf(await revokeEmployeeKioskBadgeAction(ids.worker))).toBe("success");
	});
});
