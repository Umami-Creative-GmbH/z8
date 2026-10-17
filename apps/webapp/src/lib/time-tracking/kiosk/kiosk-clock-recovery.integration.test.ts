/**
 * #1363: resolving an uncertain online kiosk action on PostgreSQL, through the
 * kiosk clock endpoint's service. A kiosk asks what became of an action whose
 * reply it lost (`POST /api/kiosk/clock/outcome`); the answer is the original
 * action and its recorded time, a definitive "not recorded" after which the
 * original can never commit, or nothing definitive.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Real kiosk authentication, PIN checks, coordinated work transactions and
 * Clocking, in both admissions. Only billing provisioning and the Next
 * request/cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
type EmployeeCalendar = import("./clock-service").EmployeeCalendar;

const ids = {
	organization: "t1363-kiosk-org",
	otherOrganization: "t1363-kiosk-other-org",
	workerUser: "t1363-worker-user",
	colleagueUser: "t1363-colleague-user",
	managerUser: "t1363-manager-user",
	foreignUser: "t1363-foreign-user",
	worker: "f1363000-0000-4000-8000-000000000001",
	colleague: "f1363000-0000-4000-8000-000000000002",
	manager: "f1363000-0000-4000-8000-000000000003",
	foreign: "f1363000-0000-4000-8000-000000000004",
	store: "f1363000-0000-4000-8000-000000000011",
	foreignStore: "f1363000-0000-4000-8000-000000000012",
	kiosk: "f1363000-0000-4000-8000-000000000021",
	backKiosk: "f1363000-0000-4000-8000-000000000022",
	foreignKiosk: "f1363000-0000-4000-8000-000000000023",
} as const;
const users = [ids.workerUser, ids.colleagueUser, ids.managerUser, ids.foreignUser];
const tokens = {
	kiosk: "z8k_t1363-store-kiosk-token",
	back: "z8k_t1363-back-kiosk-token",
	foreign: "z8k_t1363-foreign-kiosk-token",
} as const;
const PIN = "4711";
const KIOSK_ZONE = "Europe/Berlin";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("kiosk clock recovery on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant("2026-07-22T06:00:00Z");

	function newService(
		options: { employeeCalendar?: (input: { userId: string }) => Promise<EmployeeCalendar> } = {},
	) {
		const clock = { nowInstant: () => now };
		const clocking = createClocking({
			clock: clock as never,
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		});
		return createKioskClockService({
			clocking,
			clock,
			limitPinAttempts: async () => ({ allowed: true, retryAfter: 0 }),
			...options,
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

	async function clock(body: Record<string, unknown>, token?: string) {
		return answer(
			await newService().clock(
				kioskRequest("clock", { employeeId: ids.worker, pin: PIN, ...body }, token),
			),
		);
	}

	/** What the kiosk asks about an action whose reply it lost. */
	async function outcome(body: Record<string, unknown>, token?: string) {
		return answer(
			await newService().outcome(
				kioskRequest("clock/outcome", { employeeId: ids.worker, ...body }, token),
			),
		);
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function entries(employeeId: string = ids.worker) {
		const { rows } = await admin.query<{ id: string; type: string }>(
			"select id, type from time_entry where employee_id = $1 order by timestamp, created_at",
			[employeeId],
		);
		return rows;
	}

	/** Every write a clock action leaves: entries, periods and receipts. */
	async function work(employeeId: string = ids.worker) {
		const { rows } = await admin.query<{ entries: number; periods: number; receipts: number }>(
			`select (select count(*)::int from time_entry where employee_id = $1) as entries,
			        (select count(*)::int from work_period where employee_id = $1) as periods,
			        (select count(*)::int from completed_work_operation where employee_id = $1) as receipts`,
			[employeeId],
		);
		return only(rows);
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
			 ($1, 'T1363 kiosk', $1, 'Europe/Berlin', $3), ($2, 'T1363 other', $2, 'UTC', $3)`,
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
			 ($1, 'Wanda Worker', 't1363-worker@example.test', $5, $5),
			 ($2, 'Cleo Colleague', 't1363-colleague@example.test', $5, $5),
			 ($3, 'Mona Manager', 't1363-manager@example.test', $5, $5),
			 ($4, 'Fay Foreign', 't1363-foreign@example.test', $5, $5)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1363-m-worker', $1, $3, 'member', 'approved', $7),
			 ('t1363-m-colleague', $1, $4, 'member', 'approved', $7),
			 ('t1363-m-manager', $1, $5, 'member', 'approved', $7),
			 ('t1363-m-foreign', $2, $6, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.workerUser,
				ids.colleagueUser,
				ids.managerUser,
				ids.foreignUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $9, 'employee', true, $11),
			 ($3, $4, $9, 'employee', true, $11),
			 ($5, $6, $9, 'manager', true, $11),
			 ($7, $8, $10, 'admin', true, $11)`,
			[
				ids.worker,
				ids.workerUser,
				ids.colleague,
				ids.colleagueUser,
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
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'Store', $5, $6), ($2, $4, 'Foreign store', $7, $6)`,
			[
				ids.store,
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
			                    created_by, updated_at) values
			 ($1, $4, $5, 'Store kiosk', $8, $9, $12, $13, $12),
			 ($2, $4, $5, 'Back door kiosk', $8, $10, $12, $13, $12),
			 ($3, $6, $7, 'Foreign kiosk', 'UTC', $11, $12, $14, $12)`,
			[
				ids.kiosk,
				ids.backKiosk,
				ids.foreignKiosk,
				ids.organization,
				ids.store,
				ids.otherOrganization,
				ids.foreignStore,
				KIOSK_ZONE,
				hashKioskSecret(tokens.kiosk),
				hashKioskSecret(tokens.back),
				hashKioskSecret(tokens.foreign),
				timestamp,
				ids.managerUser,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id) values
			 ($1, $2, $4), ($1, $3, $4)`,
			[ids.organization, ids.worker, ids.colleague, ids.store],
		);
		for (const [organizationId, userId] of [
			[ids.organization, ids.workerUser],
			[ids.organization, ids.colleagueUser],
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

		it("answers a committed clock-in whose reply was lost with its original action and time, once", async () => {
			const operationId = randomUUID();
			const original = await clock({ action: "clock_in", operationId });
			expect(original.status).toBe(200);
			const written = await work();
			now = parseInstant("2026-07-22T06:05:00Z");

			const recovered = await outcome({ operationId, action: "clock_in" });

			expect(recovered).toEqual({
				status: 200,
				body: {
					outcome: "committed",
					action: "clock_in",
					at: { instant: "2026-07-22T06:00:00Z", zone: KIOSK_ZONE },
				},
			});
			expect(original.body.at).toEqual(recovered.body.at);
			expect(await work()).toEqual(written);
			expect(await entries()).toHaveLength(1);
		});

		it("answers an action that committed before the server failed to reply", async () => {
			const failing = newService({
				employeeCalendar: async () => {
					throw new Error("calendar unavailable");
				},
			});
			const operationId = randomUUID();

			await expect(
				failing.clock(
					kioskRequest("clock", {
						employeeId: ids.worker,
						pin: PIN,
						action: "clock_in",
						operationId,
					}),
				),
			).rejects.toThrow("calendar unavailable");

			await expect(outcome({ operationId, action: "clock_in" })).resolves.toEqual({
				status: 200,
				body: {
					outcome: "committed",
					action: "clock_in",
					at: { instant: "2026-07-22T06:00:00Z", zone: KIOSK_ZONE },
				},
			});
			expect(await entries()).toHaveLength(1);
		});

		it("answers every action kind with the time its own reply named", async () => {
			await clock({ action: "clock_in" });
			const steps: [string, Record<string, unknown>][] = [
				["2026-07-22T09:00:00Z", { action: "break", breakMinutes: 15 }],
				["2026-07-22T10:00:00Z", { action: "start_break" }],
				["2026-07-22T10:30:00Z", { action: "resume_break" }],
				["2026-07-22T12:00:00Z", { action: "start_break" }],
				// The day ends at the open break's start.
				["2026-07-22T12:45:00Z", { action: "clock_out" }],
			];
			for (const [instant, body] of steps) {
				now = parseInstant(instant);
				const operationId = randomUUID();
				const original = await clock({ ...body, operationId });
				expect(original.status).toBe(200);

				const recovered = await outcome({ operationId, action: body.action });

				expect(recovered).toEqual({
					status: 200,
					body: { outcome: "committed", action: body.action, at: original.body.at },
				});
			}
			expect((await outcome({ operationId: randomUUID(), action: "clock_out" })).body).toEqual({
				outcome: "not_recorded",
			});
		});

		it("closes an attempt nothing recorded, so the original can never commit afterwards", async () => {
			const operationId = randomUUID();

			const first = await outcome({ operationId, action: "clock_in" });
			const late = await clock({ action: "clock_in", operationId });
			const again = await outcome({ operationId, action: "clock_in" });

			expect(first).toEqual({ status: 200, body: { outcome: "not_recorded" } });
			expect(late).toMatchObject({
				status: 409,
				body: { code: "attempt_closed", state: { status: "clocked_out" } },
			});
			expect(again).toEqual(first);
			expect(await work()).toEqual({ entries: 0, periods: 0, receipts: 0 });

			// A fresh action under a new identity runs as usual.
			const fresh = await clock({ action: "clock_in", operationId: randomUUID() });
			expect(fresh).toMatchObject({ status: 200, body: { outcome: "executed" } });
		});

		it("closes every kind of stale attempt without touching the work", async () => {
			await clock({ action: "clock_in" });
			now = parseInstant("2026-07-22T10:00:00Z");
			const before = await work();
			for (const body of [
				{ action: "clock_out" },
				{ action: "break", breakMinutes: 10 },
				{ action: "start_break" },
			]) {
				const operationId = randomUUID();
				expect((await outcome({ operationId, action: body.action })).body).toEqual({
					outcome: "not_recorded",
				});
				expect(await clock({ ...body, operationId })).toMatchObject({
					status: 409,
					body: { code: "attempt_closed", state: { status: "clocked_in" } },
				});
			}
			await clock({ action: "start_break" });
			now = parseInstant("2026-07-22T10:20:00Z");
			const onBreak = await work();
			const operationId = randomUUID();
			await outcome({ operationId, action: "resume_break" });
			expect(await clock({ action: "resume_break", operationId })).toMatchObject({
				status: 409,
				body: { code: "attempt_closed", state: { status: "on_break" } },
			});
			expect(await work()).toEqual(onBreak);
			expect(before.entries).toBe(1);
		});

		it("answers a refused action as not recorded", async () => {
			const operationId = randomUUID();
			const refused = await clock({ action: "clock_out", operationId });
			expect(refused).toMatchObject({ status: 409, body: { code: "not_clocked_in" } });

			await expect(outcome({ operationId, action: "clock_out" })).resolves.toEqual({
				status: 200,
				body: { outcome: "not_recorded" },
			});
		});

		describe("racing the original request", () => {
			type Holder = {
				pid: number;
				query: (text: string, params?: unknown[]) => Promise<unknown>;
				commit: () => Promise<void>;
			};
			const holders = new Set<Holder>();
			const PARK_KEY = 1_363_001;

			async function openHolder(): Promise<Holder> {
				const client: PoolClient = await admin.connect();
				await client.query("begin");
				await client.query("set local lock_timeout = '20s'");
				const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
				let open = true;
				const holder: Holder = {
					pid: only(rows).pid,
					query: (text, params) => client.query(text, params),
					commit: async () => {
						if (!open) return;
						open = false;
						holders.delete(holder);
						try {
							await client.query("commit");
						} finally {
							client.release();
						}
					},
				};
				holders.add(holder);
				return holder;
			}

			async function waitFor<T>(label: string, probe: () => Promise<T | undefined>): Promise<T> {
				const deadline = Date.now() + 15_000;
				while (Date.now() < deadline) {
					const value = await probe();
					if (value !== undefined) return value;
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
				throw new Error(`Timed out waiting for ${label}`);
			}

			/** The backend blocked (directly) by another one's locks. */
			function waiterOf(blockingPid: number) {
				return waitFor(`a backend blocked by ${blockingPid}`, async () => {
					const { rows } = await admin.query<{ pid: number }>(
						`select pid from pg_stat_activity
						 where datname = current_database() and wait_event_type = 'Lock'
						   and $1 = any(pg_blocking_pids(pid))`,
						[blockingPid],
					);
					return rows[0]?.pid;
				});
			}

			afterEach(async () => {
				for (const holder of [...holders]) await holder.commit();
				await admin.query("drop trigger if exists t1363_park_claim on kiosk_clock_attempt");
				await admin.query("drop function if exists t1363_park_claim()");
			});

			it("never reports an in-flight original as not recorded once it may commit, and then reports its commit", async () => {
				// The original stops right after claiming its attempt, inside its work transaction.
				await admin.query(
					`create or replace function t1363_park_claim() returns trigger language plpgsql as $$
					 begin perform pg_advisory_xact_lock(${PARK_KEY}); return new; end $$`,
				);
				await admin.query(
					`create trigger t1363_park_claim after insert on kiosk_clock_attempt
					 for each row when (new.state = 'committed') execute function t1363_park_claim()`,
				);
				const holder = await openHolder();
				await holder.query("select pg_advisory_xact_lock($1)", [PARK_KEY]);
				const operationId = randomUUID();

				const original = clock({ action: "clock_in", operationId });
				const originalPid = await waiterOf(holder.pid);
				const lookup = outcome({ operationId, action: "clock_in" });
				await waiterOf(originalPid);
				let settled = false;
				void lookup.then(() => {
					settled = true;
				});
				await new Promise((resolve) => setTimeout(resolve, 200));
				expect(settled).toBe(false);

				await holder.commit();

				await expect(original).resolves.toMatchObject({
					status: 200,
					body: { outcome: "executed" },
				});
				await expect(lookup).resolves.toEqual({
					status: 200,
					body: {
						outcome: "committed",
						action: "clock_in",
						at: { instant: "2026-07-22T06:00:00Z", zone: KIOSK_ZONE },
					},
				});
				expect(await entries()).toHaveLength(1);
			});

			it("closes an original still waiting for its work transaction, which then commits nothing", async () => {
				// The original waits for the employee's coordination key (rank 5), before its claim.
				const holder = await openHolder();
				await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [ids.worker]);
				const operationId = randomUUID();

				const original = clock({ action: "clock_in", operationId });
				await waiterOf(holder.pid);
				const lookup = await outcome({ operationId, action: "clock_in" });
				expect(lookup).toEqual({ status: 200, body: { outcome: "not_recorded" } });

				await holder.commit();

				await expect(original).resolves.toMatchObject({
					status: 409,
					body: { code: "attempt_closed" },
				});
				expect(await work()).toEqual({ entries: 0, periods: 0, receipts: 0 });
				await expect(outcome({ operationId, action: "clock_in" })).resolves.toEqual(lookup);
			});
		});
	});

	describe("scope", () => {
		beforeEach(async () => {
			await setAdmission("active");
		});

		it("reveals an attempt only to the kiosk that made it", async () => {
			const operationId = randomUUID();
			await clock({ action: "clock_in", operationId });

			// Another kiosk of the organization, and another organization's kiosk, see nothing of it.
			const back = await outcome({ operationId, action: "clock_in" }, tokens.back);
			const foreign = await outcome(
				{ operationId, employeeId: ids.foreign, action: "clock_in" },
				tokens.foreign,
			);

			expect(back).toEqual({ status: 200, body: { outcome: "not_recorded" } });
			expect(foreign).toEqual({ status: 200, body: { outcome: "not_recorded" } });
			expect((await outcome({ operationId, action: "clock_in" })).body).toMatchObject({
				outcome: "committed",
			});
			expect(await entries()).toHaveLength(1);
		});

		it("answers a committed attempt asked about for another employee or action as a conflict", async () => {
			const operationId = randomUUID();
			await clock({ action: "clock_in", operationId });

			await expect(
				outcome({ operationId, employeeId: ids.colleague, action: "clock_in" }),
			).resolves.toEqual({ status: 200, body: { outcome: "conflict" } });
			await expect(outcome({ operationId, action: "start_break" })).resolves.toEqual({
				status: 200,
				body: { outcome: "conflict" },
			});
		});

		it("keeps a committed attempt committed after the employee's PIN and assignment change", async () => {
			const operationId = randomUUID();
			await clock({ action: "clock_in", operationId });
			await setOwnKioskPin(db, {
				organizationId: ids.organization,
				userId: ids.workerUser,
				pin: "9999",
			});
			await admin.query("delete from employee_assigned_location where employee_id = $1", [
				ids.worker,
			]);

			await expect(outcome({ operationId, action: "clock_in" })).resolves.toMatchObject({
				status: 200,
				body: { outcome: "committed", action: "clock_in" },
			});
		});

		it("settles nothing for a revoked or unknown kiosk, or a malformed question", async () => {
			const operationId = randomUUID();
			await clock({ action: "clock_in", operationId });
			await admin.query("update kiosk set revoked_at = now() where id = $1", [ids.kiosk]);

			await expect(outcome({ operationId, action: "clock_in" })).resolves.toMatchObject({
				status: 401,
				body: { code: "kiosk_revoked" },
			});
			await expect(
				outcome({ operationId, action: "clock_in" }, "z8k_t1363-unknown-token"),
			).resolves.toMatchObject({ status: 401, body: { code: "kiosk_unknown" } });
			await expect(
				outcome({ operationId: "not-a-uuid", action: "clock_in" }, tokens.back),
			).resolves.toEqual({
				status: 400,
				body: { code: "invalid_request" },
			});
			const { rows } = await admin.query(
				"select state from kiosk_clock_attempt where operation_id = $1 order by created_at",
				[operationId],
			);
			// The revoked kiosk's question closed nothing; its attempt stays committed.
			expect(rows).toEqual([{ state: "committed" }]);
		});

		it("claims nothing for an action sent without an operation identity", async () => {
			await clock({ action: "clock_in" });
			const { rows } = await admin.query(
				"select count(*)::int as count from kiosk_clock_attempt where organization_id = $1",
				[ids.organization],
			);
			expect(only(rows)).toEqual({ count: 0 });
		});
	});
});
