/**
 * #487 (S1 of #477): the work transaction coordinator against PostgreSQL.
 *
 * Plans route over a scratch table, so the suite exercises the coordinator's
 * own contract: the rank order as `pg_locks` shows it, restart after a
 * concurrent scope change, exhaustion without residue, every ledger rule,
 * write-target refusal, guard modes and savepoint rollback. Concurrent holders
 * are admin sessions that take the same advisory keys the coordinator takes.
 */
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import {
	runWorkTransaction,
	type WorkRoute,
	type WorkTransactionClient,
	WorkTransactionProtocolViolation,
	WorkTransactionScopeChanged,
} from "./index";
import {
	adoptionGate,
	employeeCoordinationGuard,
	type Guard,
	holdGuard,
	organizationConfigurationGuard,
	sourceIdentityGuard,
	userConfigurationAccessGuard,
} from "./ranks";

const organizationId = "t487-org";
const ids = {
	user: "t487-user",
	lateUser: "t487-late-user",
	employee: "d4870000-0000-4000-8000-000000000001",
	joiner: "d4870000-0000-4000-8000-000000000002",
	source: ["t487-provider", "record-1"],
} as const;

const guards = {
	adoption: adoptionGate(organizationId),
	organization: organizationConfigurationGuard(organizationId),
	user: userConfigurationAccessGuard(ids.user),
	employee: employeeCoordinationGuard(ids.employee),
	source: sourceIdentityGuard(ids.source),
};
const allKeys = [
	...Object.values(guards).map(({ key }) => key),
	employeeCoordinationGuard(ids.joiner).key,
];

type Row = Record<string, unknown>;
const rowsOf = (result: unknown) => (result as { rows: Row[] }).rows;

