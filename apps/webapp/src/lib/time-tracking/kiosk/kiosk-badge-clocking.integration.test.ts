/**
 * #1366 (spec #889): kiosk badge clocking on PostgreSQL, through the kiosk
 * endpoints' service. A badge read by the kiosk's attached scanner replaces the
 * PIN: it identifies the employee inside the kiosk's organization, and every
 * action runs Clocking with the kiosk principal, in both admissions. Badge,
 * kiosk, scanner setting, employment and assignment are checked again at the
 * protected write boundary.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Real kiosk authentication, badge issuance and verification, coordinated work
 * transactions and Clocking. Only billing provisioning and the Next
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
const { proveKioskBadge } = await import("@/lib/time-tracking/clocking/kiosk");
const { setOwnKioskPin } = await import("@/lib/time-tracking/kiosk/pin-store");
const { issueKioskBadge, replaceKioskBadge, revokeKioskBadge } = await import("./badge-store");
const { renderKioskBadgePdf } = await import("./badge-pdf");
const { pdfQrCodeText } = await import("./badge-pdf.test.fixture");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskClockService } = await import("./clock-service");
const { withAuditTrail } = await import("@/lib/audit-trail");
const { updateKiosk } = await import("./kiosk-store");
type ClockPrincipal = import("@/lib/time-tracking/clocking/types").ClockPrincipal;
type KioskPinProof = import("@/lib/time-tracking/clocking/types").KioskPinProof;

const ids = {
	organization: "t1366-kiosk-org",
	otherOrganization: "t1366-kiosk-other-org",
	workerUser: "t1366-worker-user",
	kioskOnlyUser: "t1366-kiosk-only-user",
	strangerUser: "t1366-stranger-user",
	managerUser: "t1366-manager-user",
	foreignUser: "t1366-foreign-user",
	worker: "f1366000-0000-4000-8000-000000000001",
	kioskOnly: "f1366000-0000-4000-8000-000000000002",
	stranger: "f1366000-0000-4000-8000-000000000003",
	manager: "f1366000-0000-4000-8000-000000000004",
	foreign: "f1366000-0000-4000-8000-000000000005",
	store: "f1366000-0000-4000-8000-000000000011",
	warehouse: "f1366000-0000-4000-8000-000000000012",
	foreignStore: "f1366000-0000-4000-8000-000000000013",
	kiosk: "f1366000-0000-4000-8000-000000000021",
	pinOnlyKiosk: "f1366000-0000-4000-8000-000000000022",
	revokedKiosk: "f1366000-0000-4000-8000-000000000023",
	foreignKiosk: "f1366000-0000-4000-8000-000000000024",
} as const;
const users = [
	ids.workerUser,
	ids.kioskOnlyUser,
	ids.strangerUser,
	ids.managerUser,
	ids.foreignUser,
];
const tokens = {
	kiosk: "z8k_t1366-store-kiosk-token",
	pinOnly: "z8k_t1366-pin-only-kiosk-token",
	revoked: "z8k_t1366-revoked-kiosk-token",
	foreign: "z8k_t1366-foreign-kiosk-token",
} as const;
const PIN = "4711";
const KIOSK_ZONE = "Europe/Berlin";
const NOT_ACCEPTED = { status: 403, body: { code: "badge_not_accepted" } };

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("kiosk badge clocking on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant("2026-07-22T06:00:00Z");
	const clockPort = { nowInstant: () => now };
	/** Each badge's credential by employee, as its printed QR code holds it. */
	let badges: Record<string, string> = {};
	let pinAttempts: string[] = [];
	let badgeAttempts: string[] = [];

	function newService(options: { badgeLimit?: { allowed: boolean; retryAfter: number } } = {}) {
		const followUps = recordingFollowUps();
		const clocking = createClocking({
			clock: clockPort as never,
			transactions: coordinatedTransactions(),
			followUps,
		});
		const service = createKioskClockService({
			clocking,
			clock: clockPort,
			limitPinAttempts: async (kioskId) => {
				pinAttempts.push(kioskId);
				return { allowed: true, retryAfter: 0 };
			},
			limitBadgeAttempts: async (kioskId) => {
				badgeAttempts.push(kioskId);
				return options.badgeLimit ?? { allowed: true, retryAfter: 0 };
			},
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

	async function answer(response: Response) {
		return { status: response.status, body: await response.json() };
	}

	/** A badge scan on the kiosk's home screen: who it is, their state and day total. */
	async function scan(badge: string, token?: string) {
		return answer(
			await newService().service.status(kioskRequest("employee-status", { badge }, token)),
		);
	}

	/** An explicit action on a badge turn. */
	async function act(badge: string, body: Record<string, unknown>, token?: string) {
		return answer(
			await newService().service.clock(kioskRequest("clock", { badge, ...body }, token)),
		);
	}

	async function outcome(body: Record<string, unknown>, token?: string) {
		return answer(await newService().service.outcome(kioskRequest("clock/outcome", body, token)));
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
			type: string;
			device_info: string | null;
			created_by: string;
			timezone: string | null;
			utc_offset_minutes: number;
		}>(
			`select type, device_info, created_by, timezone, utc_offset_minutes
			 from time_entry where employee_id = $1 order by timestamp, created_at`,
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

	const nothing = { entries: 0, periods: 0, receipts: 0 };

	async function issueBadge(
		employeeId: string,
		organizationId: string = ids.organization,
		actorUserId: string = ids.managerUser,
	) {
		const issued = await issueKioskBadge(
			db,
			{ organizationId, actorUserId, employeeId },
			async ({ credential }) => credential,
			clockPort,
		);
		badges[employeeId] = issued.delivery;
		return issued.delivery;
	}

	const manage = (employeeId: string) => ({
		organizationId: ids.organization,
		actorUserId: ids.managerUser,
		employeeId,
	});

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
			 ($1, 'T1366 kiosk', $1, 'Europe/Berlin', $3), ($2, 'T1366 other', $2, 'UTC', $3)`,
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
			 ($1, 'Wanda Worker', 't1366-worker@example.test', $6, $6),
			 ($2, 'Kim Kiosk', 'kiosk-t1366@kiosk.invalid', $6, $6),
			 ($3, 'Sam Stranger', 't1366-stranger@example.test', $6, $6),
			 ($4, 'Mona Manager', 't1366-manager@example.test', $6, $6),
			 ($5, 'Fay Foreign', 't1366-foreign@example.test', $6, $6)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1366-m-worker', $1, $3, 'member', 'approved', $8),
			 ('t1366-m-kiosk-only', $1, $4, 'member', 'approved', $8),
			 ('t1366-m-stranger', $1, $5, 'member', 'approved', $8),
			 ('t1366-m-manager', $1, $6, 'admin', 'approved', $8),
			 ('t1366-m-foreign', $2, $7, 'owner', 'approved', $8)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.workerUser,
				ids.kioskOnlyUser,
				ids.strangerUser,
				ids.managerUser,
				ids.foreignUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $11, 'employee', true, $13),
			 ($3, $4, $11, 'employee', true, $13),
			 ($5, $6, $11, 'employee', true, $13),
			 ($7, $8, $11, 'manager', true, $13),
			 ($9, $10, $12, 'admin', true, $13)`,
			[
				ids.worker,
				ids.workerUser,
				ids.kioskOnly,
				ids.kioskOnlyUser,
				ids.stranger,
				ids.strangerUser,
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
			[[ids.worker, ids.kioskOnly, ids.stranger, ids.foreign], timestamp],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 select employee_id, $2, true, $3 from unnest($1::uuid[]) as employee_id`,
			[[ids.worker, ids.kioskOnly, ids.stranger], ids.manager, ids.managerUser],
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
			                    revoked_at, badge_scanner_enabled, created_by, updated_at) values
			 ($1, $5, $6, 'Store kiosk', $9, $10, $14, null, true, $15, $14),
			 ($2, $5, $6, 'PIN-only kiosk', $9, $11, $14, null, false, $15, $14),
			 ($3, $5, $6, 'Old kiosk', $9, $12, $14, $14, true, $15, $14),
			 ($4, $7, $8, 'Foreign kiosk', 'UTC', $13, $14, null, true, $16, $14)`,
			[
				ids.kiosk,
				ids.pinOnlyKiosk,
				ids.revokedKiosk,
				ids.foreignKiosk,
				ids.organization,
				ids.store,
				ids.otherOrganization,
				ids.foreignStore,
				KIOSK_ZONE,
				hashKioskSecret(tokens.kiosk),
				hashKioskSecret(tokens.pinOnly),
				hashKioskSecret(tokens.revoked),
				hashKioskSecret(tokens.foreign),
				timestamp,
				ids.managerUser,
				ids.foreignUser,
			],
		);
		// The worker and the kiosk-only employee work at the store; the stranger only at the warehouse.
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id) values
			 ($1, $2, $5), ($1, $3, $5), ($1, $4, $6)`,
			[ids.organization, ids.worker, ids.kioskOnly, ids.stranger, ids.store, ids.warehouse],
		);
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id)
			 values ($1, $2, $3)`,
			[ids.otherOrganization, ids.foreign, ids.foreignStore],
		);
		await setOwnKioskPin(db, {
			organizationId: ids.organization,
			userId: ids.workerUser,
			pin: PIN,
		});
		badges = {};
		await issueBadge(ids.worker);
		await issueBadge(ids.kioskOnly);
		await issueBadge(ids.stranger);
		await issueBadge(ids.foreign, ids.otherOrganization, ids.foreignUser);
	}

	beforeEach(async () => {
		harness.billing = { canAccess: true };
		now = parseInstant("2026-07-22T06:00:00Z");
		pinAttempts = [];
		badgeAttempts = [];
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	const worker = () => badges[ids.worker] ?? "";

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (_admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("identifies the employee from a scanned badge without a PIN and writes no work", async () => {
			const scanned = await scan(worker());

			expect(scanned).toEqual({
				status: 200,
				body: {
					employee: { id: ids.worker, name: "Wanda Worker" },
					state: { status: "clocked_out" },
					dayTotal: { date: "2026-07-22", timezone: "UTC", minutes: 0 },
				},
			});
			expect(await work()).toEqual(nothing);
			// A scan is no PIN attempt.
			expect(pinAttempts).toEqual([]);
			expect(badgeAttempts).toEqual([ids.kiosk]);
		});

		it("clocks in, breaks, resumes and ends the day on a break, recording the kiosk on every entry", async () => {
			const { service, followUps } = newService();
			const run = async (body: Record<string, unknown>) =>
				answer(await service.clock(kioskRequest("clock", { badge: worker(), ...body })));

			const clockedIn = await run({ action: "clock_in", operationId: randomUUID() });
			now = parseInstant("2026-07-22T10:00:00Z");
			const started = await run({ action: "start_break", operationId: randomUUID() });
			now = parseInstant("2026-07-22T10:30:00Z");
			const resumed = await run({ action: "resume_break", operationId: randomUUID() });
			now = parseInstant("2026-07-22T13:00:00Z");
			await run({ action: "start_break", operationId: randomUUID() });
			now = parseInstant("2026-07-22T13:45:00Z");
			const endOfDay = await run({ action: "clock_out", operationId: randomUUID() });

			expect(clockedIn).toEqual({
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
					dayTotal: { date: "2026-07-22", timezone: "UTC", minutes: 0 },
				},
			});
			expect(started).toMatchObject({
				status: 200,
				body: { action: "start_break", state: { status: "on_break" } },
			});
			expect(resumed).toMatchObject({
				status: 200,
				body: { at: { instant: "2026-07-22T10:30:00Z" }, state: { status: "clocked_in" } },
			});
			// The day ends at the open break's start.
			expect(endOfDay).toMatchObject({
				status: 200,
				body: {
					at: { instant: "2026-07-22T13:00:00Z", zone: KIOSK_ZONE },
					state: { status: "clocked_out" },
					dayTotal: { minutes: 390 },
				},
			});
			expect(
				(await entries()).map((entry) => [
					entry.type,
					entry.device_info,
					entry.created_by,
					entry.timezone,
					entry.utc_offset_minutes,
				]),
			).toEqual([
				["clock_in", `kiosk:${ids.kiosk}`, ids.workerUser, KIOSK_ZONE, 120],
				["clock_out", `kiosk:${ids.kiosk}`, ids.workerUser, KIOSK_ZONE, 120],
				["clock_in", `kiosk:${ids.kiosk}`, ids.workerUser, KIOSK_ZONE, 120],
				["clock_out", `kiosk:${ids.kiosk}`, ids.workerUser, KIOSK_ZONE, 120],
			]);
			// The resume and the end of the day closed work and ran the clock-out follow-ups.
			expect(followUps.closures).toHaveLength(2);
			const { rows: receipts } = await admin.query(
				`select kind, writer, actor_kind, kiosk_id from completed_work_operation
				 where employee_id = $1 order by created_at`,
				[ids.worker],
			);
			if (mode === "inactive") {
				expect(receipts).toEqual([]);
			} else {
				const kiosk = { writer: "kiosk_clock", actor_kind: "kiosk", kiosk_id: ids.kiosk };
				expect(receipts).toEqual([
					{ kind: "start_live_work", ...kiosk },
					{ kind: "close_resume_work", ...kiosk },
					{ kind: "close_active_work", ...kiosk },
				]);
			}
		});

		it("captures each event's own offset across the autumn clock change", async () => {
			// Europe/Berlin leaves summer time at 2026-10-25T01:00:00Z.
			now = parseInstant("2026-10-25T00:30:00Z");
			await act(worker(), { action: "clock_in", operationId: randomUUID() });
			now = parseInstant("2026-10-25T01:30:00Z");
			const out = await act(worker(), { action: "clock_out", operationId: randomUUID() });

			expect(out).toMatchObject({ status: 200, body: { outcome: "executed" } });
			expect((await entries()).map((entry) => [entry.type, entry.utc_offset_minutes])).toEqual([
				["clock_in", 120],
				["clock_out", 60],
			]);
		});

		it("lets a kiosk-only employee clock with a badge", async () => {
			const badge = badges[ids.kioskOnly] ?? "";

			expect((await scan(badge)).body).toMatchObject({ employee: { id: ids.kioskOnly } });
			expect(await act(badge, { action: "clock_in", operationId: randomUUID() })).toMatchObject({
				status: 200,
				body: { outcome: "executed" },
			});
			expect(await entries(ids.kioskOnly)).toHaveLength(1);
		});

		it("replays a retried action with the same operation instead of clocking twice", async () => {
			const operationId = randomUUID();
			await act(worker(), { action: "clock_in", operationId });
			now = parseInstant("2026-07-22T06:01:00Z");

			expect(await act(worker(), { action: "clock_in", operationId })).toMatchObject({
				status: 200,
				body: { outcome: "replayed" },
			});
			expect(await entries()).toHaveLength(1);
		});

		it("refuses an action whose badge was revoked after the scan, without recording work", async () => {
			expect((await scan(worker())).status).toBe(200);
			await revokeKioskBadge(db, manage(ids.worker), clockPort);

			expect(await act(worker(), { action: "clock_in", operationId: randomUUID() })).toEqual(
				NOT_ACCEPTED,
			);
			expect(await work()).toEqual(nothing);
		});

		it("rechecks the badge inside the work transaction while a revocation is committing", async () => {
			const holder = await admin.connect();
			try {
				await holder.query("begin");
				// The revocation has written but not committed: the action's first check still sees the badge.
				await holder.query(
					`update employee_kiosk_badge set revoked_at = now(), revoked_reason = 'revoked'
					 where employee_id = $1 and revoked_at is null`,
					[ids.worker],
				);
				const { rows } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
				const action = act(worker(), { action: "clock_in", operationId: randomUUID() });
				await waitForWaiter(only(rows).pid);
				await holder.query("commit");

				await expect(action).resolves.toEqual(NOT_ACCEPTED);
			} finally {
				holder.release();
			}
			expect(await work()).toEqual(nothing);
		});

		it("rechecks the assignment inside the work transaction while an unassignment is committing", async () => {
			const holder = await admin.connect();
			try {
				await holder.query("begin");
				await holder.query("delete from employee_assigned_location where employee_id = $1", [
					ids.worker,
				]);
				const { rows } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
				const action = act(worker(), { action: "clock_in", operationId: randomUUID() });
				await waitForWaiter(only(rows).pid);
				await holder.query("commit");

				await expect(action).resolves.toEqual(NOT_ACCEPTED);
			} finally {
				holder.release();
			}
			expect(await work()).toEqual(nothing);
		});
	});

	/** The backend blocked (directly) by another one's locks. */
	async function waitForWaiter(blockingPid: number) {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const { rows } = await admin.query<{ pid: number }>(
				`select pid from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'
				   and $1 = any(pg_blocking_pids(pid))`,
				[blockingPid],
			);
			if (rows[0]) return rows[0].pid;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`Timed out waiting for a backend blocked by ${blockingPid}`);
	}

	describe("refusals", () => {
		beforeEach(async () => {
			await setAdmission("active");
		});

		it("accepts the credential the issued PDF's QR code carries", async () => {
			const replaced = await replaceKioskBadge(
				db,
				manage(ids.worker),
				({ credential, employeeName, organizationName }) =>
					renderKioskBadgePdf({
						credential,
						employeeName,
						organizationName,
						labels: { title: "Kiosk badge", instructions: "Keep it private." },
					}),
				clockPort,
			);
			const printed = pdfQrCodeText(replaced.delivery) ?? "";

			expect((await scan(printed)).body).toMatchObject({ employee: { id: ids.worker } });
			// The replaced badge stopped working at once.
			expect(await scan(worker())).toEqual(NOT_ACCEPTED);
		});

		it.each([
			["an unreadable code", () => "https://example.test/kiosk?code=ABCDE-FGHJK"],
			["an unknown badge", () => `K8B${"2".repeat(53)}`],
			["another organization's badge", () => badges[ids.foreign] ?? ""],
			[
				"the badge of an employee not assigned to the kiosk's location",
				() => badges[ids.stranger] ?? "",
			],
		])("refuses %s without naming anyone", async (_case, badge) => {
			expect(await scan(badge())).toEqual(NOT_ACCEPTED);
			expect(await act(badge(), { action: "clock_in", operationId: randomUUID() })).toEqual(
				NOT_ACCEPTED,
			);
			for (const employeeId of [ids.worker, ids.stranger, ids.foreign]) {
				expect(await work(employeeId)).toEqual(nothing);
			}
		});

		it("refuses an inactive employee's badge", async () => {
			await admin.query("update employee set is_active = false where id = $1", [ids.worker]);

			expect(await scan(worker())).toEqual(NOT_ACCEPTED);
			expect(await work()).toEqual(nothing);
		});

		it("refuses a badge whose employee's scheduled departure cutoff passed after the scan", async () => {
			expect((await scan(worker())).status).toBe(200);
			const { rows } = await admin.query<{ id: string }>(
				"select id from employee_employment_period where employee_id = $1",
				[ids.worker],
			);
			await admin.query(
				`insert into employee_departure
				 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
				  cutoff_at, revision, status, created_by, request_id, request_fingerprint)
				 values ($1, $2, $3, 'scheduled', '2026-07-21', $4, '2026-07-22T06:30:00Z', 1, 'pending',
				         $5, $6, 't1366')`,
				[ids.organization, ids.worker, only(rows).id, KIOSK_ZONE, ids.managerUser, randomUUID()],
			);
			now = parseInstant("2026-07-22T06:45:00Z");

			expect(await act(worker(), { action: "clock_in", operationId: randomUUID() })).toEqual(
				NOT_ACCEPTED,
			);
			expect(await work()).toEqual(nothing);
		});

		it("refuses an action after the employee was unassigned since the scan", async () => {
			expect((await scan(worker())).status).toBe(200);
			await admin.query("delete from employee_assigned_location where employee_id = $1", [
				ids.worker,
			]);

			expect(await act(worker(), { action: "clock_in", operationId: randomUUID() })).toEqual(
				NOT_ACCEPTED,
			);
			expect(await work()).toEqual(nothing);
		});

		it("never lets a client-supplied employee redirect a valid badge", async () => {
			expect(
				await act(worker(), {
					employeeId: ids.kioskOnly,
					action: "clock_in",
					operationId: randomUUID(),
				}),
			).toEqual(NOT_ACCEPTED);
			expect(await work(ids.kioskOnly)).toEqual(nothing);
			expect(await work()).toEqual(nothing);
			// The badge's own employee, when named, is fine.
			expect(
				await act(worker(), {
					employeeId: ids.worker,
					action: "clock_in",
					operationId: randomUUID(),
				}),
			).toMatchObject({ status: 200 });
		});

		it("refuses a badge and a PIN together", async () => {
			const response = await answer(
				await newService().service.clock(
					kioskRequest("clock", {
						badge: worker(),
						employeeId: ids.worker,
						pin: PIN,
						action: "clock_in",
					}),
				),
			);
			expect(response).toEqual({ status: 400, body: { code: "invalid_request" } });
			expect(await work()).toEqual(nothing);
		});

		it("refuses badges at a kiosk whose scanner input is off, while PINs still work there", async () => {
			expect(await scan(worker(), tokens.pinOnly)).toEqual({
				status: 403,
				body: { code: "badge_input_disabled" },
			});
			expect(badgeAttempts).toEqual([]);
			const pin = await answer(
				await newService().service.clock(
					kioskRequest(
						"clock",
						{ employeeId: ids.worker, pin: PIN, action: "clock_in" },
						tokens.pinOnly,
					),
				),
			);
			expect(pin).toMatchObject({ status: 200, body: { outcome: "executed" } });
		});

		it("refuses an action after the scanner input was switched off since the scan", async () => {
			expect((await scan(worker())).status).toBe(200);
			await withAuditTrail((audit) =>
				db.transaction((tx) =>
					updateKiosk(tx, audit, {
						organizationId: ids.organization,
						actorUserId: ids.managerUser,
						kioskId: ids.kiosk,
						change: { badgeScannerEnabled: false },
					}),
				),
			);

			expect(await act(worker(), { action: "clock_in", operationId: randomUUID() })).toEqual({
				status: 403,
				body: { code: "badge_input_disabled" },
			});
			expect(await work()).toEqual(nothing);
		});

		it("refuses a revoked kiosk", async () => {
			expect(await scan(worker(), tokens.revoked)).toMatchObject({
				status: 401,
				body: { code: "kiosk_revoked" },
			});
		});

		it("counts badge calls against the kiosk's badge limit, never its PIN limit or lockout", async () => {
			for (let attempt = 0; attempt < 6; attempt++) {
				expect(await scan(`K8B${"3".repeat(53)}`)).toEqual(NOT_ACCEPTED);
			}
			const limited = await answer(
				await newService({ badgeLimit: { allowed: false, retryAfter: 17 } }).service.status(
					kioskRequest("employee-status", { badge: worker() }),
				),
			);

			expect(limited).toEqual({ status: 429, body: { code: "rate_limited", retryAfter: 17 } });
			expect(pinAttempts).toEqual([]);
			const { rows } = await admin.query(
				`select count(*)::int as count from employee_kiosk_pin_event
				 where employee_id = $1 and kind = 'failure'`,
				[ids.worker],
			);
			expect(only(rows)).toEqual({ count: 0 });
			// The PIN still works at once: badge failures never locked it.
			expect(
				(
					await answer(
						await newService().service.status(
							kioskRequest("employee-status", { employeeId: ids.worker, pin: PIN }),
						),
					)
				).status,
			).toBe(200);
		});

		it("never stores the credential with the work, the attempt or the audit trail", async () => {
			await act(worker(), { action: "clock_in", operationId: randomUUID() });
			const { rows } = await admin.query(
				`select (select json_agg(t) from time_entry t where employee_id = $1) as entries,
				        (select json_agg(r) from completed_work_operation r where employee_id = $1) as receipts,
				        (select json_agg(a) from kiosk_clock_attempt a where employee_id = $1) as attempts,
				        (select json_agg(l) from audit_log l where organization_id = $2) as audit`,
				[ids.worker, ids.organization],
			);
			const stored = JSON.stringify(rows);
			expect(stored).toContain(ids.worker);
			expect(stored).not.toContain(worker());
		});
	});

	describe("recovery", () => {
		beforeEach(async () => {
			await setAdmission("active");
		});

		it("answers a committed badge action with its original time, also after the badge was revoked", async () => {
			const operationId = randomUUID();
			const original = await act(worker(), { action: "clock_in", operationId });
			await revokeKioskBadge(db, manage(ids.worker), clockPort);
			now = parseInstant("2026-07-22T06:05:00Z");

			const recovered = await outcome({ operationId, employeeId: ids.worker, action: "clock_in" });

			expect(recovered).toEqual({
				status: 200,
				body: { outcome: "committed", action: "clock_in", at: original.body.at },
			});
			expect(await entries()).toHaveLength(1);
		});

		it("closes a badge attempt nothing recorded, so the late original never commits", async () => {
			const operationId = randomUUID();
			expect(await outcome({ operationId, employeeId: ids.worker, action: "clock_in" })).toEqual({
				status: 200,
				body: { outcome: "not_recorded" },
			});

			expect(await act(worker(), { action: "clock_in", operationId })).toMatchObject({
				status: 409,
				body: { code: "attempt_closed" },
			});
			expect(await work()).toEqual(nothing);
		});
	});

	/**
	 * #1367: the same badges read with the kiosk's camera. The kiosk says which
	 * input read the badge (`badgeInput: "camera"`; without it, the attached
	 * scanner), and each input counts only while its own switch is on.
	 */
	describe("camera input (#1367)", () => {
		async function setInputs(inputs: { scanner: boolean; camera: boolean }) {
			await admin.query(
				`update kiosk set badge_scanner_enabled = $2, badge_camera_enabled = $3
				 where organization_id = $4 and id = $1`,
				[ids.kiosk, inputs.scanner, inputs.camera, ids.organization],
			);
		}

		async function cameraScan(badge: string, token?: string) {
			return answer(
				await newService().service.status(
					kioskRequest("employee-status", { badge, badgeInput: "camera" }, token),
				),
			);
		}

		const DISABLED = { status: 403, body: { code: "badge_input_disabled" } };

		async function switchKiosk(change: {
			badgeScannerEnabled?: boolean;
			badgeCameraEnabled?: boolean;
		}) {
			await withAuditTrail((audit) =>
				db.transaction((tx) =>
					updateKiosk(tx, audit, {
						organizationId: ids.organization,
						actorUserId: ids.managerUser,
						kioskId: ids.kiosk,
						change,
					}),
				),
			);
		}

		describe.each([
			["legacy", "inactive"],
			["append", "active"],
		] as const)("%s admission", (_admission, mode) => {
			beforeEach(async () => {
				await setAdmission(mode);
				await setInputs({ scanner: false, camera: true });
			});

			it("identifies the employee from a camera-read badge, then clocks on an explicit action", async () => {
				const scanned = await cameraScan(worker());
				expect(scanned).toMatchObject({
					status: 200,
					body: {
						employee: { id: ids.worker, name: "Wanda Worker" },
						state: { status: "clocked_out" },
					},
				});
				expect(await work()).toEqual(nothing);
				expect(pinAttempts).toEqual([]);
				expect(badgeAttempts).toEqual([ids.kiosk]);

				const operationId = randomUUID();
				const clocked = await act(worker(), {
					badgeInput: "camera",
					employeeId: ids.worker,
					action: "clock_in",
					operationId,
				});
				expect(clocked).toMatchObject({
					status: 200,
					body: { outcome: "executed", at: { instant: "2026-07-22T06:00:00Z", zone: KIOSK_ZONE } },
				});
				expect((await entries()).map((entry) => [entry.type, entry.device_info])).toEqual([
					["clock_in", `kiosk:${ids.kiosk}`],
				]);
				// The #1363 recovery contract holds for camera actions too.
				expect(await outcome({ operationId, employeeId: ids.worker, action: "clock_in" })).toEqual({
					status: 200,
					body: { outcome: "committed", action: "clock_in", at: clocked.body.at },
				});
			});

			it("rechecks a camera badge inside the work transaction while a revocation is committing", async () => {
				const holder = await admin.connect();
				try {
					await holder.query("begin");
					await holder.query(
						`update employee_kiosk_badge set revoked_at = now(), revoked_reason = 'revoked'
						 where employee_id = $1 and revoked_at is null`,
						[ids.worker],
					);
					const { rows } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
					const action = act(worker(), {
						badgeInput: "camera",
						action: "clock_in",
						operationId: randomUUID(),
					});
					await waitForWaiter(only(rows).pid);
					await holder.query("commit");

					await expect(action).resolves.toEqual(NOT_ACCEPTED);
				} finally {
					holder.release();
				}
				expect(await work()).toEqual(nothing);
			});
		});

		describe("its switch", () => {
			beforeEach(async () => {
				await setAdmission("active");
			});

			it("accepts each input only while its own switch is on", async () => {
				await setInputs({ scanner: false, camera: true });
				expect(await scan(worker())).toEqual(DISABLED);
				expect((await cameraScan(worker())).status).toBe(200);

				await setInputs({ scanner: true, camera: false });
				expect(await cameraScan(worker())).toEqual(DISABLED);
				expect(
					await act(worker(), {
						badgeInput: "camera",
						action: "clock_in",
						operationId: randomUUID(),
					}),
				).toEqual(DISABLED);
				expect((await scan(worker())).status).toBe(200);
				expect(await work()).toEqual(nothing);

				await setInputs({ scanner: false, camera: false });
				expect(await cameraScan(worker())).toEqual(DISABLED);
				expect(await scan(worker())).toEqual(DISABLED);
			});

			it("refuses a camera action after the camera was switched off since the scan, while the scanner keeps working", async () => {
				await setInputs({ scanner: true, camera: true });
				expect((await cameraScan(worker())).status).toBe(200);
				await switchKiosk({ badgeCameraEnabled: false });

				expect(
					await act(worker(), {
						badgeInput: "camera",
						action: "clock_in",
						operationId: randomUUID(),
					}),
				).toEqual(DISABLED);
				expect(await work()).toEqual(nothing);
				expect(
					await act(worker(), { action: "clock_in", operationId: randomUUID() }),
				).toMatchObject({ status: 200, body: { outcome: "executed" } });
			});

			it("keeps refusing what a badge does not prove, whichever input read it", async () => {
				await setInputs({ scanner: false, camera: true });
				for (const badge of [
					`K8B${"2".repeat(53)}`,
					badges[ids.foreign] ?? "",
					badges[ids.stranger] ?? "",
				]) {
					expect(await cameraScan(badge)).toEqual(NOT_ACCEPTED);
				}
				expect(
					await act(worker(), {
						badgeInput: "camera",
						employeeId: ids.kioskOnly,
						action: "clock_in",
						operationId: randomUUID(),
					}),
				).toEqual(NOT_ACCEPTED);
				for (const employeeId of [ids.worker, ids.kioskOnly, ids.stranger, ids.foreign]) {
					expect(await work(employeeId)).toEqual(nothing);
				}
			});

			it("refuses an input it does not know", async () => {
				await setInputs({ scanner: true, camera: true });
				for (const badgeInput of ["photo", "nfc", 1]) {
					expect(
						await answer(
							await newService().service.status(
								kioskRequest("employee-status", { badge: worker(), badgeInput }),
							),
						),
					).toEqual({ status: 400, body: { code: "invalid_request" } });
				}
				// A PIN call names no badge input.
				expect(
					await answer(
						await newService().service.status(
							kioskRequest("employee-status", {
								employeeId: ids.worker,
								pin: PIN,
								badgeInput: "camera",
							}),
						),
					),
				).toEqual({ status: 400, body: { code: "invalid_request" } });
				expect(badgeAttempts).toEqual([]);
			});
		});
	});

	describe("Clocking's own badge authorization", () => {
		beforeEach(async () => {
			await setAdmission("active");
		});

		function clockIn(principal: ClockPrincipal) {
			return createClocking({
				clock: clockPort as never,
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
			});
		}

		const principal = (proof: KioskPinProof): ClockPrincipal => ({
			kind: "kiosk",
			kioskId: ids.kiosk,
			userId: ids.workerUser,
			pin: proof,
		});

		it("refuses a badge proof built without the badge check", async () => {
			const { rows } = await admin.query<{ id: string }>(
				"select id from employee_kiosk_badge where employee_id = $1",
				[ids.worker],
			);
			const forged = {
				organizationId: ids.organization,
				kioskId: ids.kiosk,
				employeeId: ids.worker,
				badge: { badgeId: only(rows).id },
			};

			await expect(clockIn(principal(forged))).resolves.toEqual({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(await work()).toEqual(nothing);
		});

		it("refuses a badge proof whose badge was revoked before the action, even without the endpoint", async () => {
			const proven = await proveKioskBadge(db, {
				organizationId: ids.organization,
				kioskId: ids.kiosk,
				credential: worker(),
				now,
			});
			if (proven.status !== "verified") throw new Error(proven.status);
			await revokeKioskBadge(db, manage(ids.worker), clockPort);

			await expect(clockIn(principal(proven.proof))).resolves.toEqual({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(await work()).toEqual(nothing);
		});

		it("refuses a camera badge proof once the kiosk's camera input is off, even without the endpoint (#1367)", async () => {
			await admin.query(
				"update kiosk set badge_scanner_enabled = true, badge_camera_enabled = true where id = $1",
				[ids.kiosk],
			);
			const proven = await proveKioskBadge(db, {
				organizationId: ids.organization,
				kioskId: ids.kiosk,
				credential: worker(),
				input: "camera",
				now,
			});
			if (proven.status !== "verified") throw new Error(proven.status);
			await admin.query("update kiosk set badge_camera_enabled = false where id = $1", [ids.kiosk]);

			await expect(clockIn(principal(proven.proof))).resolves.toEqual({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(await work()).toEqual(nothing);
		});
	});

	describe("concurrent kiosk changes", () => {
		const PARK_KEY = 1_366_001;
		let parked: PoolClient | null = null;

		afterEach(async () => {
			if (parked) {
				await parked.query("commit").catch(() => undefined);
				parked.release();
				parked = null;
			}
			await admin.query("drop trigger if exists t1366_park_claim on kiosk_clock_attempt");
			await admin.query("drop function if exists t1366_park_claim()");
		});

		it("holds a scanner switch-off until an action already past its recheck has committed", async () => {
			await setAdmission("active");
			await admin.query(
				`create or replace function t1366_park_claim() returns trigger language plpgsql as $$
				 begin perform pg_advisory_xact_lock(${PARK_KEY}); return new; end $$`,
			);
			await admin.query(
				`create trigger t1366_park_claim after insert on kiosk_clock_attempt
				 for each row when (new.state = 'committed') execute function t1366_park_claim()`,
			);
			parked = await admin.connect();
			await parked.query("begin");
			await parked.query("select pg_advisory_xact_lock($1)", [PARK_KEY]);
			const { rows } = await parked.query<{ pid: number }>("select pg_backend_pid() as pid");

			const action = act(worker(), { action: "clock_in", operationId: randomUUID() });
			const actionPid = await waitForWaiter(only(rows).pid);
			const switchOff = withAuditTrail((audit) =>
				db.transaction((tx) =>
					updateKiosk(tx, audit, {
						organizationId: ids.organization,
						actorUserId: ids.managerUser,
						kioskId: ids.kiosk,
						change: { badgeScannerEnabled: false },
					}),
				),
			);
			// The switch-off waits for the action's kiosk lock.
			await waitForWaiter(actionPid);
			await parked.query("commit");
			parked.release();
			parked = null;

			await expect(action).resolves.toMatchObject({ status: 200, body: { outcome: "executed" } });
			await switchOff;
			expect(await entries()).toHaveLength(1);
			expect(await act(worker(), { action: "clock_out", operationId: randomUUID() })).toEqual({
				status: 403,
				body: { code: "badge_input_disabled" },
			});
		});
	});
});
