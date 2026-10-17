/**
 * #857: kiosk PINs on PostgreSQL. Issue, reset, own change, unlock and
 * verification through the PIN store, including who may manage a PIN, the
 * organization boundary, hash-only storage and the per-employee lockout.
 */

import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Clock, type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("server-only", () => ({}));

const {
	issueKioskPin,
	judgeKioskPinAttempt,
	pruneKioskPinEvents,
	readKioskPinLockout,
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

		await unlockKioskPin(
			db,
			{
				organizationId: org,
				actorUserId: ids.managerUser,
				employeeId: ids.worker,
			},
			clock,
		);

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

	describe("lockout replayed in the order attempts happened (#1288)", () => {
		/** An attempt judged at the instant it happened, as a queued kiosk command arriving late. */
		const judgeLate = (pin: string | (() => Promise<string>), at: string, clock: Clock) =>
			db.transaction((tx) =>
				judgeKioskPinAttempt(
					tx,
					{
						organizationId: org,
						employeeId: ids.worker,
						at: parseInstant(at),
						offline: true,
						pin,
					},
					clock,
				),
			);
		const lockedUntilAt = async (at: string, organizationId: string = org) =>
			(
				await readKioskPinLockout(db, { organizationId, employeeId: ids.worker }, parseInstant(at))
			).lockedUntil?.toString() ?? null;
		const storedEvents = async () =>
			(
				await pool.query(
					"select kind, offline from employee_kiosk_pin_event where employee_id = $1 order by occurred_at, sequence",
					[ids.worker],
				)
			).rows;

		async function issuedPin() {
			const { pin } = await issueFor(ids.ownerUser);
			return { pin, wrong: pin === "000000" ? "111111" : "000000" };
		}

		it("counts late failures from another kiosk with online ones, in the order they happened", async () => {
			const clock = fixedClock("2026-03-02T08:00:00Z");
			const { pin, wrong } = await issuedPin();
			for (const at of ["08:00", "08:02", "08:04"]) {
				clock.set(`2026-03-02T${at}:00Z`);
				await expect(verify(wrong, clock)).resolves.toEqual({ status: "wrong_pin" });
			}

			clock.set("2026-03-02T08:30:00Z");
			await expect(judgeLate(wrong, "2026-03-02T08:01:00Z", clock)).resolves.toEqual({
				status: "wrong_pin",
			});
			await expect(judgeLate(wrong, "2026-03-02T08:03:00Z", clock)).resolves.toEqual({
				status: "wrong_pin",
			});

			// The online failure at 08:04 turns out to have been the fifth.
			expect(await lockedUntilAt("2026-03-02T08:03:59Z")).toBeNull();
			expect(await lockedUntilAt("2026-03-02T08:04:00Z")).toBe("2026-03-02T08:19:00Z");
			const late = await judgeLate(pin, "2026-03-02T08:10:00Z", clock);
			expect(late.status === "locked" && late.until.toString()).toBe("2026-03-02T08:19:00Z");
			await expect(verify(pin, clock)).resolves.toEqual({ status: "verified" });
			expect(await lockedUntilAt("2026-03-02T08:04:00Z", ids.otherOrganization)).toBeNull();
		});

		it("refuses a correct PIN within 15 minutes after the fifth failure and accepts it after", async () => {
			const clock = fixedClock("2026-03-02T09:00:00Z");
			const { pin, wrong } = await issuedPin();
			for (const minute of ["00", "01", "02", "03"]) {
				await expect(judgeLate(wrong, `2026-03-02T08:${minute}:00Z`, clock)).resolves.toEqual({
					status: "wrong_pin",
				});
			}
			const fifth = await judgeLate(wrong, "2026-03-02T08:04:00Z", clock);
			expect(fifth.status === "locked" && fifth.until.toString()).toBe("2026-03-02T08:19:00Z");

			// Five queued failures just arrived: the arrival throttle holds further ones for 15 minutes.
			clock.set("2026-03-02T09:15:00Z");
			await expect(judgeLate(pin, "2026-03-02T08:18:59Z", clock)).resolves.toMatchObject({
				status: "locked",
			});
			await expect(judgeLate(pin, "2026-03-02T08:19:00Z", clock)).resolves.toEqual({
				status: "verified",
			});
		});

		it("never lets failures from a past lock lock the employee now", async () => {
			const clock = fixedClock("2026-03-02T09:00:00Z");
			const { pin, wrong } = await issuedPin();
			for (const minute of ["00", "01", "02", "03", "04"]) {
				await judgeLate(wrong, `2026-03-02T08:${minute}:00Z`, clock);
			}

			await expect(verify(pin, clock)).resolves.toEqual({ status: "verified" });
			await expect(
				readKioskPinStatus(
					db,
					{ organizationId: org, actorUserId: ids.ownerUser, employeeId: ids.worker },
					clock,
				),
			).resolves.toEqual({ hasPin: true, lockedUntil: null });
		});

		it("honours an unlock from the instant it happened", async () => {
			const clock = fixedClock("2026-03-02T08:00:00Z");
			const { pin, wrong } = await issuedPin();
			for (let attempt = 1; attempt <= 5; attempt += 1) await verify(wrong, clock);
			clock.set("2026-03-02T08:10:00Z");
			await unlockKioskPin(
				db,
				{ organizationId: org, actorUserId: ids.managerUser, employeeId: ids.worker },
				clock,
			);

			clock.set("2026-03-02T08:30:00Z");
			await expect(judgeLate(pin, "2026-03-02T08:05:00Z", clock)).resolves.toMatchObject({
				status: "locked",
			});
			await expect(judgeLate(pin, "2026-03-02T08:11:00Z", clock)).resolves.toEqual({
				status: "verified",
			});
		});

		it("neither reads the PIN nor stores the attempt inside a lock", async () => {
			const clock = fixedClock("2026-03-02T08:00:00Z");
			const { wrong } = await issuedPin();
			for (let attempt = 1; attempt <= 5; attempt += 1) await verify(wrong, clock);

			const neverOpened = vi.fn(async () => wrong);
			await expect(judgeLate(neverOpened, "2026-03-02T08:05:00Z", clock)).resolves.toMatchObject({
				status: "locked",
			});
			expect(neverOpened).not.toHaveBeenCalled();
			expect(await storedEvents()).toEqual(
				Array.from({ length: 5 }, () => ({ kind: "failure", offline: false })),
			);
		});

		it("stores failed and correct attempts with their instants, but never the PIN", async () => {
			const clock = fixedClock("2026-03-02T08:00:00Z");
			const { pin, wrong } = await issuedPin();
			await verify(wrong, clock);
			await judgeLate(pin, "2026-03-02T07:55:00Z", clock);

			const { rows } = await pool.query(
				"select * from employee_kiosk_pin_event where employee_id = $1 order by occurred_at",
				[ids.worker],
			);
			expect(rows).toEqual([
				expect.objectContaining({
					organization_id: org,
					kind: "success",
					offline: true,
					occurred_at: new Date("2026-03-02T07:55:00Z"),
				}),
				expect.objectContaining({
					organization_id: org,
					kind: "failure",
					offline: false,
					occurred_at: new Date("2026-03-02T08:00:00Z"),
				}),
			]);
			for (const row of rows) {
				expect(Object.keys(row).sort()).toEqual([
					"employee_id",
					"id",
					"kind",
					"occurred_at",
					"offline",
					"operation_id",
					"organization_id",
					"recorded_at",
					"sequence",
				]);
			}
		});

		it("prunes stored events once they can no longer affect any check", async () => {
			const clock = fixedClock("2026-03-02T08:00:00Z");
			const { wrong } = await issuedPin();
			for (let attempt = 1; attempt <= 3; attempt += 1) await verify(wrong, clock);

			// Seven days of delayed admission plus the 15-minute lock.
			clock.set("2026-03-09T08:15:00Z");
			await expect(verify(wrong, clock)).resolves.toEqual({ status: "wrong_pin" });
			expect(await storedEvents()).toHaveLength(4);

			clock.set("2026-03-09T08:15:01Z");
			await expect(verify(wrong, clock)).resolves.toEqual({ status: "wrong_pin" });
			expect(await storedEvents()).toHaveLength(2);

			await expect(
				pruneKioskPinEvents(db, parseInstant("2026-03-16T08:30:02Z")),
			).resolves.toBeGreaterThanOrEqual(2);
			expect(await storedEvents()).toEqual([]);
		});
	});

	describe("judgment order and the arrival throttle (#885 review)", () => {
		const queued = (
			pin: string | (() => Promise<string>),
			at: string,
			clock: Clock,
			operationId?: string,
		) =>
			db.transaction((tx) =>
				judgeKioskPinAttempt(
					tx,
					{
						organizationId: org,
						employeeId: ids.worker,
						at: parseInstant(at),
						offline: true,
						...(operationId ? { operationId } : {}),
						pin,
					},
					clock,
				),
			);
		const storedEvents = async () =>
			(
				await pool.query<{ kind: string; offline: boolean; occurred_at: Date }>(
					`select kind, offline, occurred_at from employee_kiosk_pin_event
					 where employee_id = $1 order by occurred_at, sequence`,
					[ids.worker],
				)
			).rows;
		async function issuedPin() {
			const { pin } = await issueFor(ids.ownerUser);
			return { pin, wrong: pin === "000000" ? "111111" : "000000" };
		}

		it("judges an online attempt after the PIN row's lock, never before the latest online event", async () => {
			const { pin, wrong } = await issuedPin();
			const clock = fixedClock("2026-03-02T08:00:00Z");
			for (let attempt = 1; attempt <= 5; attempt += 1) await verify(wrong, clock);

			// A server whose clock runs a minute behind still meets the lock it would not see at 07:59.
			const locked = await verify(pin, fixedClock("2026-03-02T07:59:00Z"));
			expect(locked.status === "locked" && locked.until.toString()).toBe("2026-03-02T08:15:00Z");
			expect(await storedEvents()).toHaveLength(5);
		});

		it("checks at most five PINs however skewed the clocks of concurrent online attempts", async () => {
			const { wrong } = await issuedPin();

			const results = await Promise.all(
				Array.from({ length: 8 }, (_, index) =>
					verify(wrong, fixedClock(`2026-03-02T08:00:0${7 - index}Z`)),
				),
			);

			expect(results.filter((result) => result.status === "wrong_pin")).toHaveLength(4);
			expect(results.filter((result) => result.status === "locked")).toHaveLength(4);
			expect(await storedEvents()).toHaveLength(5);
		});

		it("judges a queued attempt that claims the future at arrival, so no lock starts after it", async () => {
			const clock = fixedClock("2026-03-02T08:00:00Z");
			const { wrong } = await issuedPin();
			for (let attempt = 1; attempt <= 4; attempt += 1) {
				await expect(queued(wrong, "2026-03-02T08:04:00Z", clock)).resolves.toEqual({
					status: "wrong_pin",
				});
			}

			const fifth = await queued(wrong, "2026-03-02T08:04:00Z", clock);

			expect(fifth.status === "locked" && fifth.until.toString()).toBe("2026-03-02T08:15:00Z");
			expect(
				new Set((await storedEvents()).map((event) => event.occurred_at.toISOString())),
			).toEqual(new Set(["2026-03-02T08:00:00.000Z"]));
		});

		it("stops a descending-instant attack after five queued failures, without checking a sixth PIN", async () => {
			const clock = fixedClock("2026-03-02T12:00:00Z");
			const { pin, wrong } = await issuedPin();
			// Each claims an instant before the last, so the lockout replay never sees an earlier failure.
			for (let step = 0; step < 5; step += 1) {
				await expect(queued(wrong, `2026-03-02T11:59:5${9 - step}Z`, clock)).resolves.toEqual({
					status: "wrong_pin",
				});
			}

			const opened = vi.fn(async () => pin);
			const throttled = await queued(opened, "2026-03-02T11:00:00Z", clock);

			expect(throttled.status === "throttled" && throttled.retryAfter.toString()).toBe(
				"2026-03-02T12:15:00Z",
			);
			expect(opened).not.toHaveBeenCalled();
			expect(await storedEvents()).toHaveLength(5);
			// Online attempts are not throttled: the lockout alone judges them, and the five
			// failures, replayed in the order they claim, lock from the fifth (11:59:59).
			await expect(verify(pin, clock)).resolves.toMatchObject({ status: "locked" });

			// After the wait, the employee's own command, resent unchanged, is checked and accepted.
			clock.set("2026-03-02T12:15:00Z");
			await expect(queued(pin, "2026-03-02T11:00:00Z", clock)).resolves.toEqual({
				status: "verified",
			});
		});

		it("answers a resend of a judged queued command with its verdict, never a second check", async () => {
			const clock = fixedClock("2026-03-02T09:00:00Z");
			const { wrong } = await issuedPin();
			const operationId = "c8850000-0000-4000-8000-000000000001";
			await expect(queued(wrong, "2026-03-02T08:00:00Z", clock, operationId)).resolves.toEqual({
				status: "wrong_pin",
			});

			const opened = vi.fn(async () => wrong);
			await expect(queued(opened, "2026-03-02T08:00:00Z", clock, operationId)).resolves.toEqual({
				status: "wrong_pin",
			});

			expect(opened).not.toHaveBeenCalled();
			expect(await storedEvents()).toMatchObject([{ kind: "failure", offline: true }]);
			const { rows } = await pool.query(
				"select operation_id from employee_kiosk_pin_event where employee_id = $1",
				[ids.worker],
			);
			expect(rows).toEqual([{ operation_id: operationId }]);
		});

		it("converts the dropped counter and lock columns into events, as migration 0243 does", async () => {
			const migration = readFileSync(
				new URL("../../../../drizzle/0243_kiosk_pin_lockout_events.sql", import.meta.url),
				"utf8",
			);
			const conversions = migration
				.split("--> statement-breakpoint")
				.map((statement) => statement.trim())
				.filter((statement) => statement.startsWith('INSERT INTO "employee_kiosk_pin_event"'));
			expect(conversions).toHaveLength(2);

			const client = await pool.connect();
			let lockedUntil: Date;
			try {
				// The columns as they were before 0243, in a table of their own.
				await client.query(
					`create temporary table legacy_pin
					 (organization_id text, employee_id uuid, failed_attempts integer, locked_until timestamptz)`,
				);
				await client.query(
					`insert into legacy_pin values
					 ($1, $2, 0, now() + interval '10 minutes'),
					 ($1, $3, 3, null),
					 ($1, $4, 0, now() - interval '1 minute')`,
					[org, ids.worker, ids.manager, ids.admin],
				);
				for (const conversion of conversions) {
					await client.query(
						conversion.replaceAll('FROM "employee_kiosk_pin"', "FROM pg_temp.legacy_pin"),
					);
				}
				const { rows } = await client.query<{ locked_until: Date }>(
					"select locked_until from legacy_pin where employee_id = $1",
					[ids.worker],
				);
				lockedUntil = rows[0]?.locked_until as Date;
				await client.query("drop table pg_temp.legacy_pin");
			} finally {
				client.release();
			}

			// Read a minute later than the database's now(), whatever the clocks' drift.
			const at = parseInstant(new Date(Date.now() + 60_000).toISOString());
			const lockout = (employeeId: string) =>
				readKioskPinLockout(db, { organizationId: org, employeeId }, at);
			// An active lock stays the same lock: five failures at its start.
			expect((await lockout(ids.worker)).lockedUntil?.epochMilliseconds).toBe(
				lockedUntil.getTime(),
			);
			// A running count keeps counting towards the next lock.
			await expect(lockout(ids.manager)).resolves.toEqual({ lockedUntil: null, failures: 3 });
			// An expired lock is gone.
			await expect(lockout(ids.admin)).resolves.toEqual({ lockedUntil: null, failures: 0 });
		});
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
