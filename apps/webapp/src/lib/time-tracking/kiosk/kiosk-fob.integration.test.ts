/**
 * #1505 (spec #1358, ADR 0014): kiosk fobs on PostgreSQL, through the kiosk
 * fob endpoints' service. The per-kiosk NFC fob reader switch, the shared
 * serial number normalizer, self-registration with the kiosk PIN (and its
 * lockout), replacement, uniqueness within an organization and organization
 * scoping. A fob selects; the PIN proves.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Real kiosk authentication, PIN verification and lockout, fob store and kiosk
 * settings. Only the rate limiters and the Next request/cache boundaries are
 * replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const { setOwnKioskPin, verifyEmployeeKioskPin } = await import(
	"@/lib/time-tracking/kiosk/pin-store"
);
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskFobService } = await import("./fob-service");
const { withAuditTrail } = await import("@/lib/audit-trail");
const { createKiosk, readKioskDeviceInfo, updateKiosk } = await import("./kiosk-store");
type KioskFobRegistration = import("./fob-store").KioskFobRegistration;

const ids = {
	organization: "t1505-kiosk-org",
	otherOrganization: "t1505-kiosk-other-org",
	workerUser: "t1505-worker-user",
	coworkerUser: "t1505-coworker-user",
	strangerUser: "t1505-stranger-user",
	leaverUser: "t1505-leaver-user",
	managerUser: "t1505-manager-user",
	foreignUser: "t1505-foreign-user",
	worker: "f1505000-0000-4000-8000-000000000001",
	coworker: "f1505000-0000-4000-8000-000000000002",
	stranger: "f1505000-0000-4000-8000-000000000003",
	leaver: "f1505000-0000-4000-8000-000000000004",
	manager: "f1505000-0000-4000-8000-000000000005",
	foreign: "f1505000-0000-4000-8000-000000000006",
	store: "f1505000-0000-4000-8000-000000000011",
	warehouse: "f1505000-0000-4000-8000-000000000012",
	foreignStore: "f1505000-0000-4000-8000-000000000013",
	kiosk: "f1505000-0000-4000-8000-000000000021",
	switchedOffKiosk: "f1505000-0000-4000-8000-000000000022",
	foreignKiosk: "f1505000-0000-4000-8000-000000000023",
} as const;
const users = [
	ids.workerUser,
	ids.coworkerUser,
	ids.strangerUser,
	ids.leaverUser,
	ids.managerUser,
	ids.foreignUser,
];
const tokens = {
	kiosk: "z8k_t1505-store-kiosk-token",
	switchedOff: "z8k_t1505-switched-off-kiosk-token",
	foreign: "z8k_t1505-foreign-kiosk-token",
} as const;
const PIN = "4711";
const SERIAL = "04A1B2C3D4E5F6";
const OTHER_SERIAL = "1A2B3C4D";
const NOT_RECOGNISED = { status: 200, body: { outcome: "not_recognised" } };

describe("kiosk fobs on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant("2026-11-02T08:00:00Z");
	const clockPort = { nowInstant: () => now };
	let pinAttempts: string[] = [];
	let lookups: string[] = [];
	let registered: KioskFobRegistration[] = [];

	function newService(options: { lookupLimit?: { allowed: boolean; retryAfter: number } } = {}) {
		return createKioskFobService({
			clock: clockPort,
			limitPinAttempts: async (kioskId) => {
				pinAttempts.push(kioskId);
				return { allowed: true, retryAfter: 0 };
			},
			limitFobLookups: async (kioskId) => {
				lookups.push(kioskId);
				return options.lookupLimit ?? { allowed: true, retryAfter: 0 };
			},
			onRegistered: async (registration) => {
				registered.push(registration);
			},
		});
	}

	function kioskRequest(path: string, body: unknown, token: string = tokens.kiosk) {
		return new Request(`http://localhost/api/kiosk/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", [KIOSK_TOKEN_HEADER]: token },
			body: JSON.stringify(body),
		});
	}

	async function answer(response: Response) {
		return { status: response.status, body: await response.json() };
	}

	async function lookUp(serial: unknown, token?: string) {
		return answer(await newService().lookup(kioskRequest("fob", { serial }, token)));
	}

	async function register(
		serial: unknown,
		employeeId: string,
		options: { pin?: string; token?: string } = {},
	) {
		return answer(
			await newService().register(
				kioskRequest(
					"fob/registration",
					{ serial, employeeId, pin: options.pin ?? PIN },
					options.token,
				),
			),
		);
	}

	async function fobs(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			employee_id: string;
			serial_number: string;
			registered_kiosk_id: string | null;
			ended_reason: string | null;
			ended: boolean;
		}>(
			`select employee_id, serial_number, registered_kiosk_id, ended_reason, ended_at is not null as ended
			 from employee_kiosk_fob where organization_id = $1 order by registered_at, ended_at nulls last`,
			[organizationId],
		);
		return rows;
	}

	async function pinFailures(employeeId: string) {
		const { rows } = await admin.query<{ count: number }>(
			`select count(*)::int as count from employee_kiosk_pin_event
			 where employee_id = $1 and kind = 'failure'`,
			[employeeId],
		);
		return rows[0]?.count ?? 0;
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-10-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T1505 kiosk', $1, 'Europe/Berlin', $3), ($2, 'T1505 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Wanda Worker', 't1505-worker@example.test', $7, $7),
			 ($2, 'Cora Coworker', 't1505-coworker@example.test', $7, $7),
			 ($3, 'Sam Stranger', 't1505-stranger@example.test', $7, $7),
			 ($4, 'Lee Leaver', 't1505-leaver@example.test', $7, $7),
			 ($5, 'Mona Manager', 't1505-manager@example.test', $7, $7),
			 ($6, 'Fay Foreign', 't1505-foreign@example.test', $7, $7)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1505-m-worker', $1, $3, 'member', 'approved', $9),
			 ('t1505-m-coworker', $1, $4, 'member', 'approved', $9),
			 ('t1505-m-stranger', $1, $5, 'member', 'approved', $9),
			 ('t1505-m-leaver', $1, $6, 'member', 'approved', $9),
			 ('t1505-m-manager', $1, $7, 'admin', 'approved', $9),
			 ('t1505-m-foreign', $2, $8, 'owner', 'approved', $9)`,
			[ids.organization, ids.otherOrganization, ...users, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $13, 'employee', true, $15),
			 ($3, $4, $13, 'employee', true, $15),
			 ($5, $6, $13, 'employee', true, $15),
			 ($7, $8, $13, 'employee', true, $15),
			 ($9, $10, $13, 'admin', true, $15),
			 ($11, $12, $14, 'admin', true, $15)`,
			[
				ids.worker,
				ids.workerUser,
				ids.coworker,
				ids.coworkerUser,
				ids.stranger,
				ids.strangerUser,
				ids.leaver,
				ids.leaverUser,
				ids.manager,
				ids.managerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance)
			 select organization_id, id, 'open', $2, 'recorded' from employee where id = any($1::uuid[])`,
			[[ids.worker, ids.coworker, ids.stranger, ids.leaver, ids.foreign], timestamp],
		);
		await admin.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values
			 ($1, $4, 'Store', $6, $7),
			 ($2, $4, 'Warehouse', $6, $7),
			 ($3, $5, 'Foreign store', $8, $7)`,
			[
				ids.store,
				ids.warehouse,
				ids.foreignStore,
				ids.organization,
				ids.otherOrganization,
				ids.managerUser,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, token_hash, paired_at,
			                    nfc_fob_reader_enabled, created_by, updated_at) values
			 ($1, $4, $5, 'Store kiosk', 'Europe/Berlin', $8, $11, true, $12, $11),
			 ($2, $4, $5, 'Switched-off kiosk', 'Europe/Berlin', $9, $11, false, $12, $11),
			 ($3, $6, $7, 'Foreign kiosk', 'UTC', $10, $11, true, $13, $11)`,
			[
				ids.kiosk,
				ids.switchedOffKiosk,
				ids.foreignKiosk,
				ids.organization,
				ids.store,
				ids.otherOrganization,
				ids.foreignStore,
				hashKioskSecret(tokens.kiosk),
				hashKioskSecret(tokens.switchedOff),
				hashKioskSecret(tokens.foreign),
				timestamp,
				ids.managerUser,
				ids.foreignUser,
			],
		);
		// Worker, coworker and leaver work at the store; the stranger only at the warehouse.
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id) values
			 ($1, $2, $6), ($1, $3, $6), ($1, $5, $6), ($1, $4, $7)`,
			[
				ids.organization,
				ids.worker,
				ids.coworker,
				ids.stranger,
				ids.leaver,
				ids.store,
				ids.warehouse,
			],
		);
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id)
			 values ($1, $2, $3)`,
			[ids.otherOrganization, ids.foreign, ids.foreignStore],
		);
		for (const [organizationId, userId] of [
			[ids.organization, ids.workerUser],
			[ids.organization, ids.coworkerUser],
			[ids.organization, ids.strangerUser],
			[ids.organization, ids.leaverUser],
			[ids.otherOrganization, ids.foreignUser],
		] as const) {
			await setOwnKioskPin(db, { organizationId, userId, pin: PIN });
		}
	}

	/** A departure of the leaver whose cutoff has passed, not yet processed by the worker. */
	async function dueDeparture(cutoff: Date) {
		await admin.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by,
			  request_id, request_fingerprint, revision, status)
			 select organization_id, employee_id, id, 'immediate', 'UTC', $2, $3,
			        gen_random_uuid(), 'test', 1, 'pending'
			 from employee_employment_period where employee_id = $1 and status = 'open'`,
			[ids.leaver, cutoff, ids.managerUser],
		);
	}

	beforeEach(async () => {
		now = parseInstant("2026-11-02T08:00:00Z");
		pinAttempts = [];
		lookups = [];
		registered = [];
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("the NFC fob reader switch", () => {
		it("is off for a new kiosk, can be switched on and off by itself, and reaches the device", async () => {
			const created = await withAuditTrail((audit) =>
				db.transaction((tx) =>
					createKiosk(
						tx,
						audit,
						{
							organizationId: ids.organization,
							actorUserId: ids.managerUser,
							name: "New kiosk",
							locationId: ids.store,
							timezone: "Europe/Berlin",
						},
						clockPort,
					),
				),
			);
			const paired = {
				kioskId: created.kioskId,
				organizationId: ids.organization,
				locationId: ids.store,
				name: "New kiosk",
				timezone: "Europe/Berlin",
				boardEnabled: false,
			};
			expect(await readKioskDeviceInfo(db, paired)).toMatchObject({
				nfcFobReaderEnabled: false,
				badgeScannerEnabled: false,
				badgeCameraEnabled: false,
			});

			const change = (nfcFobReaderEnabled: boolean) =>
				withAuditTrail((audit) =>
					db.transaction((tx) =>
						updateKiosk(
							tx,
							audit,
							{
								organizationId: ids.organization,
								actorUserId: ids.managerUser,
								kioskId: created.kioskId,
								change: { nfcFobReaderEnabled },
							},
							clockPort,
						),
					),
				);
			await change(true);
			expect(await readKioskDeviceInfo(db, paired)).toMatchObject({
				nfcFobReaderEnabled: true,
				badgeScannerEnabled: false,
				badgeCameraEnabled: false,
			});
			const { rows: audits } = await admin.query<{ changes: string }>(
				`select changes from audit_log where entity_id = $1 and action = 'kiosk.updated'`,
				[created.kioskId],
			);
			expect(audits.map((row) => JSON.parse(row.changes))).toEqual([
				{ from: { nfcFobReaderEnabled: false }, to: { nfcFobReaderEnabled: true } },
			]);
			await change(false);
			expect(await readKioskDeviceInfo(db, paired)).toMatchObject({ nfcFobReaderEnabled: false });
		});

		it("refuses lookups and registrations at a kiosk with the switch off, before any PIN attempt", async () => {
			expect(await lookUp(SERIAL, tokens.switchedOff)).toEqual({
				status: 403,
				body: { code: "fob_reader_disabled" },
			});
			expect(await register(SERIAL, ids.worker, { token: tokens.switchedOff })).toEqual({
				status: 403,
				body: { code: "fob_reader_disabled" },
			});
			expect(
				await register(SERIAL, ids.worker, { pin: "0000", token: tokens.switchedOff }),
			).toEqual({ status: 403, body: { code: "fob_reader_disabled" } });
			expect(pinAttempts).toEqual([]);
			expect(lookups).toEqual([]);
			expect(await pinFailures(ids.worker)).toBe(0);
			expect(await fobs()).toEqual([]);
		});

		it("refuses an unknown kiosk token", async () => {
			expect((await lookUp(SERIAL, "z8k_t1505-nobody")).status).toBe(401);
			expect((await register(SERIAL, ids.worker, { token: "z8k_t1505-nobody" })).status).toBe(401);
		});
	});

	describe("registration", () => {
		it("links an unknown fob to the employee after their kiosk PIN, after which it selects them", async () => {
			expect(await lookUp(SERIAL)).toEqual(NOT_RECOGNISED);

			expect(await register(SERIAL, ids.worker)).toEqual({
				status: 200,
				body: {
					outcome: "registered",
					employee: { id: ids.worker, name: "Wanda Worker" },
					lastFour: "E5F6",
					replaced: false,
				},
			});
			expect(await fobs()).toEqual([
				{
					employee_id: ids.worker,
					serial_number: SERIAL,
					registered_kiosk_id: ids.kiosk,
					ended_reason: null,
					ended: false,
				},
			]);
			expect(await lookUp(SERIAL)).toEqual({
				status: 200,
				body: { outcome: "employee", employee: { id: ids.worker, name: "Wanda Worker" } },
			});
			// The registration counted as a PIN attempt; the lookups only as lookups.
			expect(pinAttempts).toEqual([ids.kiosk]);
			expect(lookups).toEqual([ids.kiosk, ids.kiosk]);
			expect(registered).toEqual([
				expect.objectContaining({
					outcome: "registered",
					organizationId: ids.organization,
					employeeId: ids.worker,
					userId: ids.workerUser,
					kiosk: { id: ids.kiosk, name: "Store kiosk" },
					lastFour: "E5F6",
					replacedFobId: null,
				}),
			]);
			const { rows: audits } = await admin.query<{ action: string; metadata: string }>(
				`select action, metadata from audit_log where organization_id = $1 and entity_type = 'kiosk_fob'`,
				[ids.organization],
			);
			expect(audits.map((row) => row.action)).toEqual(["kiosk_fob.registered"]);
			// Never the serial number in the audit trail.
			expect(JSON.stringify(audits)).not.toContain(SERIAL);
		});

		it("reads the serial number as the shared normalizer does: any case, separators, no byte swap", async () => {
			expect((await register(" 04:a1:b2:c3:d4:e5:f6\n", ids.worker)).body).toMatchObject({
				outcome: "registered",
				lastFour: "E5F6",
			});
			expect((await fobs()).map((fob) => fob.serial_number)).toEqual([SERIAL]);
			expect((await lookUp("04-A1-B2-C3-D4-E5-F6")).body.outcome).toBe("employee");
			// The same bytes in reverse order are another chip.
			expect(await lookUp("F6E5D4C3B2A104")).toEqual(NOT_RECOGNISED);
		});

		it("refuses decimal, other lengths and overlong serial numbers before any PIN attempt", async () => {
			for (const serial of ["0078234179", "04A1B2", `${SERIAL}${" ".repeat(80)}`, 42]) {
				expect(await lookUp(serial)).toMatchObject({ status: 400 });
				expect(await register(serial, ids.worker, { pin: "0000" })).toMatchObject({ status: 400 });
			}
			expect((await register("0078234179", ids.worker)).body).toEqual({ code: "invalid_serial" });
			expect(pinAttempts).toEqual([]);
			expect(await pinFailures(ids.worker)).toBe(0);
			expect(await fobs()).toEqual([]);
		});

		it("links nothing on a wrong PIN, and counts it toward the kiosk PIN lockout like clocking", async () => {
			for (let attempt = 1; attempt <= 4; attempt++) {
				expect(await register(SERIAL, ids.worker, { pin: "0000" })).toEqual({
					status: 403,
					body: { code: "wrong_pin" },
				});
			}
			const fifth = await register(SERIAL, ids.worker, { pin: "0000" });
			expect(fifth.status).toBe(423);
			expect(fifth.body.code).toBe("pin_locked");
			// Locked: even the right PIN is not checked.
			expect((await register(SERIAL, ids.worker)).body.code).toBe("pin_locked");
			expect(await pinFailures(ids.worker)).toBe(5);
			expect(pinAttempts).toHaveLength(6);
			expect(await fobs()).toEqual([]);
			expect(registered).toEqual([]);

			// The lockout is the employee's, so kiosk clocking's PIN check is locked too.
			expect(
				// The production PIN check, on the real clock like the endpoints' default.
				await verifyEmployeeKioskPin(db, {
					organizationId: ids.organization,
					employeeId: ids.worker,
					pin: PIN,
				}),
			).toMatchObject({ status: "locked" });
		});

		it("refuses an employee without a kiosk PIN", async () => {
			await admin.query("delete from employee_kiosk_pin where employee_id = $1", [ids.worker]);
			expect(await register(SERIAL, ids.worker)).toEqual({ status: 403, body: { code: "no_pin" } });
			expect(await fobs()).toEqual([]);
		});

		it("lets only employees eligible at the kiosk register, before any PIN attempt", async () => {
			await admin.query("update employee set is_active = false where id = $1", [ids.coworker]);
			await dueDeparture(new Date("2026-11-01T23:00:00Z"));
			for (const employeeId of [
				ids.stranger, // another location
				ids.coworker, // inactive
				ids.leaver, // departure past its cutoff, not yet processed
				ids.foreign, // another organization
				ids.manager, // not assigned here
				"f1505000-0000-4000-8000-0000000000ff", // nobody
			]) {
				expect(await register(SERIAL, employeeId, { pin: "0000" })).toEqual({
					status: 403,
					body: { code: "employee_not_eligible" },
				});
			}
			expect(pinAttempts).toHaveLength(6);
			expect(await pinFailures(ids.stranger)).toBe(0);
			expect(await fobs()).toEqual([]);
		});

		it("replaces the employee's earlier fob at once, recorded as replaced", async () => {
			await register(SERIAL, ids.worker);
			now = parseInstant("2026-11-02T09:00:00Z");
			expect(await register(OTHER_SERIAL, ids.worker)).toEqual({
				status: 200,
				body: {
					outcome: "registered",
					employee: { id: ids.worker, name: "Wanda Worker" },
					lastFour: "3C4D",
					replaced: true,
				},
			});
			expect(await fobs()).toEqual([
				expect.objectContaining({ serial_number: SERIAL, ended_reason: "replaced", ended: true }),
				expect.objectContaining({ serial_number: OTHER_SERIAL, ended_reason: null, ended: false }),
			]);
			expect(await lookUp(SERIAL)).toEqual(NOT_RECOGNISED);
			expect((await lookUp(OTHER_SERIAL)).body.employee.id).toBe(ids.worker);
			expect(registered[1]?.replacedFobId).toEqual(expect.any(String));

			// Once ended, the old card may be registered by someone else.
			expect((await register(SERIAL, ids.coworker)).body.outcome).toBe("registered");
			expect((await lookUp(SERIAL)).body.employee.id).toBe(ids.coworker);
		});

		it("answers a fob already linked to the same employee as already registered and changes nothing", async () => {
			await register(SERIAL, ids.worker);
			registered = [];
			expect(await register(SERIAL, ids.worker)).toEqual({
				status: 200,
				body: {
					outcome: "already_registered",
					employee: { id: ids.worker, name: "Wanda Worker" },
					lastFour: "E5F6",
					replaced: false,
				},
			});
			expect(await fobs()).toHaveLength(1);
			expect(registered).toEqual([expect.objectContaining({ outcome: "already_registered" })]);
		});

		it("refuses a fob linked to another employee without naming them, and never moves it", async () => {
			await register(SERIAL, ids.worker);
			const refused = await register(SERIAL, ids.coworker);
			expect(refused).toEqual({ status: 409, body: { code: "fob_linked_to_other_employee" } });
			expect(JSON.stringify(refused)).not.toContain("Wanda");
			expect(await fobs()).toEqual([
				expect.objectContaining({ employee_id: ids.worker, ended: false }),
			]);
			// A refused registration ends nothing: the coworker keeps their own fob.
			await register(OTHER_SERIAL, ids.coworker);
			await register(SERIAL, ids.coworker);
			expect((await lookUp(OTHER_SERIAL)).body.employee.id).toBe(ids.coworker);
		});

		it("lets one of two simultaneous registrations of the same fob win; the other is refused", async () => {
			const results = await Promise.all([
				register(SERIAL, ids.worker),
				register(SERIAL, ids.coworker),
			]);
			expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
			expect((await fobs()).filter((fob) => !fob.ended)).toHaveLength(1);
		});

		it("frees a fob whose employee's departure is due but not processed, ended at the cutoff", async () => {
			await register(SERIAL, ids.leaver);
			const cutoff = new Date("2026-11-02T08:30:00Z");
			await dueDeparture(cutoff);
			now = parseInstant("2026-11-02T10:00:00Z");

			// The leaver's link never selects once the cutoff passed.
			expect(await lookUp(SERIAL)).toEqual(NOT_RECOGNISED);
			expect((await register(SERIAL, ids.worker)).body.outcome).toBe("registered");
			const { rows } = await admin.query<{
				employee_id: string;
				ended_reason: string | null;
				ended_at: Date | null;
				ended_by_user_id: string | null;
			}>(
				`select employee_id, ended_reason, ended_at, ended_by_user_id from employee_kiosk_fob
				 where organization_id = $1 order by registered_at`,
				[ids.organization],
			);
			expect(rows).toEqual([
				{
					employee_id: ids.leaver,
					ended_reason: "departure",
					ended_at: cutoff,
					ended_by_user_id: null,
				},
				{ employee_id: ids.worker, ended_reason: null, ended_at: null, ended_by_user_id: null },
			]);
			expect((await lookUp(SERIAL)).body.employee.id).toBe(ids.worker);
		});

		it("keeps a fob whose employee's departure is still in the future", async () => {
			await register(SERIAL, ids.leaver);
			await dueDeparture(new Date("2026-11-03T00:00:00Z"));
			expect((await lookUp(SERIAL)).body.employee.id).toBe(ids.leaver);
			expect(await register(SERIAL, ids.worker)).toEqual({
				status: 409,
				body: { code: "fob_linked_to_other_employee" },
			});
		});
	});

	describe("organization scoping", () => {
		it("lets the same serial number be registered in another organization, each selecting only its own", async () => {
			await register(SERIAL, ids.worker);
			expect(await lookUp(SERIAL, tokens.foreign)).toEqual(NOT_RECOGNISED);
			expect((await register(SERIAL, ids.foreign, { token: tokens.foreign })).body).toMatchObject({
				outcome: "registered",
				employee: { id: ids.foreign, name: "Fay Foreign" },
			});
			expect((await lookUp(SERIAL, tokens.foreign)).body.employee.id).toBe(ids.foreign);
			expect((await lookUp(SERIAL)).body.employee.id).toBe(ids.worker);
			expect(await fobs(ids.otherOrganization)).toEqual([
				expect.objectContaining({
					employee_id: ids.foreign,
					registered_kiosk_id: ids.foreignKiosk,
				}),
			]);
		});

		it("never registers an employee of another organization, even at a kiosk where the serial is free", async () => {
			expect(await register(SERIAL, ids.worker, { token: tokens.foreign })).toEqual({
				status: 403,
				body: { code: "employee_not_eligible" },
			});
			expect(await fobs(ids.otherOrganization)).toEqual([]);
		});

		it("answers a fob of an employee at another location like an unknown one", async () => {
			await admin.query(
				`insert into employee_assigned_location (organization_id, employee_id, location_id)
				 values ($1, $2, $3)`,
				[ids.organization, ids.stranger, ids.store],
			);
			await register(SERIAL, ids.stranger);
			await admin.query(
				"delete from employee_assigned_location where employee_id = $1 and location_id = $2",
				[ids.stranger, ids.store],
			);
			expect(await lookUp(SERIAL)).toEqual(NOT_RECOGNISED);
		});

		it("limits lookups per kiosk", async () => {
			const limited = await answer(
				await newService({ lookupLimit: { allowed: false, retryAfter: 12 } }).lookup(
					kioskRequest("fob", { serial: SERIAL }),
				),
			);
			expect(limited).toEqual({ status: 429, body: { code: "rate_limited", retryAfter: 12 } });
		});
	});
});
