/**
 * #1508 (spec #1358, ADR 0014): viewing and removing kiosk fobs on PostgreSQL,
 * through the employee page's and the security page's server actions. Who may
 * see and remove an employee's fob (the people who manage their kiosk PIN), a
 * signed-in employee's own fob, the organization boundary, and what a removal
 * does: the link ends as removed, kiosks stop recognising the fob, anyone may
 * register it again, and the kiosk PIN and kiosk badge stay as they were.
 * Which fob is active is observed through `resolveActiveKioskFob`, the lookup
 * kiosks use; fobs are registered through `registerKioskFob`, as at a kiosk.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

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

const { getEmployeeKioskStateAction, removeEmployeeKioskFobAction } = await import(
	"@/app/[locale]/(app)/settings/employees/kiosk-actions"
);
const { getOwnKioskFobStatusAction, removeOwnKioskFobAction } = await import(
	"@/app/[locale]/(app)/settings/security/kiosk-fob-actions"
);
const { registerKioskFob, resolveActiveKioskFob } = await import("./fob-store");
const { issueKioskBadge, readKioskBadgeStatus } = await import("./badge-store");
const { issueKioskPin, verifyEmployeeKioskPin } = await import("./pin-store");

const ids = {
	organization: "t1508-fob-org",
	otherOrganization: "t1508-fob-other-org",
	ownerUser: "t1508-fob-owner-user",
	adminUser: "t1508-fob-admin-user",
	managerUser: "t1508-fob-manager-user",
	otherManagerUser: "t1508-fob-other-manager-user",
	workerUser: "t1508-fob-worker-user",
	coworkerUser: "t1508-fob-coworker-user",
	kioskOnlyUser: "t1508-fob-kiosk-only-user",
	foreignUser: "t1508-fob-foreign-user",
	owner: "e1508000-0000-4000-8000-000000000001",
	admin: "e1508000-0000-4000-8000-000000000002",
	manager: "e1508000-0000-4000-8000-000000000003",
	otherManager: "e1508000-0000-4000-8000-000000000004",
	worker: "e1508000-0000-4000-8000-000000000005",
	coworker: "e1508000-0000-4000-8000-000000000006",
	kioskOnly: "e1508000-0000-4000-8000-000000000007",
	foreign: "e1508000-0000-4000-8000-000000000008",
	store: "e1508000-0000-4000-8000-000000000011",
	foreignStore: "e1508000-0000-4000-8000-000000000012",
	kiosk: "e1508000-0000-4000-8000-000000000021",
	foreignKiosk: "e1508000-0000-4000-8000-000000000022",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.otherManagerUser,
	ids.workerUser,
	ids.coworkerUser,
	ids.kioskOnlyUser,
	ids.foreignUser,
];
const org = ids.organization;
const SERIAL = "04A1B2C3D4E5F6";
const OTHER_SERIAL = "1A2B3C4D";
/** A fob id that names no fob. */
const UNSEEN_FOB = "e1508000-0000-4000-8000-0000000000ff";

function signIn(userId: string, organizationId: string = org) {
	session.current = { userId, organizationId };
}

function codeOf(result: { success: boolean; code?: string }) {
	return result.success ? "success" : result.code;
}

async function register(
	employeeId: string,
	serial: string = SERIAL,
	organizationId: string = org,
	kioskId: string = ids.kiosk,
) {
	return registerKioskFob(db, { organizationId, kioskId, employeeId, serial });
}

async function fobHolder(serial: string = SERIAL, organizationId: string = org) {
	const fob = await resolveActiveKioskFob(db, {
		organizationId,
		serial,
		now: systemClock.nowInstant(),
	});
	return fob?.employeeId ?? null;
}

/** The active fob the signed-in manager's employee page shows (what removal names). */
async function shownFobId(employeeId: string): Promise<string> {
	const state = await getEmployeeKioskStateAction(employeeId);
	const id = state.success ? state.data?.fob?.active?.fobId : null;
	if (!id) throw new Error("Expected an active fob on the employee page");
	return id;
}

