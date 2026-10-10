/**
 * #859: kiosk enrolment on PostgreSQL. Owners and admins create kiosks in
 * settings, a device exchanges the pairing code for a device token at the
 * public pairing endpoint, and every kiosk request resolves its token through
 * the kiosk-authentication helper. Only the user session is mocked.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
								id: `t859-session-${harness.userId}`,
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

const admin = await import("@/app/[locale]/(app)/settings/kiosks/actions");
const pairRoute = await import("@/app/api/kiosk/pair/route");
const sessionRoute = await import("@/app/api/kiosk/session/route");
const { resolveKioskFromRequest, resolveKioskFromToken, KIOSK_TOKEN_HEADER } = await import(
	"./authenticate"
);

const ids = {
	organization: "t859-kiosk-org",
	otherOrganization: "t859-other-org",
	ownerUser: "t859-owner-user",
	adminUser: "t859-admin-user",
	managerUser: "t859-manager-user",
	memberUser: "t859-member-user",
	foreignUser: "t859-foreign-user",
	store: "d8590000-0000-4000-8000-0000000000a1",
	warehouse: "d8590000-0000-4000-8000-0000000000a2",
	foreignLocation: "d8590000-0000-4000-8000-0000000000a3",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.managerUser, ids.memberUser, ids.foreignUser];

describe("kiosk enrolment on PostgreSQL", () => {
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
			 ($1, 'T859 kiosks', $1, 'Europe/Berlin', $3), ($2, 'T859 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t859-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t859-m-admin', $1, $3, 'admin', 'approved', $7),
			 ('t859-m-manager', $1, $4, 'member', 'approved', $7),
			 ('t859-m-member', $1, $5, 'member', 'approved', $7),
			 ('t859-m-foreign', $6, $8, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.adminUser,
				ids.managerUser,
				ids.memberUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values
			 (gen_random_uuid(), $1, $5, 'admin', 'OWN-1', $6),
			 (gen_random_uuid(), $2, $5, 'admin', 'ADM-1', $6),
			 (gen_random_uuid(), $3, $5, 'manager', 'MGR-1', $6),
			 (gen_random_uuid(), $4, $5, 'employee', 'MEM-1', $6)`,
			[ids.ownerUser, ids.adminUser, ids.managerUser, ids.memberUser, ids.organization, timestamp],
		);
		await pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values
			 ($1, $4, 'Store', $6, $7),
			 ($2, $4, 'Warehouse', $6, $7),
			 ($3, $5, 'Foreign store', $8, $7)`,
			[
				ids.store,
				ids.warehouse,
				ids.foreignLocation,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				timestamp,
				ids.foreignUser,
			],
		);
	}

	async function createKiosk(
		input: Partial<{ name: string; locationId: string; timezone: string }> = {},
		userId: string = ids.adminUser,
	) {
		actAs(userId);
		return admin.createKioskAction({
			name: input.name ?? "Front door",
			locationId: input.locationId ?? ids.store,
			timezone: input.timezone ?? "Europe/Berlin",
		});
	}

	async function createdKiosk() {
		const result = await createKiosk();
		if (!result.success) throw new Error(`kiosk not created: ${result.code}`);
		return result.data;
	}

	function pair(code: unknown) {
		return pairRoute.POST(
			new Request("http://localhost/api/kiosk/pair", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code }),
			}),
		);
	}

	async function pairedToken(code: string): Promise<string> {
		const response = await pair(code);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { token: string };
		return body.token;
	}

	function session(token?: string) {
		return sessionRoute.GET(
			new Request("http://localhost/api/kiosk/session", {
				headers: token ? { [KIOSK_TOKEN_HEADER]: token } : {},
			}),
		);
	}

	async function adminKiosks(userId: string = ids.adminUser) {
		actAs(userId);
		const result = await admin.getKioskAdminDataAction();
		if (!result.success) throw new Error(`admin data refused: ${result.code}`);
		return result.data.kiosks;
	}

	async function auditActions(kioskId: string): Promise<string[]> {
		const { rows } = await pool.query<{ action: string }>(
			`select action from audit_log where organization_id = $1 and entity_type = 'kiosk' and entity_id = $2
			 order by timestamp, action`,
			[ids.organization, kioskId],
		);
		return rows.map((row) => row.action);
	}

	beforeEach(async () => {
		vi.restoreAllMocks();
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("lets an admin create a kiosk that waits for pairing with its board off", async () => {
		const created = await createdKiosk();

		expect(created.pairingCode).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
		const kiosks = await adminKiosks();
		expect(kiosks).toEqual([
			expect.objectContaining({
				id: created.kioskId,
				name: "Front door",
				locationId: ids.store,
				locationName: "Store",
				timezone: "Europe/Berlin",
				boardEnabled: false,
				status: "awaiting_pairing",
				lastSeenAt: null,
			}),
		]);
	});

	it("pairs a device with the code once and authenticates its requests", async () => {
		const created = await createdKiosk();

		const token = await pairedToken(created.pairingCode);
		const response = await session(token);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			kiosk: {
				id: created.kioskId,
				name: "Front door",
				locationId: ids.store,
				locationName: "Store",
				timezone: "Europe/Berlin",
				boardEnabled: false,
			},
		});
		const resolved = await resolveKioskFromRequest(
			new Request("http://localhost/api/kiosk/anything", {
				headers: { [KIOSK_TOKEN_HEADER]: token },
			}),
		);
		expect(resolved).toEqual({
			ok: true,
			kiosk: {
				kioskId: created.kioskId,
				organizationId: ids.organization,
				locationId: ids.store,
				name: "Front door",
				timezone: "Europe/Berlin",
				boardEnabled: false,
			},
		});

		const second = await pair(created.pairingCode);
		expect(second.status).toBe(401);
		expect(await second.json()).toMatchObject({ code: "invalid_code" });
	});

	it("accepts the code as typed by a person", async () => {
		const created = await createdKiosk();

		const response = await pair(` ${created.pairingCode.toLowerCase().replace("-", " ")} `);

		expect(response.status).toBe(200);
	});

	it("refuses an expired, wrong or malformed code", async () => {
		const created = await createdKiosk();
		await pool.query(
			"update kiosk set pairing_code_expires_at = now() - interval '1 second' where id = $1",
			[created.kioskId],
		);

		const expired = await pair(created.pairingCode);
		const wrong = await pair("ZZZZZ-ZZZZZ");
		const malformed = await pair("hello");

		expect(expired.status).toBe(401);
		expect(wrong.status).toBe(401);
		expect(malformed.status).toBe(400);
		expect((await adminKiosks())[0]).toMatchObject({ status: "awaiting_pairing" });
	});

	it("stores the token and the pairing code only as hashes", async () => {
		const created = await createdKiosk();
		const codeAtRest = created.pairingCode.replace("-", "");
		const before = await pool.query(
			"select row_to_json(kiosk)::text as row from kiosk where id = $1",
			[created.kioskId],
		);
		expect(before.rows[0].row).not.toContain(codeAtRest);

		const token = await pairedToken(created.pairingCode);
		const after = await pool.query(
			"select row_to_json(kiosk)::text as row from kiosk where id = $1",
			[created.kioskId],
		);
		expect(after.rows[0].row).not.toContain(token);
		expect(after.rows[0].row).not.toContain(codeAtRest);
	});

	it("refuses unknown and missing tokens", async () => {
		expect(await resolveKioskFromToken("z8k_not-a-real-token")).toEqual({
			ok: false,
			reason: "unknown",
		});
		expect(await resolveKioskFromToken(null)).toEqual({ ok: false, reason: "unknown" });

		const response = await session();
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "kiosk_unknown" });
	});

	it("refuses a revoked kiosk on its next request", async () => {
		const created = await createdKiosk();
		const token = await pairedToken(created.pairingCode);
		expect((await session(token)).status).toBe(200);

		actAs(ids.ownerUser);
		const revoked = await admin.revokeKioskAction({ kioskId: created.kioskId });

		expect(revoked.success).toBe(true);
		const response = await session(token);
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "kiosk_revoked" });
		expect(await resolveKioskFromToken(token)).toEqual({ ok: false, reason: "revoked" });
		expect((await adminKiosks())[0]).toMatchObject({ status: "revoked" });
		actAs(ids.adminUser);
		expect(await admin.issueKioskPairingCodeAction({ kioskId: created.kioskId })).toMatchObject({
			success: false,
			code: "kiosk_revoked",
		});
	});

	it("rotating the token by pairing again invalidates the old token", async () => {
		const created = await createdKiosk();
		const oldToken = await pairedToken(created.pairingCode);

		actAs(ids.adminUser);
		const rotated = await admin.issueKioskPairingCodeAction({ kioskId: created.kioskId });
		if (!rotated.success) throw new Error(rotated.code);

		expect(await resolveKioskFromToken(oldToken)).toEqual({ ok: false, reason: "unknown" });
		expect((await adminKiosks())[0]).toMatchObject({ status: "awaiting_pairing" });
		const newToken = await pairedToken(rotated.data.pairingCode);
		expect(newToken).not.toBe(oldToken);
		expect((await session(newToken)).status).toBe(200);
		expect((await session(oldToken)).status).toBe(401);
	});

	it("records when the kiosk was last seen", async () => {
		const created = await createdKiosk();
		const token = await pairedToken(created.pairingCode);
		await pool.query("update kiosk set last_seen_at = null where id = $1", [created.kioskId]);

		await session(token);

		const [listed] = await adminKiosks();
		expect(listed.status).toBe("paired");
		expect(listed.lastSeenAt).toEqual(expect.any(String));
		expect(Date.now() - Date.parse(listed.lastSeenAt ?? "")).toBeLessThan(60_000);
	});

	it("never creates a kiosk on, or moves one to, another organization's location", async () => {
		const foreign = await createKiosk({ locationId: ids.foreignLocation });
		expect(foreign).toMatchObject({ success: false, code: "location_not_found" });

		const created = await createdKiosk();
		actAs(ids.adminUser);
		const moved = await admin.updateKioskAction({
			kioskId: created.kioskId,
			locationId: ids.foreignLocation,
		});
		expect(moved).toMatchObject({ success: false, code: "location_not_found" });
		expect((await adminKiosks())[0]).toMatchObject({ locationId: ids.store });
	});

	it("never lets an admin of another organization manage the kiosk", async () => {
		const created = await createdKiosk();

		actAs(ids.foreignUser, ids.otherOrganization);
		const result = await admin.revokeKioskAction({ kioskId: created.kioskId });

		expect(result).toMatchObject({ success: false, code: "kiosk_not_found" });
		expect((await adminKiosks())[0]).toMatchObject({ status: "awaiting_pairing" });
	});

	it("lets admins rename a kiosk, move it, change its zone and switch its board", async () => {
		const created = await createdKiosk();
		const token = await pairedToken(created.pairingCode);

		actAs(ids.ownerUser);
		const updated = await admin.updateKioskAction({
			kioskId: created.kioskId,
			name: "Warehouse gate",
			locationId: ids.warehouse,
			timezone: "Europe/Vienna",
			boardEnabled: true,
		});

		expect(updated.success).toBe(true);
		expect(await resolveKioskFromToken(token)).toMatchObject({
			ok: true,
			kiosk: {
				name: "Warehouse gate",
				locationId: ids.warehouse,
				timezone: "Europe/Vienna",
				boardEnabled: true,
			},
		});
	});

	it("refuses an unknown zone and an empty name", async () => {
		expect(await createKiosk({ timezone: "Mars/Olympus" })).toMatchObject({
			success: false,
			code: "invalid_timezone",
		});
		expect(await createKiosk({ timezone: "+02:00" })).toMatchObject({
			success: false,
			code: "invalid_timezone",
		});
		expect(await createKiosk({ name: "   " })).toMatchObject({
			success: false,
			code: "invalid_name",
		});
	});

	it("does not let managers or members see or manage kiosks", async () => {
		const created = await createdKiosk();

		for (const userId of [ids.managerUser, ids.memberUser]) {
			actAs(userId);
			expect(await admin.getKioskAdminDataAction()).toMatchObject({
				success: false,
				code: "admin_only",
			});
			expect(await createKiosk({}, userId)).toMatchObject({ success: false, code: "admin_only" });
			actAs(userId);
			expect(await admin.revokeKioskAction({ kioskId: created.kioskId })).toMatchObject({
				success: false,
				code: "admin_only",
			});
		}
	});

	it("audits creating, pairing, configuring, rotating and revoking", async () => {
		const created = await createdKiosk();
		await pairedToken(created.pairingCode);
		actAs(ids.adminUser);
		await admin.updateKioskAction({ kioskId: created.kioskId, boardEnabled: true });
		await admin.issueKioskPairingCodeAction({ kioskId: created.kioskId });
		await admin.issueKioskPairingCodeAction({ kioskId: created.kioskId });
		await admin.revokeKioskAction({ kioskId: created.kioskId });

		expect((await auditActions(created.kioskId)).sort()).toEqual(
			[
				"kiosk.created",
				"kiosk.paired",
				"kiosk.updated",
				"kiosk.token_rotated",
				"kiosk.pairing_code_issued",
				"kiosk.revoked",
			].sort(),
		);
	});
});
