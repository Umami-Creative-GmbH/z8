/**
 * #1507 (spec #1358, ADR 0014): the kiosk fob registration notification on
 * PostgreSQL, through the kiosk fob registration endpoint's service. A real
 * registration tells the employee which kiosk registered a fob to them and
 * whether it replaced their earlier one; a kiosk-only employee's managers are
 * told instead (the frozen-command refusal rule, #860). Refused and repeated
 * registrations tell nobody. Never more of the serial than its last four hex.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Real kiosk authentication, PIN verification, fob store and notifications
 * (including the kiosk-only forwarding). Only the rate limiters and the Next
 * request/cache boundaries are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const { setOwnKioskPin } = await import("./pin-store");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskFobService } = await import("./fob-service");
const { notifyKioskFobRegistered } = await import("./fob-registration-notification");

const ids = {
	organization: "t1507-kiosk-org",
	workerUser: "t1507-worker-user",
	coworkerUser: "t1507-coworker-user",
	kioskOnlyUser: "t1507-kim-user",
	loneKioskOnlyUser: "t1507-lou-user",
	managerUser: "t1507-manager-user",
	ownerUser: "t1507-owner-user",
	worker: "f1507000-0000-4000-8000-000000000001",
	coworker: "f1507000-0000-4000-8000-000000000002",
	kioskOnly: "f1507000-0000-4000-8000-000000000003",
	loneKioskOnly: "f1507000-0000-4000-8000-000000000004",
	manager: "f1507000-0000-4000-8000-000000000005",
	owner: "f1507000-0000-4000-8000-000000000006",
	store: "f1507000-0000-4000-8000-000000000011",
	kiosk: "f1507000-0000-4000-8000-000000000021",
} as const;
const users = [
	ids.workerUser,
	ids.coworkerUser,
	ids.kioskOnlyUser,
	ids.loneKioskOnlyUser,
	ids.managerUser,
	ids.ownerUser,
];
const TOKEN = "z8k_t1507-store-kiosk-token";
const PIN = "4711";
const SERIAL = "04A1B2C3D4E5F6";
const OTHER_SERIAL = "1A2B3C4D";

describe("kiosk fob registration notifications on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now = parseInstant("2026-11-02T08:00:00Z");
	const clockPort = { nowInstant: () => now };
	/** Work the service left for after its response, as Next's `after` would run it. */
	const afterResponse: Array<() => Promise<void>> = [];
	let notify = notifyKioskFobRegistered;

	const service = createKioskFobService({
		clock: clockPort,
		limitPinAttempts: async () => ({ allowed: true, retryAfter: 0 }),
		limitFobLookups: async () => ({ allowed: true, retryAfter: 0 }),
		onRegistered: (registration) => notify(registration),
		afterResponse: (task) => {
			afterResponse.push(task);
		},
	});

	async function respond(serial: string, employeeId: string, pin: string = PIN) {
		const response = await service.register(
			new Request("http://localhost/api/kiosk/fob/registration", {
				method: "POST",
				headers: { "content-type": "application/json", [KIOSK_TOKEN_HEADER]: TOKEN },
				body: JSON.stringify({ serial, employeeId, pin }),
			}),
		);
		return { status: response.status, body: await response.json() };
	}

	async function runAfterResponse() {
		for (const task of afterResponse.splice(0)) await task();
	}

	async function register(serial: string, employeeId: string, pin: string = PIN) {
		const answer = await respond(serial, employeeId, pin);
		await runAfterResponse();
		return answer;
	}

	async function inbox(userId: string) {
		const { rows } = await admin.query<{
			type: string;
			title: string;
			message: string;
			action_url: string | null;
			metadata: string | null;
		}>(
			`select type, title, message, action_url, metadata from notification
			 where user_id = $1 and organization_id = $2 order by created_at`,
			[userId, ids.organization],
		);
		return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata ?? "{}") }));
	}

	async function allNotifications() {
		const { rows } = await admin.query("select * from notification where organization_id = $1", [
			ids.organization,
		]);
		return rows;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-10-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1507 kiosk', $1, 'Europe/Berlin', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Wanda Worker', 't1507-worker@example.test', $7, $7),
			 ($2, 'Cora Coworker', 't1507-coworker@example.test', $7, $7),
			 ($3, 'Kim Kiosk', 't1507-kim@kiosk.invalid', $7, $7),
			 ($4, 'Lou Lone', 't1507-lou@kiosk.invalid', $7, $7),
			 ($5, 'Mia Manager', 't1507-manager@example.test', $7, $7),
			 ($6, 'Olga Owner', 't1507-owner@example.test', $7, $7)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1507-m-worker', $1, $2, 'member', 'approved', $6),
			 ('t1507-m-coworker', $1, $3, 'member', 'approved', $6),
			 ('t1507-m-manager', $1, $4, 'member', 'approved', $6),
			 ('t1507-m-owner', $1, $5, 'owner', 'approved', $6)`,
			[
				ids.organization,
				ids.workerUser,
				ids.coworkerUser,
				ids.managerUser,
				ids.ownerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $13, 'employee', true, $14), ($3, $4, $13, 'employee', true, $14),
			 ($5, $6, $13, 'employee', true, $14), ($7, $8, $13, 'employee', true, $14),
			 ($9, $10, $13, 'manager', true, $14), ($11, $12, $13, 'admin', true, $14)`,
			[
				ids.worker,
				ids.workerUser,
				ids.coworker,
				ids.coworkerUser,
				ids.kioskOnly,
				ids.kioskOnlyUser,
				ids.loneKioskOnly,
				ids.loneKioskOnlyUser,
				ids.manager,
				ids.managerUser,
				ids.owner,
				ids.ownerUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance)
			 select organization_id, id, 'open', $2, 'recorded' from employee where organization_id = $1`,
			[ids.organization, timestamp],
		);
		// Kim has a manager; Lou, also kiosk-only, has none (owners and admins are told).
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
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, $4)`,
			[ids.store, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, token_hash, paired_at,
			                    nfc_fob_reader_enabled, created_by, updated_at)
			 values ($1, $2, $3, 'Store kiosk', 'Europe/Berlin', $4, $5, true, $6, $5)`,
			[ids.kiosk, ids.organization, ids.store, hashKioskSecret(TOKEN), timestamp, ids.ownerUser],
		);
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id)
			 select $1, id, $2 from unnest($3::uuid[]) as id`,
			[ids.organization, ids.store, [ids.worker, ids.coworker, ids.kioskOnly, ids.loneKioskOnly]],
		);
		for (const userId of [
			ids.workerUser,
			ids.coworkerUser,
			ids.kioskOnlyUser,
			ids.loneKioskOnlyUser,
		]) {
			await setOwnKioskPin(db, { organizationId: ids.organization, userId, pin: PIN });
		}
	}

	beforeEach(async () => {
		now = parseInstant("2026-11-02T08:00:00Z");
		afterResponse.length = 0;
		notify = notifyKioskFobRegistered;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("tells an employee with a sign-in which kiosk registered a fob to them", async () => {
		expect((await register(SERIAL, ids.worker)).body.outcome).toBe("registered");

		const [notification, ...others] = await inbox(ids.workerUser);
		expect(others).toEqual([]);
		expect(notification).toMatchObject({
			type: "kiosk_fob_registered",
			title: "Kiosk fob registered",
			message:
				"A kiosk fob ending in E5F6 was registered to you on the kiosk Store kiosk. If you didn't register it, remove it in your security settings and change your kiosk PIN.",
			action_url: "/settings/security",
		});
		expect(notification?.metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.kioskFobRegistered.title",
			messageKey: "common:notifications.content.kioskFobRegistered.message",
			params: { replaced: "false", lastFour: "E5F6", kioskName: "Store kiosk" },
		});
		expect(await inbox(ids.managerUser)).toEqual([]);
		expect(await inbox(ids.ownerUser)).toEqual([]);
		expect(JSON.stringify(await allNotifications())).not.toContain(SERIAL);
	});

	it("says when the new fob replaced the employee's earlier one", async () => {
		await register(SERIAL, ids.worker);
		now = parseInstant("2026-11-02T09:00:00Z");
		expect((await register(OTHER_SERIAL, ids.worker)).body).toMatchObject({ replaced: true });

		const [first, second, ...others] = await inbox(ids.workerUser);
		expect(others).toEqual([]);
		expect(first?.message).not.toContain("replaced");
		expect(second?.message).toBe(
			"A kiosk fob ending in 3C4D was registered to you on the kiosk Store kiosk. It replaced your earlier fob, which no longer works. If you didn't register it, remove it in your security settings and change your kiosk PIN.",
		);
		expect(second?.metadata.i18n).toMatchObject({ params: { replaced: "true", lastFour: "3C4D" } });
	});

	it("goes to a kiosk-only employee's managers instead, naming the employee", async () => {
		expect((await register(SERIAL, ids.kioskOnly)).body.outcome).toBe("registered");

		expect(await inbox(ids.kioskOnlyUser)).toEqual([]);
		const [forwarded, ...others] = await inbox(ids.managerUser);
		expect(others).toEqual([]);
		expect(forwarded).toMatchObject({
			type: "kiosk_fob_registered",
			title: "Kim Kiosk: Kiosk fob registered",
			message:
				"A kiosk fob ending in E5F6 was registered to Kim Kiosk on the kiosk Store kiosk. If Kim Kiosk didn't register it, remove it on their employee page and reset their kiosk PIN.",
			// The employee's page, where their managers remove the fob; never their security settings.
			action_url: `/settings/employees/${ids.kioskOnly}`,
		});
		expect(forwarded?.metadata.forwardedFor).toMatchObject({ employeeId: ids.kioskOnly });
		expect(forwarded?.metadata.i18n).toMatchObject({
			messageKey: "common:notifications.content.kioskFobRegistered.forwardedMessage",
			params: { employeeName: "Kim Kiosk" },
		});
		// A manager exists, so owners and admins are not told.
		expect(await inbox(ids.ownerUser)).toEqual([]);
	});

	it("goes to owners and admins for a kiosk-only employee without managers", async () => {
		await register(SERIAL, ids.loneKioskOnly);

		expect(await inbox(ids.loneKioskOnlyUser)).toEqual([]);
		expect(await inbox(ids.managerUser)).toEqual([]);
		const [forwarded, ...others] = await inbox(ids.ownerUser);
		expect(others).toEqual([]);
		expect(forwarded).toMatchObject({
			type: "kiosk_fob_registered",
			title: "Lou Lone: Kiosk fob registered",
		});
		expect(forwarded?.message).toContain("registered to Lou Lone on the kiosk Store kiosk");
	});

	it("tells nobody about a refused registration", async () => {
		expect((await register(SERIAL, ids.worker, "0000")).body).toEqual({ code: "wrong_pin" });
		await register(SERIAL, ids.worker);
		expect((await register(SERIAL, ids.coworker)).body).toEqual({
			code: "fob_linked_to_other_employee",
		});

		expect(await inbox(ids.coworkerUser)).toEqual([]);
		expect(await allNotifications()).toHaveLength(1);
	});

	it("notifies only after the kiosk has its answer, and a failure changes nothing", async () => {
		const answer = await respond(SERIAL, ids.worker);
		expect(answer).toMatchObject({ status: 200, body: { outcome: "registered" } });
		expect(await inbox(ids.workerUser)).toEqual([]);
		await runAfterResponse();
		expect(await inbox(ids.workerUser)).toHaveLength(1);

		notify = async () => {
			throw new Error("notification service down");
		};
		now = parseInstant("2026-11-02T09:00:00Z");
		expect((await respond(OTHER_SERIAL, ids.worker)).body).toMatchObject({
			outcome: "registered",
			replaced: true,
		});
		await expect(runAfterResponse()).resolves.toBeUndefined();
		const { rows } = await admin.query<{ serial_number: string }>(
			"select serial_number from employee_kiosk_fob where employee_id = $1 and ended_at is null",
			[ids.worker],
		);
		expect(rows).toEqual([{ serial_number: OTHER_SERIAL }]);
	});

	it("tells nobody again when the fob was already the employee's", async () => {
		await register(SERIAL, ids.worker);
		expect((await register(SERIAL, ids.worker)).body.outcome).toBe("already_registered");

		expect(await inbox(ids.workerUser)).toHaveLength(1);
	});
});
