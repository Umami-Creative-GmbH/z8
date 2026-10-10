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
					employee: { id: ids.worker, name: "Wanda Worker" },
					state: { status: "clocked_in", workPeriodId: expect.any(String), since: "2026-07-22T06:00:00Z" },
					dayTotal: { date: "2026-07-22", timezone: KIOSK_ZONE, todayMinutes: 0 },
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
	});
});
