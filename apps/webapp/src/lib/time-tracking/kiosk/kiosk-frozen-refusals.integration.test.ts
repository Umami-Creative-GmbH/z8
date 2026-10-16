/**
 * #1290: refused frozen kiosk clock commands on PostgreSQL. Z8 records each
 * refusal once per kiosk and operation, answers resends and lookups from the
 * record, notifies the employee (or a kiosk-only employee's managers), and
 * lists the refusals for owners and admins in the kiosk settings.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The ledger, notifications, PIN judgment, sealing and anchors are the real
 * ones; billing, the Next boundaries and the user session are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
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
								id: `t1290-session-${harness.userId}`,
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

const { createClocking } = await import("@/lib/time-tracking/clocking/clocking");
const { recordingFollowUps } = await import("@/lib/time-tracking/clocking/follow-ups");
const { coordinatedTransactions } = await import("@/lib/time-tracking/clocking/transactions");
const { setOwnKioskPin } = await import("./pin-store");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskFrozenCommandService } = await import("./frozen-command-service");
const { createKioskFrozenRefusalLedger } = await import("./frozen-refusal-store");
const { readKioskSession } = await import("./offline-contact");
const { sealKioskPin } = await import("./pin-seal");
const { kioskSealingKey } = await import("./pin-seal.server");
const settings = await import("@/app/[locale]/(app)/settings/kiosks/actions");
type KioskContactAnchor = import("./frozen-command").KioskContactAnchor;

const ids = {
	organization: "t1290-kiosk-org",
	otherOrganization: "t1290-other-org",
	workerUser: "t1290-worker-user",
	kioskOnlyUser: "t1290-kiosk-only-user",
	managerUser: "t1290-manager-user",
	ownerUser: "t1290-owner-user",
	foreignUser: "t1290-foreign-user",
	worker: "a1290000-0000-4000-8000-000000000001",
	kioskOnly: "a1290000-0000-4000-8000-000000000002",
	manager: "a1290000-0000-4000-8000-000000000003",
	owner: "a1290000-0000-4000-8000-000000000004",
	store: "a1290000-0000-4000-8000-000000000011",
	foreignStore: "a1290000-0000-4000-8000-000000000012",
	kiosk: "a1290000-0000-4000-8000-000000000021",
	revokedKiosk: "a1290000-0000-4000-8000-000000000022",
	foreignKiosk: "a1290000-0000-4000-8000-000000000023",
} as const;
const users = [ids.workerUser, ids.kioskOnlyUser, ids.managerUser, ids.ownerUser, ids.foreignUser];
const tokens = {
	kiosk: "z8k_t1290-store-kiosk-token",
	revoked: "z8k_t1290-revoked-kiosk-token",
} as const;
const SECRET = "t1290-integration-secret-with-at-least-32-characters";
const PIN = "4711";
const KIOSK_ZONE = "Europe/Berlin";
const ARRIVAL = "2026-08-03T12:00:00Z";
const LAST_CONTACT = "2026-08-03T06:00:00Z";

describe("refused frozen kiosk commands on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant(ARRIVAL);
	const clock = { nowInstant: () => now };

	function newService() {
		return createKioskFrozenCommandService({
			clocking: createClocking({
				clock: clock as never,
				transactions: coordinatedTransactions(),
				followUps: recordingFollowUps(),
			}),
			clock,
			secret: () => SECRET,
			refusals: createKioskFrozenRefusalLedger(),
		});
	}

	async function contactAt(): Promise<KioskContactAnchor> {
		const session = await readKioskSession(
			db,
			{
				kioskId: ids.kiosk,
				organizationId: ids.organization,
				locationId: ids.store,
				name: "Store kiosk",
				timezone: KIOSK_ZONE,
				boardEnabled: false,
			},
			tokens.kiosk,
			{ clock: { nowInstant: () => parseInstant(LAST_CONTACT) }, secret: SECRET },
		);
		if (!session.offline) throw new Error("The kiosk has no offline mode");
		return session.offline.contact;
	}

	function command(fields: Record<string, unknown> = {}) {
		return {
			version: 1,
			operationId: randomUUID(),
			kioskId: ids.kiosk,
			employeeId: ids.worker,
			action: "clock_in",
			occurredAt: "2026-08-03T07:00:00Z",
			timeSource: "server_anchor",
			timezone: KIOSK_ZONE,
			workLocationType: "office",
			...fields,
		};
	}

	async function submission(frozen: ReturnType<typeof command>, pin: string = PIN) {
		return {
			command: frozen,
			pin: await sealKioskPin(pin, {
				sealingKey: kioskSealingKey(SECRET),
				kioskId: frozen.kioskId,
				employeeId: frozen.employeeId,
				operationId: frozen.operationId,
			}),
			contact: await contactAt(),
		};
	}

	async function send(body: unknown, token: string = tokens.kiosk) {
		const response = await newService().submit(
			new Request("http://localhost/api/kiosk/commands", {
				method: "POST",
				headers: { "content-type": "application/json", [KIOSK_TOKEN_HEADER]: token },
				body: JSON.stringify(body),
			}),
		);
		return { status: response.status, body: await response.json() };
	}

	async function lookUp(operationId: string) {
		const response = await newService().lookup(
			new Request(`http://localhost/api/kiosk/commands/${operationId}`, {
				headers: { [KIOSK_TOKEN_HEADER]: tokens.kiosk },
			}),
			operationId,
		);
		return { status: response.status, body: await response.json() };
	}

	async function refusalRows() {
		const { rows } = await admin.query<{
			organization_id: string;
			kiosk_id: string;
			operation_id: string;
			employee_id: string | null;
			action: string;
			claimed_at: Date;
			time_source: string;
			reason: string;
			detail: Record<string, unknown>;
			command: Record<string, unknown>;
		}>(
			`select organization_id, kiosk_id, operation_id, employee_id, action, claimed_at, time_source,
			        reason, detail, command
			 from kiosk_frozen_refusal where organization_id = $1 order by refused_at, operation_id`,
			[ids.organization],
		);
		return rows;
	}

	async function inbox(userId: string) {
		const { rows } = await admin.query<{
			type: string;
			title: string;
			message: string;
			metadata: string | null;
		}>(
			`select type, title, message, metadata from notification where user_id = $1 order by created_at`,
			[userId],
		);
		return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata ?? "{}") }));
	}

	async function pinFailures(employeeId: string = ids.worker) {
		const { rows } = await admin.query(
			`select occurred_at from employee_kiosk_pin_event where employee_id = $1 and kind = 'failure'`,
			[employeeId],
		);
		return rows;
	}

	function actAs(userId: string | null, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T1290 kiosk', $1, 'Europe/Berlin', $3), ($2, 'T1290 other', $2, 'UTC', $3)`,
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
			 ($1, 'Wanda Worker', 't1290-worker@example.test', $6, $6),
			 ($2, 'Kim Kiosk', 't1290-kim@kiosk.invalid', $6, $6),
			 ($3, 'Mia Manager', 't1290-manager@example.test', $6, $6),
			 ($4, 'Olga Owner', 't1290-owner@example.test', $6, $6),
			 ($5, 'Fred Foreign', 't1290-foreign@example.test', $6, $6)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1290-m-worker', $1, $2, 'member', 'approved', $7),
			 ('t1290-m-manager', $1, $3, 'member', 'approved', $7),
			 ('t1290-m-owner', $1, $4, 'owner', 'approved', $7),
			 ('t1290-m-foreign', $5, $6, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.workerUser,
				ids.managerUser,
				ids.ownerUser,
				ids.otherOrganization,
				ids.foreignUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $9, 'employee', true, $10), ($3, $4, $9, 'employee', true, $10),
			 ($5, $6, $9, 'manager', true, $10), ($7, $8, $9, 'admin', true, $10)`,
			[
				ids.worker,
				ids.workerUser,
				ids.kioskOnly,
				ids.kioskOnlyUser,
				ids.manager,
				ids.managerUser,
				ids.owner,
				ids.ownerUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.kioskOnly, ids.manager, ids.ownerUser],
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
				ids.ownerUser,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, token_hash, paired_at,
			                    revoked_at, offline_mode_enabled, created_by, updated_at) values
			 ($1, $3, $4, 'Store kiosk', $5, $6, $8, null, true, $9, $8),
			 ($2, $3, $4, 'Old kiosk', $5, $7, $8, $8, true, $9, $8),
			 ($10, $11, $12, 'Foreign kiosk', 'UTC', null, null, null, false, $13, $8)`,
			[
				ids.kiosk,
				ids.revokedKiosk,
				ids.organization,
				ids.store,
				KIOSK_ZONE,
				hashKioskSecret(tokens.kiosk),
				hashKioskSecret(tokens.revoked),
				timestamp,
				ids.ownerUser,
				ids.foreignKiosk,
				ids.otherOrganization,
				ids.foreignStore,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id) values
			 ($1, $2, $4), ($1, $3, $4)`,
			[ids.organization, ids.worker, ids.kioskOnly, ids.store],
		);
		const pinSetAt = { nowInstant: () => parseInstant("2026-07-01T00:00:00Z") };
		for (const userId of [ids.workerUser, ids.kioskOnlyUser]) {
			await setOwnKioskPin(db, { organizationId: ids.organization, userId, pin: PIN }, pinSetAt);
		}
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization],
		);
	}

	beforeEach(async () => {
		now = parseInstant(ARRIVAL);
		actAs(null);
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("recording", () => {
		it("records a refused command once, organization-scoped, with what it claimed", async () => {
			const frozen = command();
			const response = await send(await submission(frozen, "9999"));

			expect(response).toMatchObject({ status: 403, body: { code: "wrong_pin" } });
			expect(await refusalRows()).toEqual([
				{
					organization_id: ids.organization,
					kiosk_id: ids.kiosk,
					operation_id: frozen.operationId,
					employee_id: ids.worker,
					action: "clock_in",
					claimed_at: new Date("2026-08-03T07:00:00Z"),
					time_source: "server_anchor",
					reason: "wrong_pin",
					detail: {},
					command: frozen,
				},
			]);
		});

		it("answers a resend from the record: no second row, PIN failure or notification", async () => {
			const frozen = command();
			const body = await submission(frozen, "9999");
			const first = await send(body);

			expect(await send(body)).toEqual(first);
			expect(await refusalRows()).toHaveLength(1);
			expect(await pinFailures()).toHaveLength(1);
			expect(await inbox(ids.workerUser)).toHaveLength(1);
		});

		it("answers the kiosk's lookup with the recorded refusal and its details", async () => {
			await admin.query(
				`insert into employee_kiosk_pin_event (organization_id, employee_id, kind, offline, occurred_at)
				 select $1, $2, 'failure', false, $3 from generate_series(1, 5)`,
				[ids.organization, ids.worker, new Date("2026-08-03T06:55:00Z")],
			);
			const frozen = command();
			await send(await submission(frozen));

			expect(await lookUp(frozen.operationId)).toEqual({
				status: 200,
				body: {
					outcome: "refused",
					operationId: frozen.operationId,
					code: "pin_locked",
					lockedUntil: "2026-08-03T07:10:00Z",
				},
			});
		});

		it("refuses other bytes under a refused operation as a collision, without recording them", async () => {
			const frozen = command();
			await send(await submission(frozen, "9999"));

			const other = { ...frozen, occurredAt: "2026-08-03T07:01:00Z" };
			expect(await send(await submission(other))).toMatchObject({
				status: 409,
				body: { outcome: "refused", code: "collision" },
			});
			expect(await refusalRows()).toHaveLength(1);
			expect(await pinFailures()).toHaveLength(1);
		});

		it("records a revoked kiosk's commands under that kiosk", async () => {
			const frozen = command({ kioskId: ids.revokedKiosk, occurredAt: "2026-07-01T07:00:00Z" });
			await send(await submission(frozen), tokens.revoked);

			expect(await refusalRows()).toMatchObject([
				{ kiosk_id: ids.revokedKiosk, reason: "kiosk_revoked", employee_id: ids.worker },
			]);
		});
	});

	describe("notifications", () => {
		it("tell an employee with a sign-in the action, claimed time and reason", async () => {
			await send(await submission(command(), "9999"));

			const [notification, ...others] = await inbox(ids.workerUser);
			expect(others).toEqual([]);
			expect(notification).toMatchObject({
				type: "kiosk_command_refused",
				title: "Kiosk clocking not recorded",
				message:
					"Your clock-in at Aug 3, 2026, 9:00 AM (Europe/Berlin) on the kiosk Store kiosk was not recorded: the PIN was wrong. Record your time again or ask your manager to correct it.",
			});
			expect(notification?.metadata.i18n).toMatchObject({
				titleKey: "common:notifications.content.kioskCommandRefused.title",
				messageKey: "common:notifications.content.kioskCommandRefused.message",
				params: {
					action: "clock_in",
					reason: "wrong_pin",
					kioskName: "Store kiosk",
					time: { kind: "zonedInstant", at: "2026-08-03T07:00:00Z", timeZone: KIOSK_ZONE },
				},
			});
			expect(await inbox(ids.managerUser)).toEqual([]);
		});

		it("go to a kiosk-only employee's managers instead, naming the employee", async () => {
			await send(await submission(command({ employeeId: ids.kioskOnly }), "9999"));

			expect(await inbox(ids.kioskOnlyUser)).toEqual([]);
			const [forwarded, ...others] = await inbox(ids.managerUser);
			expect(others).toEqual([]);
			expect(forwarded).toMatchObject({
				type: "kiosk_command_refused",
				title: "Kim Kiosk: Kiosk clocking not recorded",
				message:
					"A clock-in by Kim Kiosk at Aug 3, 2026, 9:00 AM (Europe/Berlin) on the kiosk Store kiosk was not recorded: the PIN was wrong. Record the time for them or check it with them.",
			});
			expect(forwarded?.metadata.forwardedFor).toMatchObject({ employeeId: ids.kioskOnly });
			expect(forwarded?.metadata.i18n).toMatchObject({
				messageKey: "common:notifications.content.kioskCommandRefused.forwardedMessage",
				params: { employeeName: "Kim Kiosk" },
			});
		});

		it("go to nobody for a command naming no employee of the organization", async () => {
			await send(await submission(command({ employeeId: randomUUID() })));

			expect(await refusalRows()).toMatchObject([
				{ reason: "employee_not_assigned", employee_id: null },
			]);
			const { rows } = await admin.query("select 1 from notification where organization_id = $1", [
				ids.organization,
			]);
			expect(rows).toEqual([]);
		});
	});

	describe("the kiosk settings", () => {
		it("list the organization's refused commands for owners and admins, newest first", async () => {
			const early = command({ occurredAt: "2026-08-03T07:00:00Z" });
			await send(await submission(early, "9999"));
			now = parseInstant("2026-08-03T12:05:00Z");
			const late = command({ employeeId: ids.kioskOnly, action: "start_break" });
			delete (late as Record<string, unknown>).workLocationType;
			await send(await submission(late, "9999"));
			await admin.query(
				`insert into kiosk_frozen_refusal (organization_id, kiosk_id, operation_id, action, claimed_at,
				                                   time_source, reason, command, refused_at)
				 values ($1, $2, $3, 'clock_in', $4, 'server_anchor', 'kiosk_rotated', '{}', $4)`,
				[ids.otherOrganization, ids.foreignKiosk, randomUUID(), new Date("2026-08-03T11:00:00Z")],
			);

			actAs(ids.ownerUser);
			const result = await settings.getKioskAdminDataAction();

			expect(result.success && result.data.refusals).toEqual([
				{
					id: expect.any(String),
					kioskId: ids.kiosk,
					kioskName: "Store kiosk",
					kioskTimezone: KIOSK_ZONE,
					employeeName: "Kim Kiosk",
					action: "start_break",
					claimedAt: "2026-08-03T07:00:00.000Z",
					timeSource: "server_anchor",
					reason: "wrong_pin",
					refusedAt: "2026-08-03T12:05:00.000Z",
				},
				{
					id: expect.any(String),
					kioskId: ids.kiosk,
					kioskName: "Store kiosk",
					kioskTimezone: KIOSK_ZONE,
					employeeName: "Wanda Worker",
					action: "clock_in",
					claimedAt: "2026-08-03T07:00:00.000Z",
					timeSource: "server_anchor",
					reason: "wrong_pin",
					refusedAt: "2026-08-03T12:00:00.000Z",
				},
			]);
		});

		it("are not shown to managers, members or another organization's owner", async () => {
			await send(await submission(command(), "9999"));

			for (const userId of [ids.managerUser, ids.workerUser]) {
				actAs(userId);
				expect(await settings.getKioskAdminDataAction()).toMatchObject({
					success: false,
					code: "admin_only",
				});
			}
			actAs(ids.foreignUser, ids.otherOrganization);
			const foreign = await settings.getKioskAdminDataAction();
			expect(foreign.success && foreign.data.refusals).toEqual([]);
		});
	});
});
