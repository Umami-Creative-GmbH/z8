/**
 * #825: position capture settings, assignments, notice versions and position
 * consent, through the settings server actions and the capture resolver on
 * PostgreSQL. Only the session is mocked.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
								id: `t825-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
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

const admin = await import("@/app/[locale]/(app)/settings/position-capture/actions");
const own = await import("@/app/[locale]/(app)/settings/position-stamps/actions");
const { resolvePositionCapture, acceptsPositionStamp } = await import("./resolver");

const ids = {
	organization: "t825-position-org",
	otherOrganization: "t825-other-org",
	ownerUser: "t825-owner-user",
	adminUser: "t825-admin-user",
	managerUser: "t825-manager-user",
	fieldUser: "t825-field-user",
	officeUser: "t825-office-user",
	foreignUser: "t825-foreign-user",
	owner: "d8250000-0000-4000-8000-000000000001",
	adminEmployee: "d8250000-0000-4000-8000-000000000002",
	manager: "d8250000-0000-4000-8000-000000000003",
	field: "d8250000-0000-4000-8000-000000000004",
	office: "d8250000-0000-4000-8000-000000000005",
	foreign: "d8250000-0000-4000-8000-000000000006",
	fieldTeam: "d8250000-0000-4000-8000-0000000000a1",
	officeTeam: "d8250000-0000-4000-8000-0000000000a2",
	foreignTeam: "d8250000-0000-4000-8000-0000000000a3",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.fieldUser,
	ids.officeUser,
	ids.foreignUser,
];

describe("position capture settings and consent on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T825 position', $1, 'Europe/Berlin', $3), ($2, 'T825 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t825-m-owner', $1, $2, 'owner', 'approved', $8),
			 ('t825-m-admin', $1, $3, 'admin', 'approved', $8),
			 ('t825-m-manager', $1, $4, 'member', 'approved', $8),
			 ('t825-m-field', $1, $5, 'member', 'approved', $8),
			 ('t825-m-office', $1, $6, 'member', 'approved', $8),
			 ('t825-m-foreign', $7, $9, 'owner', 'approved', $8)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.adminUser,
				ids.managerUser,
				ids.fieldUser,
				ids.officeUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await pool.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $2, 'Field', now()), ($3, $2, 'Office', now()), ($4, $5, 'Foreign', now())`,
			[ids.fieldTeam, ids.organization, ids.officeTeam, ids.foreignTeam, ids.otherOrganization],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, team_id, updated_at) values
			 ($1, $2, $13, 'admin', 'OWN-1', null, $14),
			 ($3, $4, $13, 'admin', 'ADM-1', null, $14),
			 ($5, $6, $13, 'manager', 'MGR-1', $16, $14),
			 ($7, $8, $13, 'employee', 'FLD-1', $16, $14),
			 ($9, $10, $13, 'employee', 'OFF-1', $17, $14),
			 ($11, $12, $15, 'admin', 'FOR-1', $18, $14)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.adminEmployee,
				ids.adminUser,
				ids.manager,
				ids.managerUser,
				ids.field,
				ids.fieldUser,
				ids.office,
				ids.officeUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
				ids.fieldTeam,
				ids.officeTeam,
				ids.foreignTeam,
			],
		);
		await pool.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
	}

	async function saveSettings(
		input: { enabled: boolean; purposeStatement: string | null; retentionDays: number },
		userId: string = ids.ownerUser,
	) {
		actAs(userId);
		return admin.savePositionCaptureSettingsAction(input);
	}

	async function resolve(employeeId: string, organizationId: string = ids.organization) {
		return resolvePositionCapture(db, { organizationId, employeeId });
	}

	beforeEach(async () => {
		vi.restoreAllMocks();
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("refuses to switch capture on without a purpose statement", async () => {
		const result = await saveSettings({ enabled: true, purposeStatement: " ", retentionDays: 90 });

		expect(result.success).toBe(false);
		const settings = await (async () => {
			actAs(ids.ownerUser);
			return admin.getPositionCaptureAdminDataAction();
		})();
		expect(settings.success && settings.data.settings).toMatchObject({
			enabled: false,
			purposeStatement: null,
			retentionDays: 90,
		});
	});

	it("lets only owners and admins change settings and assignments", async () => {
		const purpose = { enabled: true, purposeStatement: "Customer proof", retentionDays: 90 };
		for (const userId of [ids.managerUser, ids.fieldUser]) {
			const save = await saveSettings(purpose, userId);
			expect(save).toMatchObject({ success: false, code: "AuthorizationError" });
			actAs(userId);
			expect(
				await admin.setPositionCaptureAssignmentAction({
					target: { type: "organization" },
					captureEnabled: true,
				}),
			).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(await admin.getPositionCaptureAdminDataAction()).toMatchObject({ success: false });
		}

		expect(await saveSettings(purpose, ids.adminUser)).toMatchObject({
			success: true,
			data: { publishedNoticeVersion: 1 },
		});
		actAs(ids.ownerUser);
		const data = await admin.getPositionCaptureAdminDataAction();
		expect(data.success && data.data.settings).toEqual({
			enabled: true,
			purposeStatement: "Customer proof",
			retentionDays: 90,
		});
	});

	it("keeps capture off for everyone until a team or employee is assigned, most specific first", async () => {
		await saveSettings({ enabled: true, purposeStatement: "Customer proof", retentionDays: 90 });
		for (const employeeId of [ids.owner, ids.manager, ids.field, ids.office]) {
			expect((await resolve(employeeId)).captureOn).toBe(false);
		}

		actAs(ids.ownerUser);
		expect(
			await admin.setPositionCaptureAssignmentAction({
				target: { type: "team", teamId: ids.fieldTeam },
				captureEnabled: true,
			}),
		).toMatchObject({ success: true });
		expect((await resolve(ids.field)).captureOn).toBe(true);
		expect((await resolve(ids.manager)).captureOn).toBe(true);
		expect((await resolve(ids.office)).captureOn).toBe(false);

		await admin.setPositionCaptureAssignmentAction({
			target: { type: "employee", employeeId: ids.manager },
			captureEnabled: false,
		});
		await admin.setPositionCaptureAssignmentAction({
			target: { type: "employee", employeeId: ids.office },
			captureEnabled: true,
		});
		expect((await resolve(ids.manager)).captureOn).toBe(false);
		expect((await resolve(ids.field)).captureOn).toBe(true);
		expect((await resolve(ids.office)).captureOn).toBe(true);

		// Switching the master switch off stops capture for every assignment.
		await saveSettings({ enabled: false, purposeStatement: "Customer proof", retentionDays: 90 });
		expect((await resolve(ids.field)).captureOn).toBe(false);
		expect((await resolve(ids.office)).captureOn).toBe(false);
	});

	it("refuses assignments of another organization's team or employee, and resolves strangers as off", async () => {
		actAs(ids.ownerUser);
		expect(
			await admin.setPositionCaptureAssignmentAction({
				target: { type: "team", teamId: ids.foreignTeam },
				captureEnabled: true,
			}),
		).toMatchObject({ success: false, code: "NotFoundError" });
		expect(
			await admin.setPositionCaptureAssignmentAction({
				target: { type: "employee", employeeId: ids.foreign },
				captureEnabled: true,
			}),
		).toMatchObject({ success: false, code: "NotFoundError" });

		await saveSettings({ enabled: true, purposeStatement: "Customer proof", retentionDays: 90 });
		await admin.setPositionCaptureAssignmentAction({
			target: { type: "organization" },
			captureEnabled: true,
		});
		expect((await resolve(ids.field)).captureOn).toBe(true);
		expect((await resolve(ids.foreign)).captureOn).toBe(false);
		expect((await resolve(ids.field, ids.otherOrganization)).captureOn).toBe(false);

		// The foreign owner cannot remove our assignment from their organization.
		actAs(ids.ownerUser);
		const data = await admin.getPositionCaptureAdminDataAction();
		const assignmentId = data.success ? data.data.assignments[0].id : "";
		actAs(ids.foreignUser, ids.otherOrganization);
		expect(await admin.removePositionCaptureAssignmentAction({ assignmentId })).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect((await resolve(ids.field)).captureOn).toBe(true);
	});

	async function switchOnForFieldTeam(purposeStatement = "Customer proof", retentionDays = 90) {
		await saveSettings({ enabled: true, purposeStatement, retentionDays });
		actAs(ids.ownerUser);
		await admin.setPositionCaptureAssignmentAction({
			target: { type: "team", teamId: ids.fieldTeam },
			captureEnabled: true,
		});
	}

	async function ownData(userId: string) {
		actAs(userId);
		const result = await own.getOwnPositionCaptureAction();
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	async function consentRows(employeeId: string) {
		const { rows } = await pool.query(
			`select n.version, c.granted_at is not null as granted, c.withdrawn_at is not null as withdrawn
			 from position_consent c join position_notice n on n.id = c.notice_id
			 where c.organization_id = $1 and c.employee_id = $2 order by c.granted_at, c.id`,
			[ids.organization, employeeId],
		);
		return rows as { version: number; granted: boolean; withdrawn: boolean }[];
	}

	it("lets an employee agree and withdraw, keeping grant and withdrawal times and the notice version", async () => {
		await switchOnForFieldTeam();
		const before = await ownData(ids.fieldUser);
		expect(before).toMatchObject({
			captureOn: true,
			consent: { kind: "undecided" },
			asksForConsent: true,
			canWithdraw: false,
			notice: { version: 1, purposeStatement: "Customer proof", retentionDays: 90 },
		});

		const agreed = await own.agreeToPositionNoticeAction({ noticeId: before.notice?.id ?? "" });
		expect(agreed.success).toBe(true);
		const active = await ownData(ids.fieldUser);
		expect(active).toMatchObject({
			consent: { kind: "active", noticeVersion: 1 },
			asksForConsent: false,
			canWithdraw: true,
		});
		const resolution = await resolve(ids.field);
		expect(resolution.mayCapture).toBe(true);
		if (resolution.consent.kind !== "active") throw new Error("expected active consent");
		const grantedAt = resolution.consent.grantedAt;
		expect(acceptsPositionStamp(resolution, grantedAt.add({ seconds: 1 }))).toBe(true);
		expect(acceptsPositionStamp(resolution, grantedAt.subtract({ seconds: 1 }))).toBe(false);

		actAs(ids.fieldUser);
		expect(await own.withdrawPositionConsentAction()).toMatchObject({
			success: true,
			data: { withdrawn: 1 },
		});
		expect(await ownData(ids.fieldUser)).toMatchObject({
			consent: { kind: "withdrawn", noticeVersion: 1 },
			asksForConsent: false,
			canWithdraw: false,
		});
		expect((await resolve(ids.field)).mayCapture).toBe(false);
		expect(await consentRows(ids.field)).toEqual([{ version: 1, granted: true, withdrawn: true }]);

		// Agreeing again under the same notice is a new consent record.
		await own.agreeToPositionNoticeAction({ noticeId: before.notice?.id ?? "" });
		expect(await consentRows(ids.field)).toEqual([
			{ version: 1, granted: true, withdrawn: true },
			{ version: 1, granted: true, withdrawn: false },
		]);
	});

	it("publishes a new notice version for a new purpose or longer retention and lapses consents, not for shorter retention", async () => {
		await switchOnForFieldTeam("Customer proof", 90);
		const first = await ownData(ids.fieldUser);
		await own.agreeToPositionNoticeAction({ noticeId: first.notice?.id ?? "" });

		expect(
			await saveSettings({ enabled: true, purposeStatement: "Customer proof", retentionDays: 30 }),
		).toMatchObject({ success: true, data: { publishedNoticeVersion: null } });
		expect(await ownData(ids.fieldUser)).toMatchObject({
			retentionDays: 30,
			notice: { version: 1, retentionDays: 90 },
			consent: { kind: "active", noticeVersion: 1 },
		});

		// Lengthening back within what the employees agreed to (90 days) needs no new version.
		expect(
			await saveSettings({ enabled: true, purposeStatement: "Customer proof", retentionDays: 90 }),
		).toMatchObject({ success: true, data: { publishedNoticeVersion: null } });
		expect(
			await saveSettings({ enabled: true, purposeStatement: "Customer proof", retentionDays: 120 }),
		).toMatchObject({ success: true, data: { publishedNoticeVersion: 2 } });
		const lapsed = await ownData(ids.fieldUser);
		expect(lapsed).toMatchObject({
			notice: { version: 2, retentionDays: 120 },
			consent: { kind: "lapsed", noticeVersion: 1 },
			asksForConsent: true,
			canWithdraw: true,
		});
		expect((await resolve(ids.field)).mayCapture).toBe(false);

		await own.agreeToPositionNoticeAction({ noticeId: lapsed.notice?.id ?? "" });
		expect((await resolve(ids.field)).mayCapture).toBe(true);

		expect(
			await saveSettings({ enabled: true, purposeStatement: "Site safety", retentionDays: 120 }),
		).toMatchObject({ success: true, data: { publishedNoticeVersion: 3 } });
		expect(await ownData(ids.fieldUser)).toMatchObject({
			notice: { version: 3, purposeStatement: "Site safety" },
			consent: { kind: "lapsed", noticeVersion: 2 },
		});

		actAs(ids.ownerUser);
		const data = await admin.getPositionCaptureAdminDataAction();
		expect(data.success && data.data.notices.map((notice) => notice.version)).toEqual([3, 2, 1]);
	});

	it("refuses consent to a notice version that is no longer current", async () => {
		await switchOnForFieldTeam();
		const first = await ownData(ids.fieldUser);
		await saveSettings({ enabled: true, purposeStatement: "Site safety", retentionDays: 90 });

		expect(
			await own.agreeToPositionNoticeAction({ noticeId: first.notice?.id ?? "" }),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(await consentRows(ids.field)).toEqual([]);
	});

	it("stops asking after 'Not now' until a new notice version is published", async () => {
		await switchOnForFieldTeam();
		const first = await ownData(ids.fieldUser);
		expect(
			await own.declinePositionNoticeAction({ noticeId: first.notice?.id ?? "" }),
		).toMatchObject({ success: true });
		expect(await ownData(ids.fieldUser)).toMatchObject({
			consent: { kind: "declined", noticeVersion: 1 },
			asksForConsent: false,
		});

		await saveSettings({ enabled: true, purposeStatement: "Site safety", retentionDays: 90 });
		expect(await ownData(ids.fieldUser)).toMatchObject({
			consent: { kind: "undecided" },
			asksForConsent: true,
		});
	});

	it("never asks employees capture is off for, and keeps consent valid when capture is switched back on", async () => {
		await switchOnForFieldTeam();
		expect(await ownData(ids.officeUser)).toMatchObject({
			captureOn: false,
			asksForConsent: false,
		});

		const notice = (await ownData(ids.fieldUser)).notice;
		await own.agreeToPositionNoticeAction({ noticeId: notice?.id ?? "" });
		await saveSettings({ enabled: false, purposeStatement: "Customer proof", retentionDays: 90 });
		expect(await resolve(ids.field)).toMatchObject({
			captureOn: false,
			mayCapture: false,
			consent: { kind: "active" },
		});
		await saveSettings({ enabled: true, purposeStatement: "Customer proof", retentionDays: 90 });
		expect((await resolve(ids.field)).mayCapture).toBe(true);
	});

	it("reads the configuration and consent under share locks inside a transaction", async () => {
		await switchOnForFieldTeam();
		const notice = (await ownData(ids.fieldUser)).notice;
		await own.agreeToPositionNoticeAction({ noticeId: notice?.id ?? "" });

		const resolution = await db.transaction((tx) =>
			resolvePositionCapture(
				tx,
				{ organizationId: ids.organization, employeeId: ids.field },
				{ lock: "share" },
			),
		);
		expect(resolution.mayCapture).toBe(true);
		expect(acceptsPositionStamp(resolution, parseInstant("2099-01-01T00:00:00Z"))).toBe(true);
	});
});
