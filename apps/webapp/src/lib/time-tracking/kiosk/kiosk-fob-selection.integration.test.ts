/**
 * #1506 (spec #1358, ADR 0014): a kiosk fob selects its employee for PIN
 * entry, on PostgreSQL, through the kiosk fob and kiosk clock endpoints'
 * services. The fob lookup only replaces the name pick: the kiosk PIN then
 * proves exactly as in name-and-PIN kiosk clocking (same check, same lockout,
 * same actions), and work changes go only through Clocking. Every fob that may
 * not select here gets the same neutral answer, the reader switch is enforced
 * on the server, and each organization's fobs select only its own employees.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Real kiosk authentication, PIN verification and lockout, fob store, kiosk
 * settings, coordinated work transactions and Clocking. Only the rate
 * limiters, billing provisioning and the Next request/cache boundaries are
 * replaced.
 */

import { randomUUID } from "node:crypto";
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
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { createClocking } = await import("@/lib/time-tracking/clocking/clocking");
const { recordingFollowUps } = await import("@/lib/time-tracking/clocking/follow-ups");
const { coordinatedTransactions } = await import("@/lib/time-tracking/clocking/transactions");
const { setOwnKioskPin } = await import("@/lib/time-tracking/kiosk/pin-store");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskFobService } = await import("./fob-service");
const { createKioskClockService } = await import("./clock-service");
const { withAuditTrail } = await import("@/lib/audit-trail");
const { updateKiosk } = await import("./kiosk-store");

const ids = {
	organization: "t1506-kiosk-org",
	otherOrganization: "t1506-kiosk-other-org",
	workerUser: "t1506-worker-user",
	coworkerUser: "t1506-coworker-user",
	strangerUser: "t1506-stranger-user",
	leaverUser: "t1506-leaver-user",
	managerUser: "t1506-manager-user",
	foreignUser: "t1506-foreign-user",
	worker: "f1506000-0000-4000-8000-000000000001",
	coworker: "f1506000-0000-4000-8000-000000000002",
	stranger: "f1506000-0000-4000-8000-000000000003",
	leaver: "f1506000-0000-4000-8000-000000000004",
	manager: "f1506000-0000-4000-8000-000000000005",
	foreign: "f1506000-0000-4000-8000-000000000006",
	store: "f1506000-0000-4000-8000-000000000011",
	warehouse: "f1506000-0000-4000-8000-000000000012",
	foreignStore: "f1506000-0000-4000-8000-000000000013",
	kiosk: "f1506000-0000-4000-8000-000000000021",
	switchedOffKiosk: "f1506000-0000-4000-8000-000000000022",
	foreignKiosk: "f1506000-0000-4000-8000-000000000023",
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
	kiosk: "z8k_t1506-store-kiosk-token",
	switchedOff: "z8k_t1506-switched-off-kiosk-token",
	foreign: "z8k_t1506-foreign-kiosk-token",
} as const;
const PIN = "4711";
const SERIAL = "04A1B2C3D4E5F6";
const OTHER_SERIAL = "1A2B3C4D";
const WANDA = { id: ids.worker, name: "Wanda Worker" };