describe("work transaction coordinator on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	/** Every employee routed for the organization; the first one is the write target. */
	async function routeFromTable(
		db: WorkTransactionClient,
		extra: Partial<WorkRoute> = {},
	): Promise<WorkRoute> {
		const employees = rowsOf(
			await db.execute(
				sql`select employee_id from t487_route where organization_id = ${organizationId} order by employee_id`,
			),
		).map((row) => String(row.employee_id));
		return {
			users: [ids.user],
			employees,
			writeTargets: employees.slice(0, 1),
			sourceIdentities: [ids.source],
			...extra,
		};
	}

	async function backendPid(db: WorkTransactionClient): Promise<number> {
		return Number(rowsOf(await db.execute(sql`select pg_backend_pid() as pid`))[0].pid);
	}

	/** The advisory keys of this suite a backend holds, with their lock modes. */
	async function heldKeys(pid: number): Promise<Map<string, string>> {
		const { rows } = await admin.query<{ key: string; mode: string }>(
			`select key, l.mode
			   from unnest($2::text[]) as key
			   join pg_locks l
			     on l.locktype = 'advisory' and l.granted and l.pid = $1
			    and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(key, 0)`,
			[pid, allKeys],
		);
		return new Map(rows.map(({ key, mode }) => [key, mode]));
	}

	async function suiteLockCount(): Promise<number> {
		const { rows } = await admin.query<{ count: number }>(
			`select count(*)::int as count
			   from pg_locks l
			  where l.locktype = 'advisory'
			    and ((l.classid::bigint << 32) | l.objid::bigint) in
			        (select hashtextextended(key, 0) from unnest($1::text[]) as key)`,
			[allKeys],
		);
		return rows[0].count;
	}

	/** Holds the guard exclusively in an open admin transaction until released. */
	async function holdExclusively(
		guard: Guard,
	): Promise<{ client: PoolClient; release(): Promise<void> }> {
		const client = await admin.connect();
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [guard.key]);
		return {
			client,
			async release() {
				await client.query("rollback");
				client.release();
			},
		};
	}

	/** The backend waiting on the guard, once one is. */
	async function waiterOn(guard: Guard): Promise<number> {
		for (let poll = 0; poll < 400; poll += 1) {
			const { rows } = await admin.query<{ pid: number }>(
				`select l.pid from pg_locks l
				  where l.locktype = 'advisory' and not l.granted
				    and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended($1, 0)`,
				[guard.key],
			);
			if (rows[0]) return rows[0].pid;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`Nothing waited on ${guard.key}`);
	}

	async function notes(): Promise<string[]> {
		const { rows } = await admin.query<{ note: string }>("select note from t487_row order by id");
		return rows.map(({ note }) => note);
	}

	const insertNote = (db: WorkTransactionClient, note: string) =>
		db.execute(sql`insert into t487_row (note) values (${note})`);

	beforeAll(async () => {
		await admin.query(`
			drop table if exists t487_route, t487_row;
			create table t487_route (organization_id text not null, employee_id text not null);
			create table t487_row (id serial primary key, note text not null);
		`);
	});

	beforeEach(async () => {
		await admin.query("truncate t487_route, t487_row");
		await admin.query("insert into t487_route values ($1, $2)", [organizationId, ids.employee]);
	});

	afterAll(async () => {
		await admin.query("drop table if exists t487_route, t487_row");
	});

	describe("rank order", () => {
		const cases: [string, Guard, Guard[]][] = [
			["the adoption gate", guards.adoption, []],
			["the organization configuration guard", guards.organization, [guards.adoption]],
			["the user guard", guards.user, [guards.adoption, guards.organization]],
			["the employee key", guards.employee, [guards.adoption, guards.organization, guards.user]],
			[
				"the source identity",
				guards.source,
				[guards.adoption, guards.organization, guards.user, guards.employee],
			],
		];

		it.each(cases)(
			"holds only the lower ranks while waiting on %s",
			async (_name, blocked, lower) => {
				const holder = await holdExclusively(blocked);
				let run: Promise<string> | undefined;
				try {
					run = runWorkTransaction(
						{ organizationId, route: (db) => routeFromTable(db) },
						async () => "committed",
					);
					const pid = await waiterOn(blocked);
					expect([...(await heldKeys(pid)).keys()].sort()).toEqual(
						lower.map(({ key }) => key).sort(),
					);
				} finally {
					await holder.release();
				}
				await expect(run).resolves.toBe("committed");
				expect(await suiteLockCount()).toBe(0);
			},
		);
	});

	it("restarts after a concurrent scope change and runs on the confirmed scope", async () => {
		const holder = await holdExclusively(guards.employee);
		let routings = 0;
		let run: Promise<readonly string[]> | undefined;
		try {
			run = runWorkTransaction(
				{
					organizationId,
					route: (db) => {
						routings += 1;
						return routeFromTable(db);
					},
				},
				async (scope) => {
					await insertNote(scope.db, "committed");
					return scope.route.employees;
				},
			);
			await waiterOn(guards.employee);
			// Another employee joins the scope while the first attempt waits.
			await admin.query("insert into t487_route values ($1, $2)", [organizationId, ids.joiner]);
		} finally {
			await holder.release();
		}

		await expect(run).resolves.toEqual([ids.employee, ids.joiner]);
		expect(routings).toBe(4);
		expect(await notes()).toEqual(["committed"]);
		expect(await suiteLockCount()).toBe(0);
	});

	it("gives up after 3 changed attempts and leaves no rows and no locks", async () => {
		let routings = 0;
		await expect(
			runWorkTransaction(
				{
					organizationId,
					route: async (db) => {
						routings += 1;
						return { ...(await routeFromTable(db)), snapshot: routings };
					},
				},
				async (scope) => insertNote(scope.db, "never"),
			),
		).rejects.toBeInstanceOf(WorkTransactionScopeChanged);
		expect(routings).toBe(6);

		let attempts = 0;
		await expect(
			runWorkTransaction({ organizationId, route: (db) => routeFromTable(db) }, async (scope) => {
				attempts += 1;
				await insertNote(scope.db, `attempt ${attempts}`);
				scope.restart();
			}),
		).rejects.toBeInstanceOf(WorkTransactionScopeChanged);
		expect(attempts).toBe(3);
		expect(await notes()).toEqual([]);
		expect(await suiteLockCount()).toBe(0);
	});

	describe("ledger", () => {
		const run = (
			operation: (db: WorkTransactionClient) => Promise<unknown>,
			route: (db: WorkTransactionClient) => Promise<WorkRoute> = (db) => routeFromTable(db),
		) =>
			runWorkTransaction({ organizationId, route }, async (scope) => {
				await insertNote(scope.db, "before");
				return operation(scope.db);
			});

		it.each([
			[
				"a lower rank after a higher one",
				(db: WorkTransactionClient) => holdGuard(db, userConfigurationAccessGuard(ids.lateUser)),
			],
			[
				"an upgrade from shared to exclusive",
				(db: WorkTransactionClient) =>
					holdGuard(db, organizationConfigurationGuard(organizationId, "exclusive")),
			],
		])("refuses %s, rolls back and does not retry", async (_name, operation) => {
			let attempts = 0;
			await expect(
				run((db) => {
					attempts += 1;
					return operation(db);
				}),
			).rejects.toBeInstanceOf(WorkTransactionProtocolViolation);
			expect(attempts).toBe(1);
			expect(await notes()).toEqual([]);
			expect(await suiteLockCount()).toBe(0);
		});

		it("allows re-acquiring held guards in the same or a weaker mode", async () => {
			const held = await runWorkTransaction(
				{
					organizationId,
					route: (db) => routeFromTable(db, { guards: { users: "exclusive" } }),
				},
				async (scope) => {
					await holdGuard(scope.db, organizationConfigurationGuard(organizationId, "shared"));
					await holdGuard(scope.db, userConfigurationAccessGuard(ids.user, "shared"));
					await holdGuard(scope.db, employeeCoordinationGuard(ids.employee));
					await holdGuard(scope.db, sourceIdentityGuard(ids.source));
					return heldKeys(await backendPid(scope.db));
				},
			);
			expect(held.get(guards.user.key)).toBe("ExclusiveLock");
			expect(held.get(guards.organization.key)).toBe("ShareLock");
		});

		it("refuses a guard while routing", async () => {
			await expect(
				run(
					async () => undefined,
					async (db) => {
						await holdGuard(db, guards.source);
						return routeFromTable(db);
					},
				),
			).rejects.toThrow(/during routing/);
			expect(await suiteLockCount()).toBe(0);
		});

		it("refuses a guard inside a savepoint", async () => {
			await expect(
				runWorkTransaction({ organizationId, route: (db) => routeFromTable(db) }, (scope) =>
					scope.savepoint((savepoint) =>
						holdGuard(savepoint.db, sourceIdentityGuard(["t487-provider", "late"])),
					),
				),
			).rejects.toThrow(/inside a savepoint/);
		});
	});

	it("refuses write targets outside the routed employees", async () => {
		await expect(
			runWorkTransaction(
				{
					organizationId,
					route: (db) => routeFromTable(db, { writeTargets: [ids.joiner] }),
				},
				async (scope) => insertNote(scope.db, "never"),
			),
		).rejects.toBeInstanceOf(WorkTransactionProtocolViolation);

		await admin.query("insert into t487_route values ($1, $2)", [organizationId, ids.joiner]);
		await expect(
			runWorkTransaction({ organizationId, route: (db) => routeFromTable(db) }, async (scope) => {
				scope.assertEmployee(organizationId, ids.employee);
				// Coordinated, but only protected: not a write target.
				scope.assertEmployee(organizationId, ids.joiner);
			}),
		).rejects.toThrow("Employee scope is outside the work transaction");
		expect(await notes()).toEqual([]);
	});

	it("takes the organization and user guards in the routed modes", async () => {
		const inspect = (route: Partial<WorkRoute>) =>
			runWorkTransaction(
				{ organizationId, route: (db) => routeFromTable(db, route) },
				async (scope) => heldKeys(await backendPid(scope.db)),
			);

		const shared = await inspect({});
		expect(shared.get(guards.adoption.key)).toBe("ShareLock");
		expect(shared.get(guards.organization.key)).toBe("ShareLock");
		expect(shared.get(guards.user.key)).toBe("ShareLock");
		expect(shared.get(guards.employee.key)).toBe("ExclusiveLock");
		expect(shared.get(guards.source.key)).toBe("ExclusiveLock");

		const exclusive = await inspect({ guards: { organization: "exclusive", users: "exclusive" } });
		expect(exclusive.get(guards.organization.key)).toBe("ExclusiveLock");
		expect(exclusive.get(guards.user.key)).toBe("ExclusiveLock");

		const none = await inspect({ guards: { organization: "none" } });
		expect(none.has(guards.organization.key)).toBe(false);
		expect(none.get(guards.adoption.key)).toBe("ShareLock");
	});

	it("rolls a failed savepoint back and keeps the transaction and its guards", async () => {
		const held = await runWorkTransaction(
			{ organizationId, route: (db) => routeFromTable(db) },
			async (scope) => {
				await insertNote(scope.db, "outer");
				await expect(
					scope.savepoint(async (savepoint) => {
						await insertNote(savepoint.db, "rolled back");
						throw new Error("savepoint failed");
					}),
				).rejects.toThrow("savepoint failed");
				await scope.savepoint((savepoint) => insertNote(savepoint.db, "kept"));
				return heldKeys(await backendPid(scope.db));
			},
		);

		expect(await notes()).toEqual(["outer", "kept"]);
		expect(held.get(guards.employee.key)).toBe("ExclusiveLock");
		expect(await suiteLockCount()).toBe(0);
	});
});
