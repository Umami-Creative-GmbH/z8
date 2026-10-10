/**
 * #860: kiosk clocking on PostgreSQL, through the kiosk clock endpoint's service.
 * A kiosk device token, an employee and their kiosk PIN run Clocking with the
 * kiosk principal on the kiosk channel, in both admissions.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The work transactions are the real coordinated adapter, follow-ups are
 * recorded, and the PIN check is the real one. Only billing provisioning and the
 * Next request/cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	billing: { canAccess: true } as { canAccess: boolean; reason?: string },
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => harness.billing,
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const { createClocking } = await import("@/lib/time-tracking/clocking/clocking");
const { recordingFollowUps } = await import("@/lib/time-tracking/clocking/follow-ups");
const { coordinatedTransactions } = await import("@/lib/time-tracking/clocking/transactions");
const { setOwnKioskPin } = await import("@/lib/time-tracking/kiosk/pin-store");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskClockService } = await import("./clock-service");
const { readKioskEmployees } = await import("./home");
const { proveKioskPin } = await import("@/lib/time-tracking/clocking/kiosk");
const { createNotification } = await import("@/lib/notifications/notification-service");
type ClockPrincipal = import("@/lib/time-tracking/clocking/types").ClockPrincipal;
type ClockInCommand = import("@/lib/time-tracking/clocking/types").ClockInCommand;
type KioskPinProof = import("@/lib/time-tracking/clocking/types").KioskPinProof;

const ids = {
	organization: "t860-kiosk-org",
	otherOrganization: "t860-kiosk-other-org",
	workerUser: "t860-worker-user",
	kioskOnlyUser: "t860-kiosk-only-user",
	managerUser: "t860-manager-user",
	strangerUser: "t860-stranger-user",
	foreignUser: "t860-foreign-user",
	worker: "f8600000-0000-4000-8000-000000000001",
	kioskOnly: "f8600000-0000-4000-8000-000000000002",
	manager: "f8600000-0000-4000-8000-000000000003",
	stranger: "f8600000-0000-4000-8000-000000000004",
	foreign: "f8600000-0000-4000-8000-000000000005",
	store: "f8600000-0000-4000-8000-000000000011",
	warehouse: "f8600000-0000-4000-8000-000000000012",
	foreignStore: "f8600000-0000-4000-8000-000000000013",
	kiosk: "f8600000-0000-4000-8000-000000000021",
	revokedKiosk: "f8600000-0000-4000-8000-000000000022",
	foreignKiosk: "f8600000-0000-4000-8000-000000000023",
} as const;
const users = [
	ids.workerUser,
	ids.kioskOnlyUser,
	ids.managerUser,
	ids.strangerUser,
	ids.foreignUser,
];
const tokens = {
	kiosk: "z8k_t860-store-kiosk-token",
	revoked: "z8k_t860-revoked-kiosk-token",
	foreign: "z8k_t860-foreign-kiosk-token",
} as const;
const PIN = "4711";
const KIOSK_ZONE = "Europe/Berlin";
/** The employees' own timezone (their user settings), in which their day total counts. */
const EMPLOYEE_ZONE = "UTC";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("kiosk clocking on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant("2026-07-22T06:00:00Z");

	function newService() {
		const followUps = recordingFollowUps();
		const clock = { nowInstant: () => now };
		const clocking = createClocking({
			clock: clock as never,
			transactions: coordinatedTransactions(),
			followUps,
		});
		const service = createKioskClockService({
			clocking,
			clock,
			limitPinAttempts: async () => ({ allowed: true, retryAfter: 0 }),
		});
		return { service, followUps };
	}

	function kioskRequest(path: string, body: unknown, token: string = tokens.kiosk) {
		return new Request(`http://localhost/api/kiosk/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", [KIOSK_TOKEN_HEADER]: token },
			body: JSON.stringify(body),
		});
	}

	async function clock(body: Record<string, unknown>, token?: string) {
		const { service } = newService();
		const response = await service.clock(
			kioskRequest("clock", { employeeId: ids.worker, pin: PIN, ...body }, token),
		);
		return { status: response.status, body: await response.json() };
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function entries(employeeId: string = ids.worker) {
		const { rows } = await admin.query<{
			id: string;
			type: string;
			device_info: string | null;
			created_by: string;
			timezone: string | null;
			utc_offset_minutes: number;
		}>(
			`select id, type, device_info, created_by, timezone, utc_offset_minutes
			 from time_entry where employee_id = $1 order by timestamp, created_at`,
			[employeeId],
		);
		return rows;
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
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T860 kiosk', $1, 'Europe/Berlin', $3), ($2, 'T860 other', $2, 'UTC', $3)`,
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
			 ($1, 'Wanda Worker', 't860-worker@example.test', $6, $6),
			 ($2, 'Kim Kiosk', 'kiosk-t860@kiosk.invalid', $6, $6),
			 ($3, 'Mona Manager', 't860-manager@example.test', $6, $6),
			 ($4, 'Sam Stranger', 't860-stranger@example.test', $6, $6),
			 ($5, 'Fay Foreign', 't860-foreign@example.test', $6, $6)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t860-m-worker', $1, $3, 'member', 'approved', $8),
			 ('t860-m-kiosk-only', $1, $4, 'member', 'approved', $8),
			 ('t860-m-manager', $1, $5, 'member', 'approved', $8),
			 ('t860-m-stranger', $1, $6, 'member', 'approved', $8),
			 ('t860-m-foreign', $2, $7, 'owner', 'approved', $8)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.workerUser,
				ids.kioskOnlyUser,
				ids.managerUser,
				ids.strangerUser,
				ids.foreignUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $11, 'employee', true, $13),
			 ($3, $4, $11, 'employee', true, $13),
			 ($5, $6, $11, 'manager', true, $13),
			 ($7, $8, $11, 'employee', true, $13),
			 ($9, $10, $12, 'admin', true, $13)`,
			[
				ids.worker,
				ids.workerUser,
				ids.kioskOnly,
				ids.kioskOnlyUser,
				ids.manager,
				ids.managerUser,
				ids.stranger,
				ids.strangerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3), ($4, $2, true, $3)`,
			[ids.worker, ids.manager, ids.managerUser, ids.kioskOnly],
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
			                    revoked_at, created_by, updated_at) values
			 ($1, $4, $5, 'Store kiosk', $9, $10, $13, null, $14, $13),
			 ($2, $4, $5, 'Old kiosk', $9, $11, $13, $13, $14, $13),
			 ($3, $6, $7, 'Foreign kiosk', 'UTC', $12, $13, null, $8, $13)`,
			[
				ids.kiosk,
				ids.revokedKiosk,
				ids.foreignKiosk,
				ids.organization,
				ids.store,
				ids.otherOrganization,
				ids.foreignStore,
				ids.foreignUser,
				KIOSK_ZONE,
				hashKioskSecret(tokens.kiosk),
				hashKioskSecret(tokens.revoked),
				hashKioskSecret(tokens.foreign),
				timestamp,
				ids.managerUser,
			],
		);
		// The worker and the kiosk-only employee work at the store; the stranger only at the warehouse.
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id) values
			 ($1, $2, $5), ($1, $3, $5), ($1, $4, $6)`,
			[ids.organization, ids.worker, ids.kioskOnly, ids.stranger, ids.store, ids.warehouse],
		);
		for (const [organizationId, userId] of [
			[ids.organization, ids.workerUser],
			[ids.organization, ids.kioskOnlyUser],
			[ids.organization, ids.strangerUser],
			[ids.otherOrganization, ids.foreignUser],
		] as const) {
			await setOwnKioskPin(db, { organizationId, userId, pin: PIN });
		}
	}

	beforeEach(async () => {
		harness.billing = { canAccess: true };
		now = parseInstant("2026-07-22T06:00:00Z");
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (_admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("clocks an assigned employee in at the office and answers their state and day total", async () => {
			const response = await clock({ action: "clock_in" });

			expect(response).toEqual({
				status: 200,
				body: {
					outcome: "executed",
					action: "clock_in",
					at: { instant: "2026-07-22T06:00:00Z", zone: KIOSK_ZONE },
					employee: { id: ids.worker, name: "Wanda Worker" },
					state: {
						status: "clocked_in",
						workPeriodId: expect.any(String),
						since: "2026-07-22T06:00:00Z",
					},
					dayTotal: { date: "2026-07-22", timezone: EMPLOYEE_ZONE, minutes: 0 },
				},
			});
			const [entry] = await entries();
			expect(entry).toMatchObject({
				type: "clock_in",
				device_info: `kiosk:${ids.kiosk}`,
				created_by: ids.workerUser,
				timezone: KIOSK_ZONE,
				utc_offset_minutes: 120,
			});
			const { rows } = await admin.query(
				"select work_location_type from work_period where employee_id = $1",
				[ids.worker],
			);
			expect(only(rows)).toEqual({ work_location_type: "office" });
		});

		it("takes a break and clocks out, recording the kiosk on every entry and receipt", async () => {
			const { service, followUps } = newService();
			const run = async (body: Record<string, unknown>) => {
				const response = await service.clock(
					kioskRequest("clock", { employeeId: ids.worker, pin: PIN, ...body }),
				);
				return { status: response.status, body: await response.json() };
			};
			await run({ action: "clock_in" });
			now = parseInstant("2026-07-22T10:00:00Z");
			const breakTaken = await run({ action: "break", breakMinutes: 30 });
			now = parseInstant("2026-07-22T14:30:00Z");
			const clockedOut = await run({ action: "clock_out" });

			expect(breakTaken).toMatchObject({
				status: 200,
				body: {
					outcome: "executed",
					at: { instant: "2026-07-22T10:00:00Z", zone: KIOSK_ZONE },
					state: { status: "clocked_in", since: "2026-07-22T10:00:00Z" },
					dayTotal: { minutes: 210 },
				},
			});
			expect(clockedOut).toEqual({
				status: 200,
				body: {
					outcome: "executed",
					action: "clock_out",
					// The server's instant, not the device's (#761 P9).
					at: { instant: "2026-07-22T14:30:00Z", zone: KIOSK_ZONE },
					employee: { id: ids.worker, name: "Wanda Worker" },
					state: { status: "clocked_out" },
					dayTotal: { date: "2026-07-22", timezone: EMPLOYEE_ZONE, minutes: 480 },
				},
			});
			expect(
				(await entries()).map((entry) => [entry.type, entry.device_info, entry.created_by]),
			).toEqual([
				["clock_in", `kiosk:${ids.kiosk}`, ids.workerUser],
				["clock_out", `kiosk:${ids.kiosk}`, ids.workerUser],
				["clock_in", `kiosk:${ids.kiosk}`, ids.workerUser],
				["clock_out", `kiosk:${ids.kiosk}`, ids.workerUser],
			]);
			// The break and the clock-out both closed work and ran the clock-out follow-ups.
			expect(followUps.closures).toHaveLength(2);
			const { rows: receipts } = await admin.query(
				`select kind, writer, actor_kind, actor_user_id, kiosk_id, command->>'kioskId' as command_kiosk,
				        command->>'deviceInfo' as channel
				 from completed_work_operation where employee_id = $1 order by created_at`,
				[ids.worker],
			);
			if (mode === "inactive") {
				// Legacy admission keeps no receipts; the entries name the kiosk.
				expect(receipts).toEqual([]);
				return;
			}
			const kiosk = {
				writer: "kiosk_clock",
				actor_kind: "kiosk",
				actor_user_id: null,
				kiosk_id: ids.kiosk,
				command_kiosk: ids.kiosk,
				channel: "kiosk",
			};
			expect(receipts).toEqual([
				{ kind: "start_live_work", ...kiosk },
				{ kind: "close_resume_work", ...kiosk },
				{ kind: "close_active_work", ...kiosk },
			]);
		});

		it("starts a break in progress, resumes it, and ends the day while on a later break", async () => {
			const { service } = newService();
			const run = async (action: string) => {
				const response = await service.clock(
					kioskRequest("clock", { employeeId: ids.worker, pin: PIN, action }),
				);
				return { status: response.status, body: await response.json() };
			};
			await run("clock_in");
			now = parseInstant("2026-07-22T10:00:00Z");
			const started = await run("start_break");
			now = parseInstant("2026-07-22T10:30:00Z");
			const statusOnBreak = await service.status(
				kioskRequest("employee-status", { employeeId: ids.worker, pin: PIN }),
			);
			const resumed = await run("resume_break");
			now = parseInstant("2026-07-22T13:00:00Z");
			await run("start_break");
			now = parseInstant("2026-07-22T13:45:00Z");
			const endOfDay = await run("clock_out");

			expect(started).toMatchObject({
				status: 200,
				body: {
					outcome: "executed",
					action: "start_break",
					at: { instant: "2026-07-22T10:00:00Z", zone: KIOSK_ZONE },
					state: {
						status: "on_break",
						since: "2026-07-22T06:00:00Z",
						breakSince: "2026-07-22T10:00:00Z",
						breakZone: KIOSK_ZONE,
					},
					dayTotal: { minutes: 240 },
				},
			});
			expect(statusOnBreak.status).toBe(200);
			// The interrupted work keeps counting until the break ends (ADR 0007).
			expect(await statusOnBreak.json()).toMatchObject({
				state: { status: "on_break" },
				dayTotal: { minutes: 270 },
			});
			expect(resumed).toMatchObject({
				status: 200,
				body: {
					outcome: "executed",
					at: { instant: "2026-07-22T10:30:00Z", zone: KIOSK_ZONE },
					state: { status: "clocked_in", since: "2026-07-22T10:30:00Z" },
					dayTotal: { minutes: 240 },
				},
			});
			// The day ends at the open break's start.
			expect(endOfDay).toMatchObject({
				status: 200,
				body: {
					outcome: "executed",
					at: { instant: "2026-07-22T13:00:00Z", zone: KIOSK_ZONE },
					state: { status: "clocked_out" },
					dayTotal: { minutes: 390 },
				},
			});
		});

		it("replays a retried action with the same operation instead of clocking twice", async () => {
			const operationId = randomUUID();
			const first = await clock({ action: "clock_in", operationId });
			now = parseInstant("2026-07-22T06:01:00Z");
			const retry = await clock({ action: "clock_in", operationId });

			expect(first.body.outcome).toBe("executed");
			expect(retry).toMatchObject({
				status: 200,
				body: { outcome: "replayed", state: { status: "clocked_in" } },
			});
			expect(await entries()).toHaveLength(1);
		});
	});

	describe("refusals", () => {
		it("refuses an employee who is not assigned to the kiosk's location without checking the PIN", async () => {
			const response = await clock({ employeeId: ids.stranger, action: "clock_in" });
			expect(response).toEqual({ status: 403, body: { code: "employee_not_assigned" } });
			expect(await entries(ids.stranger)).toEqual([]);
		});

		it("refuses another organization's employee", async () => {
			const response = await clock({ employeeId: ids.foreign, action: "clock_in" });
			expect(response).toEqual({ status: 403, body: { code: "employee_not_assigned" } });
			expect(await entries(ids.foreign)).toEqual([]);
		});

		it("refuses a revoked kiosk", async () => {
			const response = await clock({ action: "clock_in" }, tokens.revoked);
			expect(response).toMatchObject({ status: 401, body: { code: "kiosk_revoked" } });
			expect(await entries()).toEqual([]);
		});

		it("answers a wrong PIN without clocking", async () => {
			const response = await clock({ action: "clock_in", pin: "0000" });
			expect(response).toEqual({ status: 403, body: { code: "wrong_pin" } });
			expect(await entries()).toEqual([]);
		});

		it("answers a locked PIN without clocking, even when it is then right", async () => {
			for (let attempt = 1; attempt < 5; attempt++) {
				expect((await clock({ action: "clock_in", pin: "0000" })).body).toEqual({
					code: "wrong_pin",
				});
			}
			const fifth = await clock({ action: "clock_in", pin: "0000" });
			const right = await clock({ action: "clock_in" });

			const locked = { status: 423, body: { code: "pin_locked", lockedUntil: expect.any(String) } };
			expect(fifth).toEqual(locked);
			expect(right).toEqual(locked);
			expect(await entries()).toEqual([]);
		});

		it("refuses PIN attempts over the kiosk's limit before checking the PIN", async () => {
			const followUps = recordingFollowUps();
			const limited = createKioskClockService({
				clocking: createClocking({
					clock: { nowInstant: () => now } as never,
					transactions: coordinatedTransactions(),
					followUps,
				}),
				clock: { nowInstant: () => now },
				limitPinAttempts: async (kioskId) => {
					expect(kioskId).toBe(ids.kiosk);
					return { allowed: false, retryAfter: 42 };
				},
			});
			const response = await limited.clock(
				kioskRequest("clock", { employeeId: ids.worker, pin: PIN, action: "clock_in" }),
			);
			expect(response.status).toBe(429);
			expect(await response.json()).toEqual({ code: "rate_limited", retryAfter: 42 });
			expect(await entries()).toEqual([]);
		});

		describe("Clocking's own kiosk authorization", () => {
			function clockIn(principal: ClockPrincipal, overrides: Partial<ClockInCommand> = {}) {
				return createClocking({
					clock: { nowInstant: () => now } as never,
					transactions: coordinatedTransactions(),
					followUps: recordingFollowUps(),
				}).run({
					organizationId: ids.organization,
					principal,
					subject: { employeeId: ids.worker },
					identity: { origin: "server", id: randomUUID() },
					channel: "kiosk",
					at: { kind: "now" },
					zone: { device: KIOSK_ZONE, fallback: KIOSK_ZONE },
					body: { kind: "clock_in", workLocationType: "office" },
					...overrides,
				});
			}

			async function proof(kioskId: string = ids.kiosk) {
				const proven = await proveKioskPin({
					organizationId: ids.organization,
					kioskId,
					employeeId: ids.worker,
					pin: PIN,
				});
				if (proven.status !== "verified") throw new Error(proven.status);
				return proven.proof;
			}

			const kioskPrincipal = (pin: KioskPinProof, kioskId: string = ids.kiosk): ClockPrincipal => ({
				kind: "kiosk",
				kioskId,
				userId: ids.workerUser,
				pin,
			});
			const denied = { outcome: "refused", failure: { code: "access_denied" } };

			it("runs with a proof the PIN check issued", async () => {
				await expect(clockIn(kioskPrincipal(await proof()))).resolves.toMatchObject({
					outcome: "executed",
				});
			});

			it("refuses a proof built without the PIN check", async () => {
				const forged = {
					organizationId: ids.organization,
					kioskId: ids.kiosk,
					employeeId: ids.worker,
				};
				await expect(clockIn(kioskPrincipal(forged))).resolves.toEqual(denied);
			});

			it("refuses a proof issued at another kiosk", async () => {
				await expect(
					clockIn(kioskPrincipal(await proof(ids.revokedKiosk), ids.kiosk)),
				).resolves.toEqual(denied);
			});

			it("refuses a kiosk revoked after the PIN was checked", async () => {
				const pin = await proof();
				await admin.query("update kiosk set revoked_at = now() where id = $1", [ids.kiosk]);
				await expect(clockIn(kioskPrincipal(pin))).resolves.toEqual(denied);
			});

			it("refuses an employee unassigned after the PIN was checked", async () => {
				const pin = await proof();
				await admin.query("delete from employee_assigned_location where employee_id = $1", [
					ids.worker,
				]);
				await expect(clockIn(kioskPrincipal(pin))).resolves.toEqual(denied);
			});

			it("refuses a device zone other than the kiosk's, an occurred instant and on behalf", async () => {
				for (const overrides of [
					{ zone: { device: "UTC", fallback: KIOSK_ZONE } },
					{ at: { kind: "occurred", instant: now } },
					{ subject: { employeeId: ids.worker, onBehalf: true } },
					{ channel: "web" },
				] as Partial<ClockInCommand>[]) {
					await expect(clockIn(kioskPrincipal(await proof()), overrides)).resolves.toEqual(denied);
				}
			});

			it("keeps the kiosk channel the kiosk principal's alone", async () => {
				await expect(clockIn({ kind: "user", userId: ids.workerUser })).resolves.toEqual(denied);
				expect(await entries()).toEqual([]);
			});
		});

		describe("notifications of a kiosk-only employee", () => {
			async function inbox(userId: string) {
				const { rows } = await admin.query<{
					title: string;
					message: string;
					metadata: string | null;
				}>(
					`select title, message, metadata from notification where user_id = $1 order by created_at`,
					[userId],
				);
				return rows;
			}

			function remind(userId: string) {
				return createNotification({
					userId,
					organizationId: ids.organization,
					type: "forgotten_clock_out_reminder",
					title: "Still clocked in?",
					message: "You have been clocked in for 10 hours.",
					actionUrl: "/time-tracking",
				});
			}

			it("reach their managers instead, naming the employee", async () => {
				await remind(ids.kioskOnlyUser);

				expect(await inbox(ids.kioskOnlyUser)).toEqual([]);
				const [forwarded, ...others] = await inbox(ids.managerUser);
				expect(others).toEqual([]);
				expect(forwarded).toMatchObject({
					title: "Kim Kiosk: Still clocked in?",
					message: "You have been clocked in for 10 hours.",
				});
				expect(JSON.parse(forwarded?.metadata ?? "{}")).toEqual({
					forwardedFor: { userId: ids.kioskOnlyUser, employeeId: ids.kioskOnly, name: "Kim Kiosk" },
				});
			});

			it("reach an employee with a sign-in themselves", async () => {
				await remind(ids.workerUser);

				expect(await inbox(ids.workerUser)).toMatchObject([{ title: "Still clocked in?" }]);
				expect(await inbox(ids.managerUser)).toEqual([]);
			});
		});

		it("counts the day total in the employee's timezone, not the kiosk's (#761)", async () => {
			now = parseInstant("2026-07-21T22:30:00Z");
			await clock({ action: "clock_in" });
			now = parseInstant("2026-07-21T23:30:00Z");
			await clock({ action: "clock_out" });
			now = parseInstant("2026-07-22T06:00:00Z");
			const status = async (employeeId: string) => {
				const response = await newService().service.status(
					kioskRequest("employee-status", { employeeId, pin: PIN }),
				);
				return (await response.json()).dayTotal;
			};

			// 22:30-23:30 UTC is still July 21 for the worker (UTC), though July 22 at the Berlin kiosk.
			expect(await status(ids.worker)).toEqual({
				date: "2026-07-22",
				timezone: EMPLOYEE_ZONE,
				minutes: 0,
			});
			// Without a timezone of their own, an employee counts in the organization's.
			await admin.query("delete from user_settings where user_id = $1", [ids.kioskOnlyUser]);
			expect(await status(ids.kioskOnly)).toEqual({
				date: "2026-07-22",
				timezone: "Europe/Berlin",
				minutes: 0,
			});
		});

		it("names the employee on the list and after the PIN alike (#761)", async () => {
			await admin.query(
				`update "user" set first_name = 'Wanda', last_name = 'Weber' where id = $1`,
				[ids.workerUser],
			);
			const response = await newService().service.status(
				kioskRequest("employee-status", { employeeId: ids.worker, pin: PIN }),
			);

			expect(await response.json()).toMatchObject({
				employee: { id: ids.worker, name: "Wanda Weber" },
			});
			expect(
				await readKioskEmployees(db, { organizationId: ids.organization, locationId: ids.store }),
			).toContainEqual({ id: ids.worker, name: "Wanda Weber" });
		});

		it("answers a Clocking refusal with the employee's state", async () => {
			const response = await clock({ action: "clock_out" });
			expect(response).toMatchObject({
				status: 409,
				body: {
					code: "not_clocked_in",
					state: { status: "clocked_out" },
					dayTotal: { minutes: 0 },
				},
			});
		});
	});
});