describe("kiosk fob selects the employee for PIN entry on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant("2026-11-02T07:00:00Z");
	const clockPort = { nowInstant: () => now };
	let pinAttempts: string[] = [];
	let lookups: string[] = [];

	const fobService = createKioskFobService({
		clock: clockPort,
		limitPinAttempts: async (kioskId) => {
			pinAttempts.push(kioskId);
			return { allowed: true, retryAfter: 0 };
		},
		limitFobLookups: async (kioskId) => {
			lookups.push(kioskId);
			return { allowed: true, retryAfter: 0 };
		},
	});

	function clockService() {
		return createKioskClockService({
			clocking: createClocking({
				clock: clockPort as never,
				transactions: coordinatedTransactions(),
				followUps: recordingFollowUps(),
			}),
			clock: clockPort,
			limitPinAttempts: async (kioskId) => {
				pinAttempts.push(kioskId);
				return { allowed: true, retryAfter: 0 };
			},
			limitBadgeAttempts: async () => ({ allowed: true, retryAfter: 0 }),
			limitOutcomeLookups: async () => ({ allowed: true, retryAfter: 0 }),
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

	/** A fob read on the kiosk's home screen. */
	async function lookUp(serial: unknown, token?: string) {
		return answer(await fobService.lookup(kioskRequest("fob", { serial }, token)));
	}

	/** Everything a client could tell answers apart by: status, headers and the exact body. */
	async function rawLookUp(serial: unknown, token?: string) {
		const response = await fobService.lookup(kioskRequest("fob", { serial }, token));
		return {
			status: response.status,
			contentType: response.headers.get("content-type"),
			cacheControl: response.headers.get("cache-control"),
			text: await response.text(),
		};
	}

	/** The PIN entry's check, as after a name pick: the employee's state and day total. */
	async function status(body: Record<string, unknown>, token?: string) {
		return answer(await clockService().status(kioskRequest("employee-status", body, token)));
	}

	async function clock(body: Record<string, unknown>, token?: string) {
		return answer(await clockService().clock(kioskRequest("clock", body, token)));
	}

	/** An active fob link, as a registration leaves it (registered elsewhere in the suite of #1505). */
	async function linkFob(
		employeeId: string,
		serial: string,
		organizationId: string = ids.organization,
	) {
		const { rows } = await admin.query<{ id: string }>(
			`insert into employee_kiosk_fob
			 (organization_id, employee_id, employment_period_id, serial_number, registered_at)
			 select organization_id, employee_id, id, $3, $4 from employee_employment_period
			 where organization_id = $1 and employee_id = $2 and status = 'open'
			 returning id`,
			[organizationId, employeeId, serial, new Date("2026-10-15T08:00:00Z")],
		);
		const [row] = rows;
		if (!row) throw new Error(`No open employment period for ${employeeId}`);
		return row.id;
	}

	async function endFob(fobId: string, reason: "replaced" | "removed" | "departure") {
		await admin.query(
			`update employee_kiosk_fob set ended_at = $2, ended_reason = $3 where id = $1`,
			[fobId, new Date("2026-10-20T08:00:00Z"), reason],
		);
	}

	/** Everything a kiosk call could leave behind for an organization. */
	async function traces(organizationId: string = ids.organization) {
		const { rows } = await admin.query<Record<string, number>>(
			`select (select count(*)::int from time_entry where organization_id = $1) as entries,
			        (select count(*)::int from work_period where organization_id = $1) as periods,
			        (select count(*)::int from completed_work_operation where organization_id = $1) as receipts,
			        (select count(*)::int from employee_kiosk_pin_event where organization_id = $1) as pin_events,
			        (select count(*)::int from audit_log where organization_id = $1) as audits,
			        (select count(*)::int from employee_kiosk_fob where organization_id = $1) as fobs`,
			[organizationId],
		);
		return rows[0];
	}

	async function setFobReader(kioskId: string, nfcFobReaderEnabled: boolean) {
		await withAuditTrail((audit) =>
			db.transaction((tx) =>
				updateKiosk(
					tx,
					audit,
					{
						organizationId: ids.organization,
						actorUserId: ids.managerUser,
						kioskId,
						change: { nfcFobReaderEnabled },
					},
					clockPort,
				),
			),
		);
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
			 ($1, 'T1506 kiosk', $1, 'Europe/Berlin', $3), ($2, 'T1506 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Wanda Worker', 't1506-worker@example.test', $7, $7),
			 ($2, 'Cora Coworker', 't1506-coworker@example.test', $7, $7),
			 ($3, 'Sam Stranger', 't1506-stranger@example.test', $7, $7),
			 ($4, 'Lee Leaver', 't1506-leaver@example.test', $7, $7),
			 ($5, 'Mona Manager', 't1506-manager@example.test', $7, $7),
			 ($6, 'Fay Foreign', 't1506-foreign@example.test', $7, $7)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1506-m-worker', $1, $3, 'member', 'approved', $9),
			 ('t1506-m-coworker', $1, $4, 'member', 'approved', $9),
			 ('t1506-m-stranger', $1, $5, 'member', 'approved', $9),
			 ('t1506-m-leaver', $1, $6, 'member', 'approved', $9),
			 ('t1506-m-manager', $1, $7, 'admin', 'approved', $9),
			 ('t1506-m-foreign', $2, $8, 'owner', 'approved', $9)`,
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
			[[ids.worker, ids.coworker, ids.stranger, ids.leaver, ids.manager, ids.foreign], timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
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
		// Worker, coworker and leaver work at the store; the stranger only at the warehouse;
		// the manager nowhere.
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

	/** A departure of the leaver with this cutoff, not yet processed by the worker. */
	async function pendingDeparture(cutoff: Date) {
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
		now = parseInstant("2026-11-02T07:00:00Z");
		pinAttempts = [];
		lookups = [];
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("selection", () => {
		it("selects the fob's employee, whose PIN then opens exactly the name-and-PIN turn; the lookup records nothing", async () => {
			await linkFob(ids.worker, SERIAL);
			const before = await traces();

			const selected = await lookUp(SERIAL);

			expect(selected).toEqual({ status: 200, body: { outcome: "employee", employee: WANDA } });
			expect(await traces()).toEqual(before);
			// A lookup is no PIN attempt.
			expect(pinAttempts).toEqual([]);
			expect(lookups).toEqual([ids.kiosk]);

			// The PIN entry it opens is the name pick's: the same call, the same answer.
			const afterFob = await status({ employeeId: selected.body.employee.id, pin: PIN });
			const afterName = await status({ employeeId: ids.worker, pin: PIN });
			expect(afterFob).toEqual({
				status: 200,
				body: {
					employee: WANDA,
					state: { status: "clocked_out" },
					dayTotal: { date: "2026-11-02", timezone: "UTC", minutes: 0 },
				},
			});
			expect(afterFob).toEqual(afterName);
		});

		it("changes work only through Clocking, proved by the PIN; a fob alone authorizes nothing", async () => {
			await linkFob(ids.worker, SERIAL);
			const selected = (await lookUp(SERIAL)).body.employee.id;

			// Without the PIN: a serial is no proof, and never passes for a badge.
			expect(await status({ employeeId: selected, serial: SERIAL })).toEqual({
				status: 400,
				body: { code: "invalid_request" },
			});
			expect(
				await clock({
					employeeId: selected,
					serial: SERIAL,
					action: "clock_in",
					operationId: randomUUID(),
				}),
			).toEqual({ status: 400, body: { code: "invalid_request" } });
			expect(
				(await clock({ badge: SERIAL, action: "clock_in", operationId: randomUUID() })).status,
			).toBe(403);
			expect(await traces()).toMatchObject({ entries: 0, periods: 0, receipts: 0 });

			const clockedIn = await clock({
				employeeId: selected,
				pin: PIN,
				action: "clock_in",
				operationId: randomUUID(),
			});
			expect(clockedIn).toMatchObject({
				status: 200,
				body: {
					outcome: "executed",
					action: "clock_in",
					employee: WANDA,
					state: { status: "clocked_in" },
				},
			});
			const { rows: entries } = await admin.query<{ type: string; device_info: string }>(
				"select type, device_info from time_entry where employee_id = $1",
				[ids.worker],
			);
			expect(entries).toEqual([{ type: "clock_in", device_info: `kiosk:${ids.kiosk}` }]);

			// The next tap shows the state the name pick would: clocked in, with the PIN.
			now = parseInstant("2026-11-02T09:00:00Z");
			expect((await lookUp(SERIAL)).body).toEqual({ outcome: "employee", employee: WANDA });
			expect((await status({ employeeId: ids.worker, pin: PIN })).body.state).toMatchObject({
				status: "clocked_in",
			});
		});

		it("counts a wrong PIN after a fob toward the same lockout as name and PIN", async () => {
			await linkFob(ids.worker, SERIAL);
			for (let attempt = 1; attempt <= 4; attempt++) {
				expect((await lookUp(SERIAL)).body.outcome).toBe("employee");
				expect(await status({ employeeId: ids.worker, pin: "0000" })).toEqual({
					status: 403,
					body: { code: "wrong_pin" },
				});
			}
			const fifth = await status({ employeeId: ids.worker, pin: "0000" });
			expect(fifth.status).toBe(423);
			expect(fifth.body.code).toBe("pin_locked");

			// The fob still selects; the PIN is what stays locked, by fob and by name alike.
			expect((await lookUp(SERIAL)).body.outcome).toBe("employee");
			expect((await status({ employeeId: ids.worker, pin: PIN })).body.code).toBe("pin_locked");
			const { rows } = await admin.query<{ count: number }>(
				`select count(*)::int as count from employee_kiosk_pin_event
				 where employee_id = $1 and kind = 'failure'`,
				[ids.worker],
			);
			expect(rows[0]?.count).toBe(5);
			// Lookups never counted as PIN attempts.
			expect(pinAttempts).toHaveLength(6);
		});
	});

	describe("the neutral refusal", () => {
		const cases: [string, () => Promise<void>][] = [
			["an unknown fob", async () => undefined],
			[
				"a fob of an employee at another location",
				async () => {
					await linkFob(ids.stranger, SERIAL);
				},
			],
			[
				"a fob of an employee assigned to no location",
				async () => {
					await linkFob(ids.manager, SERIAL);
				},
			],
			[
				"a fob of an inactive employee",
				async () => {
					await linkFob(ids.coworker, SERIAL);
					await admin.query("update employee set is_active = false where id = $1", [ids.coworker]);
				},
			],
			[
				"a fob of an employee whose departure cutoff passed, not yet processed",
				async () => {
					await linkFob(ids.leaver, SERIAL);
					await pendingDeparture(new Date("2026-11-02T06:00:00Z"));
				},
			],
			[
				"a fob of a departed employee",
				async () => {
					await linkFob(ids.leaver, SERIAL);
					await admin.query(
						`update employee_employment_period set status = 'closed', ended_at = $2
						 where employee_id = $1`,
						[ids.leaver, new Date("2026-10-31T23:00:00Z")],
					);
					await admin.query("update employee set is_active = false where id = $1", [ids.leaver]);
				},
			],
			[
				"a fob of another organization's employee",
				async () => {
					await linkFob(ids.foreign, SERIAL, ids.otherOrganization);
				},
			],
			[
				"a replaced fob",
				async () => {
					await endFob(await linkFob(ids.worker, SERIAL), "replaced");
					await linkFob(ids.worker, OTHER_SERIAL);
				},
			],
			[
				"a removed fob",
				async () => {
					await endFob(await linkFob(ids.worker, SERIAL), "removed");
				},
			],
			[
				"a fob ended by departure",
				async () => {
					await endFob(await linkFob(ids.worker, SERIAL), "departure");
				},
			],
		];

		it.each(cases)(
			"answers %s exactly like an unknown one, recording nothing",
			async (_case, given) => {
				const unknown = await rawLookUp(SERIAL);
				await given();
				const before = await traces();

				const answered = await rawLookUp(SERIAL);

				expect(answered).toEqual(unknown);
				expect(answered).toEqual({
					status: 200,
					contentType: expect.stringContaining("application/json"),
					cacheControl: "no-store",
					text: JSON.stringify({ outcome: "not_recognised" }),
				});
				expect(await traces()).toEqual(before);
				expect(pinAttempts).toEqual([]);
			},
		);

		it("still selects an employee whose departure is in the future", async () => {
			await linkFob(ids.leaver, SERIAL);
			await pendingDeparture(new Date("2026-11-03T00:00:00Z"));
			expect((await lookUp(SERIAL)).body).toEqual({
				outcome: "employee",
				employee: { id: ids.leaver, name: "Lee Leaver" },
			});
		});
	});

	describe("the NFC fob reader switch", () => {
		it("refuses every lookup at a kiosk with the switch off, a registered fob's too, before the limiter", async () => {
			await linkFob(ids.worker, SERIAL);
			for (const serial of [SERIAL, OTHER_SERIAL, "not a serial"]) {
				expect(await lookUp(serial, tokens.switchedOff)).toEqual({
					status: 403,
					body: { code: "fob_reader_disabled" },
				});
			}
			expect(lookups).toEqual([]);
		});

		it("follows the switch at once: off refuses, on again selects", async () => {
			await linkFob(ids.worker, SERIAL);
			expect((await lookUp(SERIAL)).body.outcome).toBe("employee");

			await setFobReader(ids.kiosk, false);
			expect(await lookUp(SERIAL)).toEqual({ status: 403, body: { code: "fob_reader_disabled" } });
			// Name and PIN go on regardless of the switch.
			expect((await status({ employeeId: ids.worker, pin: PIN })).status).toBe(200);

			await setFobReader(ids.kiosk, true);
			expect((await lookUp(SERIAL)).body).toEqual({ outcome: "employee", employee: WANDA });
		});
	});

	describe("organization scoping", () => {
		it("selects only the kiosk's own organization's employee when both organizations use the serial", async () => {
			await linkFob(ids.worker, SERIAL);
			await linkFob(ids.foreign, SERIAL, ids.otherOrganization);

			expect((await lookUp(SERIAL)).body).toEqual({ outcome: "employee", employee: WANDA });
			expect((await lookUp(SERIAL, tokens.foreign)).body).toEqual({
				outcome: "employee",
				employee: { id: ids.foreign, name: "Fay Foreign" },
			});
		});

		it("never selects another organization's employee, and their PIN entry refuses them", async () => {
			await linkFob(ids.worker, SERIAL);
			expect(await rawLookUp(SERIAL, tokens.foreign)).toEqual(
				await rawLookUp(OTHER_SERIAL, tokens.foreign),
			);
			// Even a kiosk that skipped the lookup cannot open their turn.
			expect((await status({ employeeId: ids.worker, pin: PIN }, tokens.foreign)).status).toBe(403);
		});
	});
});
