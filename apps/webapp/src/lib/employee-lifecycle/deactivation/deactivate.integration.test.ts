/**
 * #1638: `deactivate` is the whole of an admin's Deactivate behind one call.
 * Against PostgreSQL, through that interface, this suite checks what the
 * settings action used to hold itself: the locks and their order, the replay
 * of a request ID, the target rules, the refusal, and the after-commit work
 * with its order and its replay rules. The consequences themselves are covered
 * by deactivation.integration.test.ts and the area suites.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry } from "@/lib/audit-logger";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications/notification-service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/notifications/notification-service")>()),
	createNotification,
}));
vi.mock("@/lib/queue", async (importOriginal) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(importOriginal),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { AuditAction } = await import("@/lib/audit-logger");
const { deactivate } = await import("./command");
type DeactivationEffects = import("./command").DeactivationEffects;
const { runAfterCommitSteps } = await import("./sequence");
const { DeactivationRequestConflictError, markDeactivationReactivated } = await import(
	"../receipts"
);
const { createLifecycleDatabaseFixture } = await import("../testing/database.test.fixture");
type LifecycleDatabaseFixture = import("../testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("../testing/database.test.fixture").SeededEmployee;
const { employeeCoordinationGuard, organizationConfigurationGuard, userConfigurationAccessGuard } =
	await import("@/lib/time-tracking/work-transaction/ranks");
const { shiftStoredDate } = await import("@/lib/scheduling/shift-date");

const ZONE = "Europe/Berlin";
// 10:00 on Saturday, 24 October 2026 in Berlin.
const AT: Instant = parseInstant("2026-10-24T08:00:00Z");
const clock = { nowInstant: () => AT };
const ACTOR_EMAIL = "owner@example.test";

describe("deactivate (#1638)", () => {
	let fixture: LifecycleDatabaseFixture;
	let subareaId: string;
	/** What ran after the commit, in order. */
	let events: string[];
	let audits: AuditLogEntry[];

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
			fixture.organizationId,
			ZONE,
		]);
		const locationId = randomUUID();
		subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Store', $3, now())`,
			[locationId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at) values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, fixture.ownerUserId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		events = [];
		audits = [];
		createNotification.mockReset();
		createNotification.mockImplementation(async (notification: { type: string }) => {
			if (notification.type === "employee_deactivation_shifts_opened") {
				events.push("planner-notice");
			}
			return { id: "notification" };
		});
	});

	function effects(overrides: Partial<DeactivationEffects> = {}): DeactivationEffects {
		return {
			revokeSessions: vi.fn(async () => {
				events.push("sessions-revoked");
			}),
			logAudit: vi.fn(async (entry: AuditLogEntry) => {
				events.push("audit-logged");
				audits.push(entry);
			}),
			reconcileSeats: vi.fn(async () => {
				events.push("seats-reconciled");
			}),
			pauseOwnedExports: vi.fn(async () => {
				events.push("exports-paused");
			}),
			...overrides,
		};
	}

	function command(
		person: SeededEmployee,
		overrides: Partial<Parameters<typeof deactivate>[1]> = {},
	) {
		return {
			organizationId: fixture.organizationId,
			actorUserId: fixture.ownerUserId,
			actorEmail: ACTOR_EMAIL,
			employeeId: person.employeeId,
			requestId: randomUUID(),
			replacementManagers: {},
			...overrides,
		};
	}

	async function named(
		name: string,
		input: Parameters<LifecycleDatabaseFixture["seedEmployee"]>[0] = {},
	) {
		const seeded = await fixture.seedEmployee(input);
		await fixture.pool.query(`update "user" set name = $2 where id = $1`, [seeded.userId, name]);
		return seeded;
	}

	async function manages(manager: SeededEmployee, report: SeededEmployee) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[report.employeeId, manager.employeeId, fixture.ownerUserId],
		);
	}

	/** A later shift: the deactivation opens it and tells the planners after the commit. */
	async function withLaterShift(person: SeededEmployee) {
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, '08:00', '16:00', 'published', $6, now())`,
			[
				randomUUID(),
				fixture.organizationId,
				person.employeeId,
				subareaId,
				shiftStoredDate("2026-10-30", ZONE),
				fixture.ownerUserId,
			],
		);
	}

	async function employeeRow(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ is_active: boolean; deactivated_at: Date | null }>(
			`select is_active, deactivated_at from employee where id = $1`,
			[person.employeeId],
		);
		return rows[0];
	}

	async function ledger(person: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ id: string; status: string; request_id: string }>(
			`select id, status, request_id from employee_deactivation where employee_id = $1`,
			[person.employeeId],
		);
		return rows;
	}

	describe("after the commit", () => {
		it("runs the consequences' steps, then sessions, the audit entry, seats and exports", async () => {
			const person = await named("Paula Person");
			await withLaterShift(person);
			const request = command(person);
			const used = effects();

			const outcome = await deactivate(db, request, { clock, effects: used });

			expect(outcome).toEqual({
				kind: "deactivated",
				deactivationId: expect.any(String),
				warnings: [],
			});
			if (outcome.kind !== "deactivated") throw new Error("not deactivated");
			expect(await employeeRow(person)).toEqual({
				is_active: false,
				deactivated_at: new Date(AT.toString()),
			});
			expect(await ledger(person)).toEqual([
				{ id: outcome.deactivationId, status: "applied", request_id: request.requestId },
			]);
			expect(events).toEqual([
				"planner-notice",
				"sessions-revoked",
				"audit-logged",
				"seats-reconciled",
				"exports-paused",
			]);
			expect(used.revokeSessions).toHaveBeenCalledExactlyOnceWith(
				person.userId,
				fixture.organizationId,
			);
			expect(audits).toEqual([
				{
					action: AuditAction.EMPLOYEE_DEACTIVATED,
					actorId: fixture.ownerUserId,
					actorEmail: ACTOR_EMAIL,
					employeeId: person.employeeId,
					targetId: person.employeeId,
					targetType: "employee",
					organizationId: fixture.organizationId,
					changes: { isActive: { from: true, to: false } },
					metadata: { reason: "employee_deactivated", deactivationId: outcome.deactivationId },
					timestamp: expect.any(Date),
				},
			]);
			expect(used.reconcileSeats).toHaveBeenCalledExactlyOnceWith(fixture.organizationId);
			expect(used.pauseOwnedExports).toHaveBeenCalledExactlyOnceWith(db, {
				organizationId: fixture.organizationId,
				owner: { userId: person.userId },
				actorUserId: fixture.ownerUserId,
			});
		});

		it("replays a request ID: nothing is applied or audited twice, the repeatable work runs again", async () => {
			const person = await named("Rita Replay");
			await withLaterShift(person);
			const request = command(person);
			await deactivate(db, request, { clock, effects: effects() });
			const before = await ledger(person);
			events = [];
			audits = [];

			const outcome = await deactivate(db, request, { clock, effects: effects() });

			expect(outcome).toEqual({ kind: "replayed", reactivatedSince: false, warnings: [] });
			expect(await ledger(person)).toEqual(before);
			expect(events).toEqual([
				"planner-notice",
				"sessions-revoked",
				"seats-reconciled",
				"exports-paused",
			]);
			expect(audits).toEqual([]);
		});

		it("repeats nothing for a replayed request whose deactivation was reactivated since", async () => {
			const person = await named("Rhea Returned");
			await withLaterShift(person);
			const request = command(person);
			await deactivate(db, request, { clock, effects: effects() });
			await fixture.pool.query(`update employee set is_active = true where id = $1`, [
				person.employeeId,
			]);
			await markDeactivationReactivated(db, {
				organizationId: fixture.organizationId,
				employeeId: person.employeeId,
				reactivatedAt: parseInstant("2026-10-25T08:00:00Z"),
				reactivatedBy: fixture.ownerUserId,
				reactivationRequestId: randomUUID(),
			});
			events = [];

			const outcome = await deactivate(db, request, { clock, effects: effects() });

			expect(outcome).toEqual({ kind: "replayed", reactivatedSince: true, warnings: [] });
			expect(events).toEqual([]);
			expect(await employeeRow(person)).toMatchObject({ is_active: true });
		});

		it("only revokes the sessions again of someone who is already a former employee", async () => {
			const person = await named("Fred Former", { isActive: false });

			const outcome = await deactivate(db, command(person), { clock, effects: effects() });

			expect(outcome).toEqual({ kind: "unchanged", warnings: [] });
			expect(events).toEqual(["sessions-revoked"]);
			expect(await ledger(person)).toEqual([]);
		});

		it("reports a failed session cleanup as a warning and finishes the rest", async () => {
			const person = await named("Sam Sessions");
			const used = effects({
				revokeSessions: async () => {
					events.push("sessions-revoked");
					throw new Error("redis://secret-host failed");
				},
			});

			const outcome = await deactivate(db, command(person), { clock, effects: used });

			expect(outcome).toEqual({
				kind: "deactivated",
				deactivationId: expect.any(String),
				warnings: ["Session cleanup is pending"],
			});
			expect(events).toEqual([
				"sessions-revoked",
				"audit-logged",
				"seats-reconciled",
				"exports-paused",
			]);
		});

		it("passes on a failed export pause, with the deactivation committed", async () => {
			const person = await named("Erin Exports");
			const used = effects({
				pauseOwnedExports: async () => {
					throw new Error("pause failed");
				},
			});

			await expect(deactivate(db, command(person), { clock, effects: used })).rejects.toThrow(
				"pause failed",
			);

			expect(await employeeRow(person)).toMatchObject({ is_active: false });
			expect(await ledger(person)).toHaveLength(1);
		});

		it("reports a failing step and still runs the next one", async () => {
			const ran: string[] = [];
			const failures: unknown[] = [];

			const warnings = await runAfterCommitSteps(
				[
					async () => {
						ran.push("first");
					},
					async () => {
						ran.push("second");
						throw new Error("calendar queue down");
					},
					async () => {
						ran.push("third");
					},
				],
				(error) => failures.push(error),
			);

			expect(ran).toEqual(["first", "second", "third"]);
			expect(warnings).toEqual(["calendar queue down"]);
			expect(failures).toEqual([new Error("calendar queue down")]);
		});
	});

	describe("refusals", () => {
		async function expectNothingHappened(person: SeededEmployee, wasActive = true) {
			expect(events).toEqual([]);
			expect(await ledger(person)).toEqual([]);
			expect(await employeeRow(person)).toMatchObject({ is_active: wasActive });
		}

		it("refuses a request ID used before with other picks", async () => {
			const person = await named("Cora Conflict");
			const pick = await named("Petra Pick", { role: "admin" });
			const request = command(person);
			await deactivate(db, request, { clock, effects: effects() });

			await expect(
				deactivate(
					db,
					{ ...request, replacementManagers: { [fixture.employeeId]: pick.employeeId } },
					{ clock, effects: effects() },
				),
			).rejects.toBeInstanceOf(DeactivationRequestConflictError);
		});

		it("refuses without writing while a report still needs a replacement manager", async () => {
			const person = await named("Mona Manager");
			const report = await named("Rob Report");
			await manages(person, report);

			const outcome = await deactivate(db, command(person), { clock, effects: effects() });

			expect(outcome).toEqual({
				kind: "refused",
				reports: [
					{ employeeId: report.employeeId, name: "Rob Report", refusal: "replacement_missing" },
				],
			});
			await expectNothingHappened(person);
		});

		it("rejects an employee of another organization and an unknown organization as not found", async () => {
			const otherOrganizationId = await fixture.createOrganization();
			const stranger = await fixture.seedEmployee({ organizationId: otherOrganizationId });
			const person = await named("Nora Nowhere");

			expect(await deactivate(db, command(stranger), { clock, effects: effects() })).toEqual({
				kind: "rejected",
				refusal: { type: "not_found" },
			});
			await expectNothingHappened(stranger);
			expect(
				await deactivate(db, command(person, { organizationId: randomUUID() }), {
					clock,
					effects: effects(),
				}),
			).toEqual({ kind: "rejected", refusal: { type: "not_found" } });
			await expectNothingHappened(person);
		});

		it("rejects an actor who is not an approved owner or admin", async () => {
			const person = await named("Tina Target");
			const colleague = await named("Carl Colleague");

			const outcome = await deactivate(db, command(person, { actorUserId: colleague.userId }), {
				clock,
				effects: effects(),
			});

			expect(outcome).toEqual({
				kind: "rejected",
				refusal: { type: "actor_membership_missing" },
			});
			await expectNothingHappened(person);
		});

		it("rejects deactivating oneself", async () => {
			const admin = await named("Ada Admin", { role: "admin" });

			const outcome = await deactivate(db, command(admin, { actorUserId: admin.userId }), {
				clock,
				effects: effects(),
			});

			expect(outcome).toEqual({ kind: "rejected", refusal: { type: "self_target" } });
			await expectNothingHappened(admin);
		});

		it("rejects a target without an approved membership", async () => {
			const person = await named("Mia Memberless");
			await fixture.pool.query(`delete from member where id = $1`, [person.memberId]);

			const outcome = await deactivate(db, command(person), { clock, effects: effects() });

			expect(outcome).toEqual({
				kind: "rejected",
				refusal: { type: "target_membership_missing" },
			});
			await expectNothingHappened(person);
		});

		it.each(["owner", "owner,admin", " member , owner "])(
			"rejects an admin deactivating an owner with the role %j",
			async (role) => {
				const admin = await named("Ada Admin", { role: "admin" });
				const owner = await named("Olga Owner", { role: "owner" });
				await fixture.pool.query(`update member set role = $2 where id = $1`, [
					owner.memberId,
					role,
				]);

				const outcome = await deactivate(db, command(owner, { actorUserId: admin.userId }), {
					clock,
					effects: effects(),
				});

				expect(outcome).toEqual({ kind: "rejected", refusal: { type: "admin_targeting_owner" } });
				await expectNothingHappened(owner);
			},
		);

		it("rejects the last accessible owner: an owner who is a former employee does not count", async () => {
			const organizationId = await fixture.createOrganization();
			const lastOwner = await fixture.seedEmployee({ organizationId, role: "owner" });
			const formerOwner = await fixture.seedEmployee({
				organizationId,
				role: "owner",
				isActive: false,
			});
			const request = command(lastOwner, { organizationId, actorUserId: formerOwner.userId });

			expect(await deactivate(db, request, { clock, effects: effects() })).toEqual({
				kind: "rejected",
				refusal: { type: "final_accessible_owner" },
			});
			await expectNothingHappened(lastOwner);

			// With another accessible owner, the same request goes through.
			await fixture.seedEmployee({ organizationId, role: "owner" });
			expect(await deactivate(db, request, { clock, effects: effects() })).toMatchObject({
				kind: "deactivated",
			});
		});
	});

	describe("locks", () => {
		/** The advisory keys among `keys` the backend holds. */
		async function heldKeys(pid: number, keys: readonly string[]): Promise<string[]> {
			const { rows } = await fixture.pool.query<{ key: string }>(
				`select key from unnest($2::text[]) as key
				   join pg_locks l
				     on l.locktype = 'advisory' and l.granted and l.pid = $1
				    and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(key, 0)`,
				[pid, keys],
			);
			return rows.map(({ key }) => key).toSorted();
		}

		async function poll(text: string, params: unknown[], what: string): Promise<number> {
			for (let attempt = 0; attempt < 400; attempt += 1) {
				const { rows } = await fixture.pool.query<{ pid: number }>(text, params);
				if (rows[0]) return rows[0].pid;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			throw new Error(`Nothing waited on ${what}`);
		}

		it("holds the configuration and user guards before the employee key, and that before the organization row", async () => {
			const person = await named("Lena Locks");
			const report = await named("Rudi Report");
			const ownManager = await named("Maja Manager", { role: "admin" });
			const replacement = await named("Rene Replacement", { role: "admin" });
			await manages(person, report);
			await manages(ownManager, person);
			const employeeKey = employeeCoordinationGuard(person.employeeId).key;
			const earlierKeys = [
				organizationConfigurationGuard(fixture.organizationId, "exclusive").key,
				...[person, report, ownManager, replacement].map(
					(employee) => userConfigurationAccessGuard(employee.userId, "exclusive").key,
				),
			].toSorted();

			const blocker: PoolClient = await fixture.pool.connect();
			let running: ReturnType<typeof deactivate> | null = null;
			try {
				await blocker.query("select pg_advisory_lock(hashtextextended($1, 0))", [employeeKey]);
				await blocker.query("begin");
				await blocker.query("select id from organization where id = $1 for update", [
					fixture.organizationId,
				]);

				running = deactivate(
					db,
					command(person, { replacementManagers: { [report.employeeId]: replacement.employeeId } }),
					{ clock, effects: effects() },
				);

				// Waiting on the employee key, it already holds every earlier guard.
				const pid = await poll(
					`select l.pid from pg_locks l
					  where l.locktype = 'advisory' and not l.granted
					    and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended($1, 0)`,
					[employeeKey],
					"the employee key",
				);
				expect(await heldKeys(pid, earlierKeys)).toEqual(earlierKeys);
				expect(await heldKeys(pid, [employeeKey])).toEqual([]);

				// Then it takes the employee key and waits on the organization row.
				await blocker.query("select pg_advisory_unlock(hashtextextended($1, 0))", [employeeKey]);
				await poll(
					`select l.pid from pg_locks l
					  where l.pid = $1 and not l.granted and l.locktype in ('transactionid', 'tuple')`,
					[pid],
					"the organization row",
				);
				expect(await heldKeys(pid, [employeeKey])).toEqual([employeeKey]);
				expect(await ledger(person)).toEqual([]);

				await blocker.query("commit");
				await expect(running).resolves.toMatchObject({ kind: "deactivated" });
			} finally {
				await blocker.query("rollback").catch(() => undefined);
				await blocker
					.query("select pg_advisory_unlock(hashtextextended($1, 0))", [employeeKey])
					.catch(() => undefined);
				blocker.release();
				await running?.catch(() => undefined);
			}
		});
	});
});
