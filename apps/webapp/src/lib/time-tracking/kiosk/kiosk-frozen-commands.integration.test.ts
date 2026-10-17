/**
 * #1289: frozen kiosk clock commands on PostgreSQL, through the kiosk submit and
 * lookup endpoints' service. Commands queued on an offline kiosk arrive with
 * their occurred instant, a sealed PIN and the kiosk's signed contact anchor;
 * Z8 judges them on arrival (ADR 0011) and runs Clocking at their instant.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The work transactions, PIN judgment, sealing and anchors are the real ones;
 * billing, the Next boundaries and the refusal record (#1290) are replaced.
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
const { proveFrozenKioskPin } = await import("@/lib/time-tracking/clocking/kiosk");
const { setOwnKioskPin } = await import("./pin-store");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskFrozenCommandService } = await import("./frozen-command-service");
const { readKioskSession } = await import("./kiosk-session.server");
const { sealKioskPin } = await import("./pin-seal");
const { kioskSealingKey } = await import("./pin-seal.server");
const { issueKioskPairingCode } = await import("./kiosk-store");
const { withAuditTrail } = await import("@/lib/audit-trail");
type KioskFrozenRefusal = import("./frozen-refusals").KioskFrozenRefusal;
type RecordedKioskFrozenRefusal = import("./frozen-refusals").RecordedKioskFrozenRefusal;
type KioskContactAnchor = import("./frozen-command").KioskContactAnchor;
type KioskPinProof = import("@/lib/time-tracking/clocking/types").KioskPinProof;

const ids = {
	organization: "t1289-kiosk-org",
	workerUser: "t1289-worker-user",
	strangerUser: "t1289-stranger-user",
	worker: "a1289000-0000-4000-8000-000000000001",
	stranger: "a1289000-0000-4000-8000-000000000002",
	store: "a1289000-0000-4000-8000-000000000011",
	warehouse: "a1289000-0000-4000-8000-000000000012",
	kiosk: "a1289000-0000-4000-8000-000000000021",
	revokedKiosk: "a1289000-0000-4000-8000-000000000022",
} as const;
const users = [ids.workerUser, ids.strangerUser];
const tokens = {
	kiosk: "z8k_t1289-store-kiosk-token",
	revoked: "z8k_t1289-revoked-kiosk-token",
} as const;
const SECRET = "t1289-integration-secret-with-at-least-32-characters";
const PIN = "4711";
const KIOSK_ZONE = "Europe/Berlin";
/** Arrival: the kiosk reconnects. */
const ARRIVAL = "2026-08-03T12:00:00Z";
/** The kiosk's last contact before its outage. */
const LAST_CONTACT = "2026-08-03T06:00:00Z";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("frozen kiosk clock commands on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant(ARRIVAL);
	const clock = { nowInstant: () => now };
	let recorded: KioskFrozenRefusal[] = [];
	/** How many of the next records are lost (the process dies before the refusal is kept). */
	let lostRecords = 0;
	const ledger = {
		async recall(input: { organizationId: string; kioskId: string; operationId: string }) {
			const refusal = recorded.find(
				(row) =>
					row.organizationId === input.organizationId &&
					row.kioskId === input.kioskId &&
					row.operationId === input.operationId,
			);
			return refusal
				? ({
						reason: refusal.reason,
						detail: refusal.detail,
						command: refusal.command,
					} satisfies RecordedKioskFrozenRefusal)
				: null;
		},
		async record(refusal: KioskFrozenRefusal) {
			if (lostRecords > 0) {
				lostRecords -= 1;
				throw new Error("The refusal record was lost");
			}
			recorded.push(refusal);
		},
	};

	function newClocking() {
		return createClocking({
			clock: clock as never,
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		});
	}

	function newService() {
		return createKioskFrozenCommandService({
			clocking: newClocking(),
			clock,
			secret: () => SECRET,
			refusals: ledger,
		});
	}

	const pairedKiosk = (kioskId: string = ids.kiosk) => ({
		kioskId,
		organizationId: ids.organization,
		locationId: ids.store,
		name: "Store kiosk",
		timezone: KIOSK_ZONE,
		boardEnabled: false,
	});

	/** The anchor the kiosk session handed the device at its last contact. */
	async function contactAt(
		at: string = LAST_CONTACT,
		token: string = tokens.kiosk,
		kioskId: string = ids.kiosk,
	): Promise<KioskContactAnchor> {
		const session = await readKioskSession(db, pairedKiosk(kioskId), token, {
			clock: { nowInstant: () => parseInstant(at) },
			secret: SECRET,
		});
		if (!session.offline) throw new Error("The kiosk has no offline mode");
		return session.offline.contact;
	}

	type CommandFields = Record<string, unknown> & { action: string };

	function command(fields: CommandFields) {
		return {
			version: 1,
			operationId: randomUUID(),
			kioskId: ids.kiosk,
			employeeId: ids.worker,
			occurredAt: "2026-08-03T07:00:00Z",
			timeSource: "server_anchor",
			timezone: KIOSK_ZONE,
			...(fields.action === "clock_in" ? { workLocationType: "office" } : {}),
			...(fields.action === "clock_out"
				? { project: { kind: "preserve" }, workCategory: { kind: "preserve" } }
				: {}),
			...fields,
		};
	}

	async function submission(
		frozen: ReturnType<typeof command>,
		options: { pin?: string; sealedFor?: string; contact?: KioskContactAnchor } = {},
	) {
		return {
			command: frozen,
			pin: await sealKioskPin(options.pin ?? PIN, {
				sealingKey: kioskSealingKey(SECRET),
				kioskId: frozen.kioskId as string,
				employeeId: options.sealedFor ?? (frozen.employeeId as string),
				operationId: frozen.operationId as string,
			}),
			contact: options.contact ?? (await contactAt()),
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

	async function submit(
		fields: CommandFields,
		options: Parameters<typeof submission>[1] & { token?: string } = {},
	) {
		const frozen = command(fields);
		return { command: frozen, ...(await send(await submission(frozen, options), options.token)) };
	}

	async function lookUp(operationId: string, token: string = tokens.kiosk) {
		const response = await newService().lookup(
			new Request(`http://localhost/api/kiosk/commands/${operationId}`, {
				headers: { [KIOSK_TOKEN_HEADER]: token },
			}),
			operationId,
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
			timestamp: Date;
			device_info: string | null;
			created_by: string;
			timezone: string | null;
			utc_offset_minutes: number;
		}>(
			`select id, type, timestamp, device_info, created_by, timezone, utc_offset_minutes
			 from time_entry where employee_id = $1 order by timestamp, created_at`,
			[employeeId],
		);
		return rows;
	}

	async function receipts() {
		const { rows } = await admin.query<{ id: string; kind: string; kiosk_id: string | null }>(
			"select id, kind, kiosk_id from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		return rows;
	}

	async function pinEvents() {
		const { rows } = await admin.query<{ kind: string; offline: boolean; occurred_at: Date }>(
			`select kind, offline, occurred_at from employee_kiosk_pin_event
			 where employee_id = $1 and kind <> 'cleared' order by occurred_at, sequence`,
			[ids.worker],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1289 kiosk', $1, 'Europe/Berlin', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Wanda Worker', 't1289-worker@example.test', $3, $3),
			 ($2, 'Sam Stranger', 't1289-stranger@example.test', $3, $3)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1289-m-worker', $1, $2, 'member', 'approved', $4),
			 ('t1289-m-stranger', $1, $3, 'owner', 'approved', $4)`,
			[ids.organization, ids.workerUser, ids.strangerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $5, 'employee', true, $6), ($3, $4, $5, 'admin', true, $6)`,
			[ids.worker, ids.workerUser, ids.stranger, ids.strangerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'Store', $4, $5), ($2, $3, 'Warehouse', $4, $5)`,
			[ids.store, ids.warehouse, ids.organization, ids.strangerUser, timestamp],
		);
		await admin.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, token_hash, paired_at,
			                    revoked_at, offline_mode_enabled, created_by, updated_at) values
			 ($1, $3, $4, 'Store kiosk', $5, $6, $8, null, true, $9, $8),
			 ($2, $3, $4, 'Old kiosk', $5, $7, $8, $8, true, $9, $8)`,
			[
				ids.kiosk,
				ids.revokedKiosk,
				ids.organization,
				ids.store,
				KIOSK_ZONE,
				hashKioskSecret(tokens.kiosk),
				hashKioskSecret(tokens.revoked),
				timestamp,
				ids.strangerUser,
			],
		);
		// The worker works at the store; the stranger only at the warehouse.
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id) values
			 ($1, $2, $4), ($1, $3, $5)`,
			[ids.organization, ids.worker, ids.stranger, ids.store, ids.warehouse],
		);
		const pinSetAt = { nowInstant: () => parseInstant("2026-07-01T00:00:00Z") };
		for (const userId of users) {
			await setOwnKioskPin(db, { organizationId: ids.organization, userId, pin: PIN }, pinSetAt);
		}
		await setAdmission("active");
	}

	beforeEach(async () => {
		now = parseInstant(ARRIVAL);
		recorded = [];
		lostRecords = 0;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("acceptance", () => {
		it("commits an offline clock-in at its instant, in the kiosk's zone, with its provenance", async () => {
			const response = await submit({ action: "clock_in" });

			expect(response).toMatchObject({
				status: 201,
				body: {
					outcome: "executed",
					operationId: response.command.operationId,
					action: "clock_in",
					at: { instant: "2026-08-03T07:00:00Z", zone: KIOSK_ZONE },
				},
			});
			expect(only(await entries())).toMatchObject({
				id: response.command.operationId,
				type: "clock_in",
				timestamp: new Date("2026-08-03T07:00:00Z"),
				device_info: `kiosk:${ids.kiosk}:offline:server_anchor`,
				created_by: ids.workerUser,
				timezone: KIOSK_ZONE,
				utc_offset_minutes: 120,
			});
			const { rows } = await admin.query(
				`select writer, actor_kind, kiosk_id, command from completed_work_operation where id = $1`,
				[response.command.operationId],
			);
			expect(only(rows)).toEqual({
				writer: "kiosk_clock",
				actor_kind: "kiosk",
				kiosk_id: ids.kiosk,
				command: response.command,
			});
			expect(only(await pinEvents())).toMatchObject({ kind: "success", offline: true });
			expect(recorded).toEqual([]);
		});

		it("records the device-clock time source on the entry", async () => {
			await submit({ action: "clock_in", timeSource: "device_clock" });

			expect(only(await entries()).device_info).toBe(`kiosk:${ids.kiosk}:offline:device_clock`);
		});

		it("replays the same bytes, refuses other bytes under the same identity, and answers lookups", async () => {
			const frozen = command({ action: "clock_in" });
			const body = await submission(frozen);
			expect((await send(body)).status).toBe(201);

			expect(await send(body)).toEqual({
				status: 200,
				body: { outcome: "replayed", operationId: frozen.operationId, action: "clock_in" },
			});
			const other = { ...frozen, occurredAt: "2026-08-03T07:01:00Z" };
			expect(await send(await submission(other))).toMatchObject({
				status: 409,
				body: { outcome: "refused", code: "collision" },
			});
			expect(await lookUp(frozen.operationId)).toEqual({
				status: 200,
				body: { outcome: "committed", operationId: frozen.operationId, action: "clock_in" },
			});
			const unknown = randomUUID();
			expect((await lookUp(unknown)).body).toEqual({
				outcome: "not_committed",
				operationId: unknown,
			});
			expect(await entries()).toHaveLength(1);
			// The replay judged no PIN again.
			expect(await pinEvents()).toHaveLength(1);
		});

		it("takes a break offline and clocks out from the resumed work", async () => {
			const clockIn = await submit({ action: "clock_in", occurredAt: "2026-08-03T07:00:00Z" });
			const start = await submit({ action: "start_break", occurredAt: "2026-08-03T09:00:00Z" });
			const resume = await submit({
				action: "resume_break",
				occurredAt: "2026-08-03T09:30:00Z",
				breakStart: { at: "2026-08-03T09:00:00Z", timezone: KIOSK_ZONE },
			});
			const clockOut = await submit({
				action: "clock_out",
				occurredAt: "2026-08-03T11:00:00Z",
				target: { clockInOperationId: resume.command.operationId },
			});

			expect([clockIn.status, start.status, resume.status, clockOut.status]).toEqual([
				201, 201, 201, 201,
			]);
			expect(
				(await entries()).map((entry) => [
					entry.type,
					entry.timestamp.toISOString(),
					entry.device_info,
				]),
			).toEqual([
				["clock_in", "2026-08-03T07:00:00.000Z", `kiosk:${ids.kiosk}:offline:server_anchor`],
				["clock_out", "2026-08-03T09:00:00.000Z", `kiosk:${ids.kiosk}:offline:server_anchor`],
				["clock_in", "2026-08-03T09:30:00.000Z", `kiosk:${ids.kiosk}:offline:server_anchor`],
				["clock_out", "2026-08-03T11:00:00.000Z", `kiosk:${ids.kiosk}:offline:server_anchor`],
			]);
			// A start keeps no receipt; its lookup still answers it, and it replays.
			expect((await lookUp(start.command.operationId)).body).toMatchObject({
				outcome: "committed",
				action: "start_break",
			});
		});

		it("ends the day while on a break at the break's start", async () => {
			const clockIn = await submit({ action: "clock_in", occurredAt: "2026-08-03T07:00:00Z" });
			await submit({ action: "start_break", occurredAt: "2026-08-03T09:00:00Z" });
			const clockOut = await submit({
				action: "clock_out",
				occurredAt: "2026-08-03T10:00:00Z",
				target: { clockInOperationId: clockIn.command.operationId },
			});

			expect(clockOut.body).toMatchObject({
				outcome: "executed",
				at: { instant: "2026-08-03T09:00:00Z" },
			});
			expect((await entries()).map((entry) => entry.timestamp.toISOString())).toEqual([
				"2026-08-03T07:00:00.000Z",
				"2026-08-03T09:00:00.000Z",
			]);
		});
	});

	describe("refusals write nothing and each has its reason", () => {
		async function expectRefused(
			response: { status: number; body: Record<string, unknown> },
			code: string,
			status: number,
		) {
			expect(response.status).toBe(status);
			expect(response.body).toMatchObject({ outcome: "refused", code });
			expect(await entries()).toEqual([]);
			expect(await receipts()).toEqual([]);
			const refusal = recorded.at(-1);
			expect(refusal).toMatchObject({
				organizationId: ids.organization,
				operationId: response.body.operationId,
				reason: code,
			});
		}

		it("a wrong PIN, stored as an offline failure at the command's instant", async () => {
			const response = await submit({ action: "clock_in" }, { pin: "9999" });

			await expectRefused(response, "wrong_pin", 403);
			expect(only(await pinEvents())).toMatchObject({
				kind: "failure",
				offline: true,
				occurred_at: new Date("2026-08-03T07:00:00Z"),
			});
			expect(only(recorded)).toMatchObject({
				kioskId: ids.kiosk,
				employeeId: ids.worker,
				employee: { id: ids.worker, userId: ids.workerUser },
				action: "clock_in",
				timeSource: "server_anchor",
				detail: {},
			});
			expect(only(recorded).claimedAt.toString()).toBe("2026-08-03T07:00:00Z");
		});

		it("a resend of a refused command is answered from its record, not judged again", async () => {
			const frozen = command({ action: "clock_in" });
			const body = await submission(frozen, { pin: "9999" });
			await send(body);

			expect((await send(body)).body).toMatchObject({ outcome: "refused", code: "wrong_pin" });
			expect(await pinEvents()).toHaveLength(1);
			expect(recorded).toHaveLength(1);
			expect((await lookUp(frozen.operationId)).body).toMatchObject({
				outcome: "refused",
				code: "wrong_pin",
			});
		});

		it("a lockout at the command's instant, even with the right PIN", async () => {
			await admin.query(
				`insert into employee_kiosk_pin_event (organization_id, employee_id, kind, offline, occurred_at)
				 select $1, $2, 'failure', false, $3 from generate_series(1, 5)`,
				[ids.organization, ids.worker, new Date("2026-08-03T06:55:00Z")],
			);

			const response = await submit({ action: "clock_in" });

			await expectRefused(response, "pin_locked", 423);
			expect(response.body.lockedUntil).toBe("2026-08-03T07:10:00Z");
		});

		it("an employee not assigned to the kiosk's location", async () => {
			const response = await submit({ action: "clock_in", employeeId: ids.stranger });

			await expectRefused(response, "employee_not_assigned", 403);
		});

		it("a sealed PIN that does not open for the command", async () => {
			const response = await submit({ action: "clock_in" }, { sealedFor: ids.stranger });

			await expectRefused(response, "pin_unsealable", 403);
			expect(await pinEvents()).toEqual([]);
		});

		it("every command of a revoked kiosk, whatever instant it claims", async () => {
			const response = await submit(
				{ action: "clock_in", kioskId: ids.revokedKiosk, occurredAt: "2026-07-01T07:00:00Z" },
				{ token: tokens.revoked },
			);

			await expectRefused(response, "kiosk_revoked", 403);
			expect(only(recorded).kioskId).toBe(ids.revokedKiosk);
		});

		it("the commands of a kiosk whose token was rotated, sent with the old token or the new one", async () => {
			const anchor = await contactAt();
			await withAuditTrail((audit) =>
				db.transaction((tx) =>
					issueKioskPairingCode(tx, audit, {
						organizationId: ids.organization,
						actorUserId: ids.strangerUser,
						kioskId: ids.kiosk,
					}),
				),
			);

			await expectRefused(
				await submit({ action: "clock_in" }, { contact: anchor }),
				"kiosk_rotated",
				403,
			);

			// The device paired again; its old queue still carries the old token's anchor.
			await admin.query("update kiosk set token_hash = $2 where id = $1", [
				ids.kiosk,
				hashKioskSecret("z8k_t1289-new-token"),
			]);
			await expectRefused(
				await submit({ action: "clock_in" }, { contact: anchor, token: "z8k_t1289-new-token" }),
				"kiosk_rotated",
				403,
			);
		});

		it("a contact anchor Z8 did not sign", async () => {
			const anchor = await contactAt();
			const response = await submit(
				{ action: "clock_in" },
				{ contact: { ...anchor, serverTime: "2026-08-02T06:00:00Z" } },
			);

			await expectRefused(response, "contact_unverifiable", 403);
		});

		it("a legacy organization, as not adopted", async () => {
			// The kiosk was offline when a pilot rollback returned the organization to legacy.
			const contact = await contactAt();
			await setAdmission("inactive");

			await expectRefused(await submit({ action: "clock_in" }, { contact }), "not_adopted", 409);
		});

		it("an instant outside the delayed admission window", async () => {
			const response = await submit(
				{ action: "clock_in", occurredAt: "2026-07-27T07:00:00Z" },
				{ contact: await contactAt("2026-07-27T06:00:00Z") },
			);

			await expectRefused(response, "admission_window", 422);
			expect(response.body.reason).toBe("too_old");
		});

		it("a device-clock instant before the last contact or after arrival", async () => {
			await expectRefused(
				await submit({
					action: "clock_in",
					timeSource: "device_clock",
					occurredAt: "2026-08-03T05:59:00Z",
				}),
				"clock_out_of_bounds",
				422,
			);
			await expectRefused(
				await submit({
					action: "clock_in",
					timeSource: "device_clock",
					occurredAt: "2026-08-03T12:02:00Z",
				}),
				"clock_out_of_bounds",
				422,
			);
		});

		it("a clock-in that conflicts with work already live elsewhere", async () => {
			const first = await submit({ action: "clock_in", occurredAt: "2026-08-03T07:00:00Z" });
			expect(first.status).toBe(201);

			const response = await submit({ action: "clock_in", occurredAt: "2026-08-03T08:00:00Z" });

			expect(response).toMatchObject({
				status: 409,
				body: { outcome: "refused", code: "already_clocked_in", since: "2026-08-03T07:00:00Z" },
			});
			expect(await entries()).toHaveLength(1);
			expect(only(recorded).reason).toBe("already_clocked_in");
		});

		it("work in a closed month", async () => {
			const closedMonthId = randomUUID();
			await admin.query(
				`insert into closed_month (id, organization_id, month, scope, covers_new_employees, actor_kind, closed_by)
				 values ($1, $2, '2026-07-01', 'organization', true, 'user', $3)`,
				[closedMonthId, ids.organization, ids.strangerUser],
			);
			await admin.query(
				`insert into closed_month_employee
				 (organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
				 values ($1, $2, $3, '2026-07-01', '2026-06-30T22:00:00Z', '2026-07-31T22:00:00Z', $4)`,
				[ids.organization, closedMonthId, ids.worker, KIOSK_ZONE],
			);

			const response = await submit(
				{ action: "clock_in", occurredAt: "2026-07-31T07:00:00Z" },
				{ contact: await contactAt("2026-07-31T06:00:00Z") },
			);

			await expectRefused(response, "month_closed", 409);
			expect(response.body.month).toBe("2026-07");
		});

		it("an employee without a kiosk PIN", async () => {
			await admin.query("delete from employee_kiosk_pin where employee_id = $1", [ids.worker]);

			await expectRefused(await submit({ action: "clock_in" }), "no_pin", 403);
			expect(await pinEvents()).toEqual([]);
		});

		it("a PIN reset during the outage: the queued PIN is checked against the current one", async () => {
			const queuedWithOldPin = command({ action: "clock_in", occurredAt: "2026-08-03T07:00:00Z" });
			const body = await submission(queuedWithOldPin);
			await setOwnKioskPin(
				db,
				{ organizationId: ids.organization, userId: ids.workerUser, pin: "8642" },
				{ nowInstant: () => parseInstant("2026-08-03T09:00:00Z") },
			);

			await expectRefused(await send(body), "wrong_pin", 403);
			// A command entered with the new PIN after the reset commits.
			expect(
				(await submit({ action: "clock_in", occurredAt: "2026-08-03T09:30:00Z" }, { pin: "8642" }))
					.status,
			).toBe(201);
		});

		it("an instant further ahead of arrival than the window allows", async () => {
			const response = await submit({ action: "clock_in", occurredAt: "2026-08-03T12:06:00Z" });

			await expectRefused(response, "admission_window", 422);
			expect(response.body.reason).toBe("in_future");
		});

		it("a command naming another kiosk than the one sending it, recorded for the sender", async () => {
			const response = await submit({ action: "clock_in", kioskId: ids.revokedKiosk });

			expect(response).toMatchObject({
				status: 400,
				body: { outcome: "refused", code: "invalid_command" },
			});
			expect(await entries()).toEqual([]);
			expect(only(recorded)).toMatchObject({ kioskId: ids.kiosk, reason: "invalid_command" });
		});
	});

	describe("review fixes (#885)", () => {
		it("captures the entry in the zone the kiosk recorded, not the kiosk's zone at arrival", async () => {
			// An admin moved the kiosk to London while it was offline.
			await admin.query("update kiosk set timezone = 'Europe/London' where id = $1", [ids.kiosk]);

			const response = await submit({ action: "clock_in" });

			expect(response.body).toMatchObject({ outcome: "executed", at: { zone: KIOSK_ZONE } });
			expect(only(await entries())).toMatchObject({
				timezone: KIOSK_ZONE,
				utc_offset_minutes: 120,
			});
		});

		it("keeps each break entry's own time source", async () => {
			await submit({ action: "clock_in", occurredAt: "2026-08-03T07:00:00Z" });
			await submit({
				action: "start_break",
				occurredAt: "2026-08-03T09:00:00Z",
				timeSource: "device_clock",
			});
			const resume = await submit({
				action: "resume_break",
				occurredAt: "2026-08-03T09:30:00Z",
				breakStart: { at: "2026-08-03T09:00:00Z", timezone: KIOSK_ZONE },
			});
			await submit({
				action: "start_break",
				occurredAt: "2026-08-03T10:00:00Z",
				timeSource: "device_clock",
			});
			// The day ends while on the break: at its start.
			const endDay = await submit({
				action: "clock_out",
				occurredAt: "2026-08-03T11:00:00Z",
				target: { clockInOperationId: resume.command.operationId },
			});

			expect(endDay.status).toBe(201);
			expect(
				(await entries()).map((entry) => [
					entry.type,
					entry.timestamp.toISOString(),
					entry.device_info,
				]),
			).toEqual([
				["clock_in", "2026-08-03T07:00:00.000Z", `kiosk:${ids.kiosk}:offline:server_anchor`],
				["clock_out", "2026-08-03T09:00:00.000Z", `kiosk:${ids.kiosk}:offline:device_clock`],
				["clock_in", "2026-08-03T09:30:00.000Z", `kiosk:${ids.kiosk}:offline:server_anchor`],
				["clock_out", "2026-08-03T10:00:00.000Z", `kiosk:${ids.kiosk}:offline:device_clock`],
			]);
		});

		it("answers other bytes under a committed operation as a collision without recording a refusal", async () => {
			const frozen = command({ action: "clock_in" });
			expect((await send(await submission(frozen))).status).toBe(201);

			const other = { ...frozen, occurredAt: "2026-08-03T07:01:00Z" };
			expect(await send(await submission(other))).toMatchObject({
				status: 409,
				body: { outcome: "refused", code: "collision" },
			});
			expect(recorded).toEqual([]);
		});

		it("holds queued PINs once five failures arrived, without a refusal, and commits the resend after the wait", async () => {
			for (const minute of ["00", "01", "02", "03", "04"]) {
				const wrong = await submit(
					{ action: "clock_in", occurredAt: `2026-08-03T07:${minute}:00Z` },
					{ pin: "9999" },
				);
				expect(wrong.body.code).toMatch(/^(wrong_pin|pin_locked)$/);
			}
			recorded = [];
			const frozen = command({ action: "clock_in", occurredAt: "2026-08-03T06:30:00Z" });
			const body = await submission(frozen);

			expect(await send(body)).toEqual({
				status: 429,
				body: {
					outcome: "retry_later",
					operationId: frozen.operationId,
					code: "pin_throttled",
					retryAfter: 900,
				},
			});
			expect(recorded).toEqual([]);
			expect(await entries()).toEqual([]);
			expect(await pinEvents()).toHaveLength(5);
			expect((await lookUp(frozen.operationId)).body.outcome).toBe("not_committed");

			now = parseInstant("2026-08-03T12:15:00Z");
			expect(await send(body)).toMatchObject({ status: 201, body: { outcome: "executed" } });
		});

		it("answers a resend after a lost refusal record with the stored verdict, counting one failure", async () => {
			lostRecords = 1;
			const frozen = command({ action: "clock_in" });
			const body = await submission(frozen, { pin: "9999" });

			expect(await send(body)).toEqual({
				status: 500,
				body: { outcome: "unknown", operationId: frozen.operationId },
			});
			expect(await send(body)).toMatchObject({ status: 403, body: { code: "wrong_pin" } });
			expect(await pinEvents()).toHaveLength(1);
			expect(only(recorded).reason).toBe("wrong_pin");
		});
	});

	describe("Clocking's own authorization of frozen kiosk commands", () => {
		async function frozenProof(operationId: string, occurredAt: string) {
			const verification = await proveFrozenKioskPin(
				{
					organizationId: ids.organization,
					kioskId: ids.kiosk,
					employeeId: ids.worker,
					operationId,
					occurredAt: parseInstant(occurredAt),
					timeSource: "server_anchor",
					pin: () => PIN,
				},
				clock,
			);
			if (verification.status !== "verified") throw new Error(verification.status);
			return verification.proof;
		}

		function clockIn(proof: KioskPinProof, operationId: string, occurredAt: string) {
			const instant = parseInstant(occurredAt);
			return newClocking().run({
				organizationId: ids.organization,
				principal: { kind: "kiosk", kioskId: ids.kiosk, userId: ids.workerUser, pin: proof },
				subject: { employeeId: ids.worker },
				identity: { origin: "client", id: operationId },
				channel: "kiosk",
				at: { kind: "occurred", instant },
				zone: { device: KIOSK_ZONE, fallback: KIOSK_ZONE },
				freshness: { earliest: instant.subtract({ hours: 1 }), latest: now },
				payload: { version: 1, operationId },
				body: { kind: "clock_in", workLocationType: "office" },
			});
		}

		it("authorizes only the one command its frozen proof names", async () => {
			const operationId = randomUUID();
			const proof = await frozenProof(operationId, "2026-08-03T07:00:00Z");

			expect(await clockIn(proof, randomUUID(), "2026-08-03T07:00:00Z")).toMatchObject({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(await clockIn(proof, operationId, "2026-08-03T07:01:00Z")).toMatchObject({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			const forged = Object.freeze({ ...proof });
			expect(await clockIn(forged, operationId, "2026-08-03T07:00:00Z")).toMatchObject({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(await clockIn(proof, operationId, "2026-08-03T07:00:00Z")).toMatchObject({
				outcome: "executed",
			});
		});

		it("refuses a frozen break start in a legacy organization", async () => {
			const clockInId = randomUUID();
			expect(
				await clockIn(
					await frozenProof(clockInId, "2026-08-03T07:00:00Z"),
					clockInId,
					"2026-08-03T07:00:00Z",
				),
			).toMatchObject({ outcome: "executed" });
			await setAdmission("inactive");
			const operationId = randomUUID();
			const instant = parseInstant("2026-08-03T09:00:00Z");

			const outcome = await newClocking().startBreak({
				organizationId: ids.organization,
				principal: {
					kind: "kiosk",
					kioskId: ids.kiosk,
					userId: ids.workerUser,
					pin: await frozenProof(operationId, "2026-08-03T09:00:00Z"),
				},
				subject: { employeeId: ids.worker },
				identity: { origin: "client", id: operationId },
				channel: "kiosk",
				at: { kind: "occurred", instant },
				zone: { device: KIOSK_ZONE, fallback: KIOSK_ZONE },
				freshness: { earliest: instant.subtract({ hours: 1 }), latest: now },
				payload: { version: 1, operationId },
			});

			expect(outcome).toMatchObject({
				outcome: "refused",
				failure: { code: "frozen_not_accepted" },
			});
			const { rows } = await admin.query(
				"select break_started_at from work_period where employee_id = $1",
				[ids.worker],
			);
			expect(only(rows).break_started_at).toBeNull();
		});
	});

	describe("the kiosk session", () => {
		it("hands an offline-mode kiosk its contact anchor and the sealing key, and nothing to others", async () => {
			const session = await readKioskSession(db, pairedKiosk(), tokens.kiosk, {
				clock,
				secret: SECRET,
			});
			expect(session.offline).toEqual({
				contact: { serverTime: ARRIVAL, proof: expect.any(String) },
				sealingKey: kioskSealingKey(SECRET),
			});

			await admin.query("update kiosk set offline_mode_enabled = false where id = $1", [ids.kiosk]);
			const without = await readKioskSession(db, pairedKiosk(), tokens.kiosk, {
				clock,
				secret: SECRET,
			});
			expect(without).toEqual({ kiosk: expect.objectContaining({ offlineMode: false }) });
		});
	});
});