describe("kiosk fob management on PostgreSQL", () => {
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
			 ($1, 'T1508 fobs', $1, 'Europe/Berlin', $3), ($2, 'T1508 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, email, $3, $3
			 from unnest($1::text[], $2::text[]) as seeded(user_id, email)`,
			[
				users,
				users.map((id) =>
					id === ids.kioskOnlyUser ? `${id}@kiosk.invalid` : `${id}@example.test`,
				),
				timestamp,
			],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1508-m-owner', $1, $2, 'owner', 'approved', $3),
			 ('t1508-m-admin', $1, $4, 'admin', 'approved', $3),
			 ('t1508-m-manager', $1, $5, 'member', 'approved', $3),
			 ('t1508-m-other-manager', $1, $6, 'member', 'approved', $3),
			 ('t1508-m-worker', $1, $7, 'member', 'approved', $3),
			 ('t1508-m-coworker', $1, $8, 'member', 'approved', $3),
			 ('t1508-m-kiosk-only', $1, $9, 'member', 'approved', $3),
			 ('t1508-m-foreign', $10, $11, 'owner', 'approved', $3)`,
			[
				org,
				ids.ownerUser,
				timestamp,
				ids.adminUser,
				ids.managerUser,
				ids.otherManagerUser,
				ids.workerUser,
				ids.coworkerUser,
				ids.kioskOnlyUser,
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
			 ($13, $14, $17, 'employee', true, now()),
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
				ids.coworker,
				ids.coworkerUser,
				ids.kioskOnly,
				ids.kioskOnlyUser,
				ids.foreign,
				ids.foreignUser,
				org,
				ids.otherOrganization,
			],
		);
		await pool.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance)
			 select organization_id, id, 'open', $2, 'recorded' from employee where id = any($1::uuid[])`,
			[[ids.worker, ids.coworker, ids.kioskOnly, ids.foreign], timestamp],
		);
		await pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by) values
			 ($1, $3, true, $4), ($2, $3, true, $4)`,
			[ids.worker, ids.kioskOnly, ids.manager, ids.ownerUser],
		);
		await pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'Store', $5, $6), ($2, $4, 'Foreign store', $7, $6)`,
			[
				ids.store,
				ids.foreignStore,
				org,
				ids.otherOrganization,
				ids.ownerUser,
				timestamp,
				ids.foreignUser,
			],
		);
		await pool.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, token_hash, paired_at,
			                    nfc_fob_reader_enabled, created_by, updated_at) values
			 ($1, $3, $4, 'Store kiosk', 'Europe/Berlin', 't1508-store-token-hash', $7, true, $8, $7),
			 ($2, $5, $6, 'Foreign kiosk', 'UTC', 't1508-foreign-token-hash', $7, true, $9, $7)`,
			[
				ids.kiosk,
				ids.foreignKiosk,
				org,
				ids.store,
				ids.otherOrganization,
				ids.foreignStore,
				timestamp,
				ids.ownerUser,
				ids.foreignUser,
			],
		);
	});

	afterAll(cleanup);

	it("shows owners, admins and the direct manager the fob's registration date, last 4 hex digits and kiosk, never the serial", async () => {
		const registration = await register(ids.worker);

		for (const actor of [ids.ownerUser, ids.adminUser, ids.managerUser]) {
			signIn(actor);
			const state = await getEmployeeKioskStateAction(ids.worker);
			expect(state).toEqual({
				success: true,
				data: expect.objectContaining({
					fob: {
						active: {
							fobId: registration.fobId,
							registeredAt: expect.any(String),
							lastFour: "E5F6",
							kioskName: "Store kiosk",
						},
						lastEnded: null,
						fobReaderInUse: true,
						timezone: "Europe/Berlin",
					},
				}),
			});
			expect(JSON.stringify(state)).not.toContain(SERIAL);
		}

		// Without a fob the section says so.
		signIn(ids.managerUser);
		expect(await getEmployeeKioskStateAction(ids.kioskOnly)).toMatchObject({
			data: { fob: { active: null, lastEnded: null } },
		});
	});

	it("lets owners, admins and the direct manager remove a fob, and nobody else", async () => {
		await register(ids.worker);
		signIn(ids.ownerUser);
		const shown = await shownFobId(ids.worker);

		for (const actor of [ids.otherManagerUser, ids.workerUser, ids.kioskOnlyUser]) {
			signIn(actor);
			expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, shown))).toBe("not_allowed");
			expect(await getEmployeeKioskStateAction(ids.worker)).toEqual({ success: true, data: null });
		}

		// A foreign owner reaches neither through their own organization nor through ours.
		signIn(ids.foreignUser, ids.otherOrganization);
		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, shown))).toBe(
			"employee_not_found",
		);
		signIn(ids.foreignUser, org);
		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, shown))).toBe("not_allowed");
		session.current = null;
		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, shown))).toBe("sign_in_required");
		expect(await fobHolder()).toBe(ids.worker);

		for (const actor of [ids.managerUser, ids.adminUser, ids.ownerUser]) {
			await register(ids.worker);
			signIn(actor);
			expect(await removeEmployeeKioskFobAction(ids.worker, await shownFobId(ids.worker))).toEqual({
				success: true,
				data: { removed: true },
			});
			expect(await fobHolder()).toBeNull();
		}
	});

	it("ends the link as removed: kiosks no longer recognise the fob, anyone can register it again, PIN and badge unchanged", async () => {
		const { pin } = await issueKioskPin(db, {
			organizationId: org,
			actorUserId: ids.ownerUser,
			employeeId: ids.worker,
		});
		const badgeInput = { organizationId: org, actorUserId: ids.ownerUser, employeeId: ids.worker };
		const badge = await issueKioskBadge(db, badgeInput, async () => null);
		await register(ids.worker);

		signIn(ids.adminUser);
		const shown = await shownFobId(ids.worker);
		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, shown))).toBe("success");

		expect(await fobHolder()).toBeNull();
		const stored = await pool.query(
			`select ended_reason, ended_by_user_id, ended_at is not null as ended
			 from employee_kiosk_fob where id = $1`,
			[shown],
		);
		expect(stored.rows).toEqual([
			{ ended_reason: "removed", ended_by_user_id: ids.adminUser, ended: true },
		]);
		const audit = await pool.query(
			`select performed_by, employee_id, entity_id, metadata from audit_log
			 where organization_id = $1 and action = 'kiosk_fob.ended'`,
			[org],
		);
		expect(audit.rows).toEqual([
			{
				performed_by: ids.adminUser,
				employee_id: ids.worker,
				entity_id: shown,
				metadata: JSON.stringify({ reason: "removed" }),
			},
		]);
		expect(JSON.stringify(audit.rows)).not.toContain(SERIAL);
		expect(await getEmployeeKioskStateAction(ids.worker)).toMatchObject({
			data: {
				hasPin: true,
				badge: { activeBadgeId: badge.badgeId },
				fob: {
					active: null,
					lastEnded: { at: expect.any(String), reason: "removed", departureLastWorkingDay: null },
				},
			},
		});
		await expect(
			verifyEmployeeKioskPin(db, { organizationId: org, employeeId: ids.worker, pin }),
		).resolves.toEqual({ status: "verified" });
		expect((await readKioskBadgeStatus(db, badgeInput)).active?.badgeId).toBe(badge.badgeId);

		// The freed serial number can be registered again, by anyone.
		expect((await register(ids.coworker)).outcome).toBe("registered");
		expect(await fobHolder()).toBe(ids.coworker);
	});

	it("refuses to remove a fob other than the one the person saw", async () => {
		await register(ids.worker);
		signIn(ids.ownerUser);
		const seen = await shownFobId(ids.worker);
		// The employee registered another fob meanwhile.
		await register(ids.worker, OTHER_SERIAL);

		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, seen))).toBe("fob_changed");
		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, "not-a-fob"))).toBe("fob_changed");
		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, ""))).toBe("fob_changed");
		expect(await fobHolder(OTHER_SERIAL)).toBe(ids.worker);
		expect(codeOf(await removeEmployeeKioskFobAction(ids.kioskOnly, UNSEEN_FOB))).toBe("no_fob");
		expect(codeOf(await removeEmployeeKioskFobAction(ids.kioskOnly, ""))).toBe("no_fob");
		// Another employee's fob is not this employee's to remove.
		expect(codeOf(await removeEmployeeKioskFobAction(ids.kioskOnly, seen))).toBe("no_fob");

		const reloaded = await shownFobId(ids.worker);
		expect(reloaded).not.toBe(seen);
		expect(codeOf(await removeEmployeeKioskFobAction(ids.worker, reloaded))).toBe("success");
		expect(await fobHolder(OTHER_SERIAL)).toBeNull();
	});

	it("shows a fob ended by a departure that is due but not processed yet, as kiosks already refuse it", async () => {
		await register(ids.worker);
		await pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by,
			  request_id, request_fingerprint, revision, status)
			 select organization_id, employee_id, id, 'immediate', 'Europe/Berlin', now(), $2,
			        gen_random_uuid(), 'test', 1, 'pending'
			 from employee_employment_period where employee_id = $1 and status = 'open'`,
			[ids.worker, ids.ownerUser],
		);

		signIn(ids.managerUser);
		expect(await fobHolder()).toBeNull();
		expect(await getEmployeeKioskStateAction(ids.worker)).toMatchObject({
			data: {
				fob: {
					active: null,
					lastEnded: {
						at: expect.any(String),
						reason: "departure",
						departureLastWorkingDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
					},
				},
			},
		});
	});

	describe("the signed-in employee's own fob", () => {
		it("shows only their own fob, never the serial", async () => {
			const own = await register(ids.worker);
			await register(ids.coworker, OTHER_SERIAL);

			signIn(ids.workerUser);
			const status = await getOwnKioskFobStatusAction();
			expect(status).toEqual({
				success: true,
				data: {
					fobReaderInUse: true,
					fob: {
						fobId: own.fobId,
						registeredAt: expect.any(String),
						lastFour: "E5F6",
						kioskName: "Store kiosk",
					},
					timezone: "Europe/Berlin",
				},
			});
			expect(JSON.stringify(status)).not.toContain(SERIAL);

			signIn(ids.managerUser);
			expect(await getOwnKioskFobStatusAction()).toEqual({
				success: true,
				data: { fobReaderInUse: true, fob: null, timezone: "Europe/Berlin" },
			});
		});

		it("lets them remove their own fob and nobody else's", async () => {
			const { pin } = await issueKioskPin(db, {
				organizationId: org,
				actorUserId: ids.ownerUser,
				employeeId: ids.worker,
			});
			const own = await register(ids.worker);
			const coworkers = await register(ids.coworker, OTHER_SERIAL);

			signIn(ids.workerUser);
			expect(codeOf(await removeOwnKioskFobAction(coworkers.fobId))).toBe("fob_changed");
			expect(codeOf(await removeOwnKioskFobAction(""))).toBe("fob_changed");
			expect(await fobHolder(OTHER_SERIAL)).toBe(ids.coworker);

			expect(await removeOwnKioskFobAction(own.fobId)).toEqual({
				success: true,
				data: { removed: true },
			});
			expect(await fobHolder()).toBeNull();
			expect(await fobHolder(OTHER_SERIAL)).toBe(ids.coworker);
			expect(codeOf(await removeOwnKioskFobAction(own.fobId))).toBe("fob_changed");
			expect(codeOf(await removeOwnKioskFobAction(UNSEEN_FOB))).toBe("no_fob");

			const stored = await pool.query(
				"select ended_reason, ended_by_user_id from employee_kiosk_fob where id = $1",
				[own.fobId],
			);
			expect(stored.rows).toEqual([{ ended_reason: "removed", ended_by_user_id: ids.workerUser }]);
			const audit = await pool.query(
				`select performed_by, employee_id from audit_log
				 where organization_id = $1 and action = 'kiosk_fob.ended'`,
				[org],
			);
			expect(audit.rows).toEqual([{ performed_by: ids.workerUser, employee_id: ids.worker }]);
			await expect(
				verifyEmployeeKioskPin(db, { organizationId: org, employeeId: ids.worker, pin }),
			).resolves.toEqual({ status: "verified" });
			expect((await register(ids.worker)).outcome).toBe("registered");
		});

		it("is nothing for a user without an employee profile here or without organization access", async () => {
			await register(ids.worker);
			const foreign = await register(ids.foreign, SERIAL, ids.otherOrganization, ids.foreignKiosk);

			// The foreign owner signed into our organization has no employee profile here.
			signIn(ids.foreignUser, org);
			expect(await getOwnKioskFobStatusAction()).toEqual({ success: true, data: null });
			expect(codeOf(await removeOwnKioskFobAction(foreign.fobId))).toBe("employee_not_found");
			expect(await fobHolder(SERIAL, ids.otherOrganization)).toBe(ids.foreign);
			expect(await fobHolder()).toBe(ids.worker);

			await pool.query("update employee set is_active = false where id = $1", [ids.worker]);
			signIn(ids.workerUser);
			expect(await getOwnKioskFobStatusAction()).toEqual({ success: true, data: null });
			session.current = null;
			expect(codeOf(await removeOwnKioskFobAction(UNSEEN_FOB))).toBe("sign_in_required");
		});

		it("says whether any kiosk of the organization reads fobs", async () => {
			signIn(ids.workerUser);
			expect(await getOwnKioskFobStatusAction()).toMatchObject({ data: { fobReaderInUse: true } });
			await pool.query("update kiosk set nfc_fob_reader_enabled = false where id = $1", [
				ids.kiosk,
			]);
			expect(await getOwnKioskFobStatusAction()).toMatchObject({
				data: { fobReaderInUse: false, fob: null },
			});
			// A revoked kiosk does not count, even with its switch on.
			await pool.query(
				"update kiosk set nfc_fob_reader_enabled = true, revoked_at = now() where id = $1",
				[ids.kiosk],
			);
			expect(await getOwnKioskFobStatusAction()).toMatchObject({ data: { fobReaderInUse: false } });
		});
	});

	it("tells the employee page whether any kiosk of the organization reads fobs", async () => {
		signIn(ids.ownerUser);
		expect(await getEmployeeKioskStateAction(ids.worker)).toMatchObject({
			data: { fob: { active: null, lastEnded: null, fobReaderInUse: true } },
		});
		await pool.query("update kiosk set nfc_fob_reader_enabled = false where id = $1", [ids.kiosk]);
		expect(await getEmployeeKioskStateAction(ids.worker)).toMatchObject({
			data: { fob: { fobReaderInUse: false } },
		});
	});

	it("keeps each organization's fobs apart: the same serial number elsewhere is untouched by a removal here", async () => {
		await register(ids.worker);
		await register(ids.foreign, SERIAL, ids.otherOrganization, ids.foreignKiosk);

		signIn(ids.ownerUser);
		expect(
			codeOf(await removeEmployeeKioskFobAction(ids.worker, await shownFobId(ids.worker))),
		).toBe("success");
		expect(await fobHolder()).toBeNull();
		expect(await fobHolder(SERIAL, ids.otherOrganization)).toBe(ids.foreign);
		// Nor can our owner reach the other organization's employee.
		expect(codeOf(await removeEmployeeKioskFobAction(ids.foreign, UNSEEN_FOB))).toBe(
			"employee_not_found",
		);
	});
});
