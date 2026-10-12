/**
 * #857: kiosk PINs on PostgreSQL. Issue, reset, own change, unlock and
 * verification through the PIN store, including who may manage a PIN, the
 * organization boundary, hash-only storage and the per-employee lockout.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Clock, type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("server-only", () => ({}));

const {
	issueKioskPin,
	readKioskPinStatus,
	resetKioskPin,
	setOwnKioskPin,
	unlockKioskPin,
	verifyEmployeeKioskPin,
} = await import("./pin-store");
const { KioskPinRefusal } = await import("./pin-errors");

const ids = {
	organization: "t857-pin-org",
	otherOrganization: "t857-pin-other-org",
	ownerUser: "t857-pin-owner-user",
	adminUser: "t857-pin-admin-user",
	managerUser: "t857-pin-manager-user",
	otherManagerUser: "t857-pin-other-manager-user",
	workerUser: "t857-pin-worker-user",
	foreignUser: "t857-pin-foreign-user",
	owner: "d8570000-0000-4000-8000-000000000001",
	admin: "d8570000-0000-4000-8000-000000000002",
	manager: "d8570000-0000-4000-8000-000000000003",
	otherManager: "d8570000-0000-4000-8000-000000000004",
	worker: "d8570000-0000-4000-8000-000000000005",
	foreign: "d8570000-0000-4000-8000-000000000006",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.otherManagerUser,
	ids.workerUser,
	ids.foreignUser,
];

function fixedClock(at: string): Clock & { set(next: string): void } {
	let now: Instant = parseInstant(at);
	return {
		nowInstant: () => now,
		set(next: string) {
			now = parseInstant(next);
		},
	};
}

async function refusalOf(promise: Promise<unknown>) {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(KioskPinRefusal);
	return (error as InstanceType<typeof KioskPinRefusal>).code;
}

describe("kiosk PIN store on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();
	const org = ids.organization;

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T857 PIN', $1, 'Europe/Berlin', $3), ($2, 'T857 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t857-pin-m-owner', $1, $2, 'owner', 'approved', $8),
			 ('t857-pin-m-admin', $1, $3, 'admin', 'approved', $8),
			 ('t857-pin-m-manager', $1, $4, 'member', 'approved', $8),
			 ('t857-pin-m-other-manager', $1, $5, 'member', 'approved', $8),
			 ('t857-pin-m-worker', $1, $6, 'member', 'approved', $8),
			 ('t857-pin-m-foreign', $7, $9, 'owner', 'approved', $8)`,
			[
				org,
				ids.ownerUser,
				ids.adminUser,
				ids.managerUser,
				ids.otherManagerUser,
				ids.workerUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $13, 'admin', true, now()),
			 ($3, $4, $13, 'admin', true, now()),
			 ($5, $6, $13, 'manager', true, now()),
			 ($7, $8, $13, 'manager', true, now()),
			 ($9, $10, $13, 'employee', true, now()),
			 ($11, $12, $14, 'admin', true, now())`,
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
				ids.foreign,
				ids.foreignUser,
				org,
				ids.otherOrganization,
			],
		);
		await pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.worker, ids.manager, ids.ownerUser],
		);
	});

	afterAll(cleanup);

	const issueFor = (actorUserId: string, employeeId: string = ids.worker) =>
		issueKioskPin(db, { organizationId: org, actorUserId, employeeId });
	const verify = (pin: string, clock: Clock, employeeId: string = ids.worker) =>
		verifyEmployeeKioskPin(db, { organizationId: org, employeeId, pin }, clock);

	it("issues a 6-digit PIN that is shown once and stored only as a hash", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		const { pin } = await issueFor(ids.ownerUser);

		expect(pin).toMatch(/^\d{6}$/);
		const { rows } = await pool.query(
			"select pin_hash from employee_kiosk_pin where employee_id = $1",
			[ids.worker],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].pin_hash).not.toContain(pin);
		await expect(verify(pin, clock)).resolves.toEqual({ status: "verified" });
		await expect(
			readKioskPinStatus(db, {
				organizationId: org,
				actorUserId: ids.ownerUser,
				employeeId: ids.worker,
			}),
		).resolves.toEqual({ hasPin: true, lockedUntil: null });
	});

	it("answers no PIN set for an employee without one, or outside the organization", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		await expect(verify("123456", clock)).resolves.toEqual({ status: "no_pin" });

		const { pin } = await issueFor(ids.ownerUser);
		await expect(
			verifyEmployeeKioskPin(
				db,
				{ organizationId: ids.otherOrganization, employeeId: ids.worker, pin },
				clock,
			),
		).resolves.toEqual({ status: "no_pin" });
	});

	it("refuses a second issue; a reset replaces the PIN", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		const { pin: first } = await issueFor(ids.adminUser);

		expect(await refusalOf(issueFor(ids.adminUser))).toBe("pin_exists");
		const { pin: second } = await resetKioskPin(db, {
			organizationId: org,
			actorUserId: ids.adminUser,
			employeeId: ids.worker,
		});

		if (second !== first)
			await expect(verify(first, clock)).resolves.toEqual({ status: "wrong_pin" });
		await expect(verify(second, clock)).resolves.toEqual({ status: "verified" });
		expect(
			await refusalOf(
				resetKioskPin(db, {
					organizationId: org,
					actorUserId: ids.adminUser,
					employeeId: ids.manager,
				}),
			),
		).toBe("no_pin");
	});

	it("lets owners, admins and the direct manager manage a PIN, and nobody else", async () => {
		await expect(issueFor(ids.managerUser)).resolves.toMatchObject({ pin: expect.any(String) });
		await expect(
			unlockKioskPin(db, {
				organizationId: org,
				actorUserId: ids.managerUser,
				employeeId: ids.worker,
			}),
		).resolves.toBeUndefined();

		for (const actorUserId of [ids.otherManagerUser, ids.workerUser, ids.foreignUser]) {
			expect(
				await refusalOf(
					resetKioskPin(db, { organizationId: org, actorUserId, employeeId: ids.worker }),
				),
			).toBe("not_allowed");
			expect(
				await refusalOf(
					unlockKioskPin(db, { organizationId: org, actorUserId, employeeId: ids.worker }),
				),
			).toBe("not_allowed");
			expect(
				await refusalOf(
					readKioskPinStatus(db, { organizationId: org, actorUserId, employeeId: ids.worker }),
				),
			).toBe("not_allowed");
		}
	});

	it("never manages an employee of another organization", async () => {
		expect(await refusalOf(issueFor(ids.ownerUser, ids.foreign))).toBe("employee_not_found");
		expect(
			await refusalOf(
				issueKioskPin(db, {
					organizationId: ids.otherOrganization,
					actorUserId: ids.foreignUser,
					employeeId: ids.worker,
				}),
			),
		).toBe("employee_not_found");
	});

	it("locks the employee for 15 minutes after 5 consecutive wrong PINs", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		const { pin } = await issueFor(ids.ownerUser);
		const wrong = pin === "000000" ? "111111" : "000000";

		for (let attempt = 1; attempt <= 4; attempt += 1) {
			await expect(verify(wrong, clock)).resolves.toEqual({ status: "wrong_pin" });
		}
		const locked = await verify(wrong, clock);
		expect(locked.status).toBe("locked");
		expect(locked.status === "locked" && locked.until.toString()).toBe("2026-03-02T08:15:00Z");

		clock.set("2026-03-02T08:14:59Z");
		await expect(verify(pin, clock)).resolves.toMatchObject({ status: "locked" });
		await expect(
			readKioskPinStatus(
				db,
				{ organizationId: org, actorUserId: ids.managerUser, employeeId: ids.worker },
				clock,
			),
		).resolves.toMatchObject({ hasPin: true, lockedUntil: expect.anything() });

		clock.set("2026-03-02T08:15:00Z");
		await expect(verify(pin, clock)).resolves.toEqual({ status: "verified" });
	});

	it("counts failures per employee however many kiosks submit them at once", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		const { pin } = await issueFor(ids.ownerUser);
		const wrong = pin === "000000" ? "111111" : "000000";

		const results = await Promise.all(Array.from({ length: 6 }, () => verify(wrong, clock)));

		expect(results.filter((result) => result.status === "locked")).toHaveLength(2);
		expect(results.filter((result) => result.status === "wrong_pin")).toHaveLength(4);
		await expect(verify(pin, clock)).resolves.toMatchObject({ status: "locked" });
	});

	it("starts the count again after a correct PIN", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		const { pin } = await issueFor(ids.ownerUser);
		const wrong = pin === "000000" ? "111111" : "000000";

		for (let attempt = 1; attempt <= 4; attempt += 1) await verify(wrong, clock);
		await expect(verify(pin, clock)).resolves.toEqual({ status: "verified" });
		for (let attempt = 1; attempt <= 4; attempt += 1) {
			await expect(verify(wrong, clock)).resolves.toEqual({ status: "wrong_pin" });
		}
	});

	it("unlocking clears the lock", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		const { pin } = await issueFor(ids.ownerUser);
		const wrong = pin === "000000" ? "111111" : "000000";
		for (let attempt = 1; attempt <= 5; attempt += 1) await verify(wrong, clock);

		await unlockKioskPin(db, {
			organizationId: org,
			actorUserId: ids.managerUser,
			employeeId: ids.worker,
		});

		await expect(verify(pin, clock)).resolves.toEqual({ status: "verified" });
		await expect(
			readKioskPinStatus(db, {
				organizationId: org,
				actorUserId: ids.ownerUser,
				employeeId: ids.worker,
			}),
		).resolves.toEqual({ hasPin: true, lockedUntil: null });
	});

	it("lets an employee with a sign-in set and change their own PIN", async () => {
		const clock = fixedClock("2026-03-02T08:00:00Z");
		await setOwnKioskPin(db, { organizationId: org, userId: ids.workerUser, pin: "4821" });
		await expect(verify("4821", clock)).resolves.toEqual({ status: "verified" });

		await setOwnKioskPin(db, { organizationId: org, userId: ids.workerUser, pin: "975310" });
		await expect(verify("4821", clock)).resolves.toEqual({ status: "wrong_pin" });
		await expect(verify("975310", clock)).resolves.toEqual({ status: "verified" });

		for (const pin of ["123", "1234567", "12a4", " 1234"]) {
			expect(
				await refusalOf(setOwnKioskPin(db, { organizationId: org, userId: ids.workerUser, pin })),
			).toBe("invalid_pin");
		}
		expect(
			await refusalOf(
				setOwnKioskPin(db, { organizationId: org, userId: ids.foreignUser, pin: "4821" }),
			),
		).toBe("employee_not_found");
	});

	it("records issue, reset and unlock in the audit log", async () => {
		await issueFor(ids.ownerUser);
		await resetKioskPin(db, {
			organizationId: org,
			actorUserId: ids.adminUser,
			employeeId: ids.worker,
		});
		await unlockKioskPin(db, {
			organizationId: org,
			actorUserId: ids.managerUser,
			employeeId: ids.worker,
		});

		const { rows } = await pool.query(
			`select action, performed_by from audit_log
			 where organization_id = $1 and entity_id = $2 order by timestamp, action`,
			[org, ids.worker],
		);
		expect(rows.map((row) => [row.action, row.performed_by]).sort()).toEqual(
			[
				["kiosk_pin.issued", ids.ownerUser],
				["kiosk_pin.reset", ids.adminUser],
				["kiosk_pin.unlocked", ids.managerUser],
			].sort(),
		);
	});
});
