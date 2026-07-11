import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface TransactionContext {
	inserts: Array<Record<string, unknown>>;
	insertResults: Array<{ values: Record<string, unknown>; id: string; hash: string }>;
	pendingInsert?: Record<string, unknown>;
	predicateUpdates: Array<{
		values: Record<string, unknown>;
		predicate: Record<string, unknown>;
	}>;
	releaseLocks: Array<() => void>;
	rowChanges: Map<string, { before: Record<string, unknown>; after: Record<string, unknown> }>;
	updates: Array<Record<string, unknown>>;
}

const transactionStorage = new AsyncLocalStorage<TransactionContext>();

const dbMock = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
	persistedRows: new Map<string, Record<string, unknown>>(),
	latestEntries: new Map<string, { id: string; hash: string }>(),
	timeEntries: [] as Array<Record<string, unknown>>,
	employees: new Map<string, { id: string; organizationId: string }>(),
	categories: new Map<string, { id: string; organizationId: string; name: string }>(),
	transaction: vi.fn(),
	execute: vi.fn(),
	select: vi.fn(),
	update: vi.fn(),
	insert: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	from: vi.fn(),
	orderBy: vi.fn(),
	limit: vi.fn(),
	values: vi.fn(),
	returning: vi.fn(),
	insertCalls: [] as Array<Record<string, unknown>>,
	updates: [] as Array<Record<string, unknown>>,
	updatePredicates: [] as Array<{
		values: Record<string, unknown>;
		predicate: Record<string, unknown>;
	}>,
	beforeUpdate: undefined as ((values: Record<string, unknown>) => Promise<void>) | undefined,
	afterUpdate: undefined as
		| ((
				values: Record<string, unknown>,
				matchedRows: Array<Record<string, unknown>>,
		  ) => Promise<void>)
		| undefined,
	beforeStatusRead: undefined as (() => Promise<void>) | undefined,
	afterRollback: undefined as (() => Promise<void>) | undefined,
	beforeRollbackRestore: undefined as (() => Promise<void>) | undefined,
	afterLockAcquired: undefined as ((acquisition: number) => Promise<void>) | undefined,
	candidateBarrier: undefined as (() => Promise<void>) | undefined,
	advisoryLocks: new Map<string, Promise<void>>(),
	nextCreatedId: 1,
	lockAcquisitions: 0,
	query: {
		employee: { findFirst: vi.fn() },
		absenceCategory: { findFirst: vi.fn() },
		timeEntry: { findFirst: vi.fn() },
		importStagedRow: { findFirst: vi.fn(), findMany: vi.fn() },
	},
}));

vi.mock("@/db", () => ({
	db: {
		transaction: dbMock.transaction,
		select: dbMock.select,
		update: dbMock.update,
		insert: dbMock.insert,
		execute: dbMock.execute,
		query: dbMock.query,
	},
}));

vi.mock("@/lib/time-tracking/blockchain", () => ({
	calculateHash: vi.fn(({ employeeId, type, timestamp, previousHash }) =>
		[`hash`, employeeId, type, timestamp, previousHash ?? "genesis"].join(":"),
	),
}));

const { commitAcceptedRowsForEntity } = await import("./committers");
const { calculateHash } = await import("@/lib/time-tracking/blockchain");

function commitJob(entityType: "work_period" | "absence") {
	return {
		type: "import-review-commit" as const,
		batchId: "batch_1",
		jobId: "job_1",
		organizationId: "org_1",
		entityType,
		committedBy: "user_1",
	};
}

function stagedRow(overrides: Record<string, unknown>) {
	return {
		id: "row_1",
		batchId: "batch_1",
		organizationId: "org_1",
		entityType: "work_period",
		rowStatus: "accepted",
		normalizedPayload: {},
		...overrides,
	};
}

function predicateValues(condition: unknown) {
	const values: Record<string, unknown> = {};
	const columnNames: Record<string, string> = {
		batch_id: "batchId",
		entity_type: "entityType",
		id: "id",
		organization_id: "organizationId",
		row_status: "rowStatus",
	};

	function visit(node: unknown) {
		if (!node || typeof node !== "object") return;
		const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
		if (!chunks) return;

		for (let index = 0; index < chunks.length; index++) {
			const column = chunks[index] as { name?: unknown };
			const parameter = chunks[index + 2] as { value?: unknown } | undefined;
			if (
				typeof column?.name === "string" &&
				columnNames[column.name] &&
				parameter &&
				"value" in parameter
			) {
				values[columnNames[column.name]] = parameter.value;
			}
			visit(chunks[index]);
		}
	}

	visit(condition);
	return values;
}

function sqlParameterValues(statement: unknown) {
	const values: unknown[] = [];
	function visit(node: unknown) {
		if (typeof node === "string" || typeof node === "number") {
			values.push(node);
			return;
		}
		if (!node || typeof node !== "object") return;
		if ("encoder" in node && "value" in node) {
			values.push((node as { value: unknown }).value);
			return;
		}
		const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
		if (chunks) for (const chunk of chunks) visit(chunk);
	}
	visit(statement);
	return values;
}

function executeCallsWithParameterCount(count: number) {
	return dbMock.execute.mock.calls.filter(
		([statement]) => sqlParameterValues(statement).length === count,
	);
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function twoPartyBarrier() {
	let arrivals = 0;
	let release!: () => void;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	return async () => {
		arrivals++;
		if (arrivals === 2) release();
		await waiting;
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	dbMock.returning.mockReset();
	dbMock.rows = [];
	dbMock.persistedRows = new Map();
	dbMock.latestEntries = new Map();
	dbMock.timeEntries = [];
	dbMock.employees = new Map([["emp_1", { id: "emp_1", organizationId: "org_1" }]]);
	dbMock.categories = new Map();
	dbMock.insertCalls = [];
	dbMock.updates = [];
	dbMock.updatePredicates = [];
	dbMock.beforeUpdate = undefined;
	dbMock.afterUpdate = undefined;
	dbMock.beforeStatusRead = undefined;
	dbMock.afterRollback = undefined;
	dbMock.beforeRollbackRestore = undefined;
	dbMock.afterLockAcquired = undefined;
	dbMock.candidateBarrier = undefined;
	dbMock.advisoryLocks = new Map();
	dbMock.nextCreatedId = 1;
	dbMock.lockAcquisitions = 0;
	dbMock.transaction.mockImplementation(async (callback) => {
		const context: TransactionContext = {
			inserts: [],
			insertResults: [],
			predicateUpdates: [],
			releaseLocks: [],
			rowChanges: new Map(),
			updates: [],
		};
		return transactionStorage.run(context, async () => {
			try {
				const result = await callback({
					select: dbMock.select,
					update: dbMock.update,
					insert: dbMock.insert,
					execute: dbMock.execute,
					query: dbMock.query,
				});
				for (const insert of context.insertResults) {
					if (
						(insert.values.type === "clock_in" || insert.values.type === "clock_out") &&
						typeof insert.values.employeeId === "string"
					) {
						dbMock.latestEntries.set(insert.values.employeeId, {
							id: insert.id,
							hash: insert.hash,
						});
						dbMock.timeEntries.push({
							...insert.values,
							id: insert.id,
							hash: insert.hash,
						});
					}
				}
				return result;
			} catch (error) {
				dbMock.insertCalls = dbMock.insertCalls.filter(
					(insert) => !context.inserts.includes(insert),
				);
				dbMock.updates = dbMock.updates.filter((update) => !context.updates.includes(update));
				dbMock.updatePredicates = dbMock.updatePredicates.filter(
					(update) => !context.predicateUpdates.includes(update),
				);
				await dbMock.beforeRollbackRestore?.();
				for (const [id, change] of context.rowChanges) {
					if (dbMock.persistedRows.get(id) === change.after) {
						dbMock.persistedRows.set(id, change.before);
					}
				}
				await dbMock.afterRollback?.();
				throw error;
			} finally {
				for (const release of context.releaseLocks.toReversed()) release();
			}
		});
	});
	dbMock.execute.mockImplementation(async (statement) => {
		const parameters = sqlParameterValues(statement);
		if (parameters.length > 1) {
			const [employeeId, organizationId] = parameters;
			const candidates = dbMock.timeEntries.filter(
				(entry) => entry.employeeId === employeeId && entry.organizationId === organizationId,
			);
			const leaves = candidates.filter(
				(candidate) => !candidates.some((child) => child.previousEntryId === candidate.id),
			);
			if (leaves.length > 0) {
				return leaves.slice(0, 2).map((leaf) => ({ id: leaf.id, hash: leaf.hash }));
			}
			const latest =
				typeof employeeId === "string" ? dbMock.latestEntries.get(employeeId) : undefined;
			return latest ? [latest] : [];
		}
		const [lockKey] = parameters;
		if (typeof lockKey !== "string") throw new Error("Expected parameterized advisory lock key");
		const context = transactionStorage.getStore();
		if (!context) throw new Error("Advisory lock must run inside a transaction");
		const previous = dbMock.advisoryLocks.get(lockKey) ?? Promise.resolve();
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const current = previous.then(() => held);
		dbMock.advisoryLocks.set(lockKey, current);
		await previous;
		dbMock.lockAcquisitions++;
		await dbMock.afterLockAcquired?.(dbMock.lockAcquisitions);
		context.releaseLocks.push(release);
		return [];
	});

	dbMock.from.mockReturnValue({ where: dbMock.where });
	dbMock.where.mockImplementation(async () => {
		for (const row of dbMock.rows) {
			if (typeof row.id === "string" && !dbMock.persistedRows.has(row.id)) {
				dbMock.persistedRows.set(row.id, { ...row });
			}
		}
		await dbMock.candidateBarrier?.();
		return dbMock.rows.map((row) => ({ ...row }));
	});
	dbMock.select.mockReturnValue({ from: dbMock.from });
	dbMock.update.mockReturnValue({ set: dbMock.set });
	dbMock.set.mockImplementation((values) => {
		dbMock.updates.push(values);
		transactionStorage.getStore()?.updates.push(values);
		return {
			where: (condition: unknown) => {
				const predicate = predicateValues(condition);
				const predicateUpdate = { values, predicate };
				dbMock.updatePredicates.push(predicateUpdate);
				transactionStorage.getStore()?.predicateUpdates.push(predicateUpdate);
				let execution: Promise<Array<Record<string, unknown>>> | undefined;
				const execute = () => {
					execution ??= (async () => {
						await dbMock.beforeUpdate?.(values);
						const matched: Array<Record<string, unknown>> = [];
						for (const [id, row] of dbMock.persistedRows) {
							if (Object.entries(predicate).every(([key, value]) => row[key] === value)) {
								const updated = { ...row, ...values };
								dbMock.persistedRows.set(id, updated);
								const context = transactionStorage.getStore();
								const change = context?.rowChanges.get(id);
								if (context && !change) {
									context.rowChanges.set(id, { before: row, after: updated });
								} else if (change) {
									change.after = updated;
								}
								matched.push({ ...updated });
							}
						}
						await dbMock.afterUpdate?.(values, matched);
						return matched;
					})();
					return execution;
				};
				return Object.assign(execute(), { returning: execute });
			},
		};
	});
	dbMock.insert.mockReturnValue({ values: dbMock.values });
	dbMock.values.mockImplementation((values) => {
		dbMock.insertCalls.push(values);
		const context = transactionStorage.getStore();
		context?.inserts.push(values);
		if (context) context.pendingInsert = values;
		return { returning: dbMock.returning };
	});
	dbMock.returning.mockImplementation(() => {
		const context = transactionStorage.getStore();
		const values = context?.pendingInsert ?? dbMock.insertCalls.at(-1) ?? {};
		const id = `created_${dbMock.nextCreatedId++}`;
		const hash = typeof values.hash === "string" ? values.hash : `hash_${id}`;
		context?.insertResults.push({ values, id, hash });
		return Promise.resolve([{ id, hash }]);
	});
	dbMock.query.employee.findFirst.mockResolvedValue(dbMock.employees.get("emp_1") ?? null);
	dbMock.query.absenceCategory.findFirst.mockImplementation(() => {
		return Promise.resolve(dbMock.categories.get("Vacation") ?? null);
	});
	dbMock.query.timeEntry.findFirst.mockImplementation(() => {
		return Promise.resolve(dbMock.latestEntries.get("emp_1") ?? null);
	});
	dbMock.query.importStagedRow.findFirst.mockImplementation(async ({ where }) => {
		await dbMock.beforeStatusRead?.();
		const predicate = predicateValues(where);
		return (
			[...dbMock.persistedRows.values()].find((row) =>
				Object.entries(predicate).every(([key, value]) => row[key] === value),
			) ?? null
		);
	});
	dbMock.query.importStagedRow.findMany.mockImplementation(({ where }) => {
		const predicate = predicateValues(where);
		return Promise.resolve(
			[...dbMock.persistedRows.values()]
				.filter((row) => Object.entries(predicate).every(([key, value]) => row[key] === value))
				.map((row) => ({ rowStatus: row.rowStatus })),
		);
	});
});

describe("commitAcceptedRowsForEntity", () => {
	it("commits accepted work periods with chained clock entries and marks the row committed", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T16:00:00.000Z",
				},
			}),
		];
		dbMock.latestEntries.set("emp_1", { id: "entry_prev", hash: "hash_prev" });

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(result).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(calculateHash).toHaveBeenNthCalledWith(1, {
			employeeId: "emp_1",
			type: "clock_in",
			timestamp: "2026-01-01T08:00:00.000Z",
			previousHash: "hash_prev",
		});
		expect(dbMock.insertCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					employeeId: "emp_1",
					organizationId: "org_1",
					type: "clock_in",
					previousEntryId: "entry_prev",
					previousHash: "hash_prev",
				}),
				expect.objectContaining({
					employeeId: "emp_1",
					organizationId: "org_1",
					type: "clock_out",
					previousEntryId: "created_1",
				}),
				expect.objectContaining({
					employeeId: "emp_1",
					organizationId: "org_1",
					clockInId: "created_1",
					clockOutId: "created_2",
					durationMinutes: 480,
					isActive: false,
				}),
			]),
		);
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "committed",
				commitTargetTable: "work_period",
				commitTargetId: "created_3",
				commitError: null,
			}),
		);
		expect(dbMock.updatePredicates).toEqual(
			expect.arrayContaining([
				{
					values: expect.objectContaining({ rowStatus: "committing", commitError: null }),
					predicate: {
						id: "row_1",
						batchId: "batch_1",
						organizationId: "org_1",
						entityType: "work_period",
						rowStatus: "accepted",
					},
				},
				{
					values: expect.objectContaining({ rowStatus: "committed" }),
					predicate: {
						id: "row_1",
						batchId: "batch_1",
						organizationId: "org_1",
						entityType: "work_period",
						rowStatus: "committing",
					},
				},
			]),
		);
	});

	it("commits accepted absences with an organization-scoped category", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "absence",
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-02-03T00:00:00.000Z",
					endsAt: "2026-02-04T00:00:00.000Z",
					categoryName: "Vacation",
					note: "imported",
				},
			}),
		];
		dbMock.categories.set("Vacation", { id: "cat_1", organizationId: "org_1", name: "Vacation" });

		const result = await commitAcceptedRowsForEntity(commitJob("absence"));

		expect(result).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(dbMock.insertCalls).toContainEqual(
			expect.objectContaining({
				employeeId: "emp_1",
				organizationId: "org_1",
				categoryId: "cat_1",
				startDate: "2026-02-03",
				endDate: "2026-02-04",
				status: "approved",
				notes: "imported",
			}),
		);
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "committed",
				commitTargetTable: "absence_entry",
				commitTargetId: "created_1",
			}),
		);
	});

	it("skips non-accepted rows without committing them", async () => {
		dbMock.rows = [
			stagedRow({
				id: "row_rejected",
				rowStatus: "rejected",
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T16:00:00.000Z",
				},
			}),
		];

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(result).toMatchObject({ committedRows: 0, failedRows: 0, errors: [] });
		expect(dbMock.where).toHaveBeenCalledWith(
			expect.objectContaining({ queryChunks: expect.any(Array) }),
		);
		expect(dbMock.insert).not.toHaveBeenCalled();
	});

	it("marks cross-organization employee rows commit_failed and continues", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_2",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T16:00:00.000Z",
				},
			}),
		];
		dbMock.employees.set("emp_2", { id: "emp_2", organizationId: "org_2" });
		dbMock.query.employee.findFirst.mockResolvedValueOnce(null);

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [{ rowId: "row_1", message: "Employee emp_2 does not belong to organization org_1" }],
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "commit_failed",
				commitError: "Employee emp_2 does not belong to organization org_1",
			}),
		);
	});

	it("leaves failed rows accepted on non-final attempts so BullMQ can retry them", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_2",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T16:00:00.000Z",
				},
			}),
		];
		dbMock.query.employee.findFirst.mockResolvedValueOnce(null);

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"), {
			finalAttempt: false,
		});

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [{ rowId: "row_1", message: "Employee emp_2 does not belong to organization org_1" }],
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates).toEqual([]);
	});

	it("marks failed rows commit_failed on final attempts", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_2",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T16:00:00.000Z",
				},
			}),
		];
		dbMock.query.employee.findFirst.mockResolvedValueOnce(null);

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"), {
			finalAttempt: true,
		});

		expect(result.failedRows).toBe(1);
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "commit_failed",
				commitError: "Employee emp_2 does not belong to organization org_1",
			}),
		);
	});

	it("reloads the chain head under a transaction lock for each row", async () => {
		dbMock.rows = [
			stagedRow({
				id: "row_1",
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T12:00:00.000Z",
				},
			}),
			stagedRow({
				id: "row_2",
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-02T08:00:00.000Z",
					endsAt: "2026-01-02T12:00:00.000Z",
				},
			}),
		];
		dbMock.latestEntries.set("emp_1", { id: "entry_prev", hash: "hash_prev" });

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(result).toMatchObject({ committedRows: 2, failedRows: 0, errors: [] });
		expect(executeCallsWithParameterCount(1)).toHaveLength(2);
		expect(executeCallsWithParameterCount(4)).toHaveLength(2);
		expect(dbMock.insertCalls[3]).toEqual(
			expect.objectContaining({
				type: "clock_in",
				previousEntryId: "created_2",
				previousHash: expect.stringContaining("clock_out"),
			}),
		);
	});

	it("serializes overlapping different rows for the same employee without forking the chain", async () => {
		const firstRow = stagedRow({
			id: "row_1",
			normalizedPayload: {
				employeeId: "emp_1",
				startsAt: "2026-01-01T08:00:00.000Z",
				endsAt: "2026-01-01T12:00:00.000Z",
			},
		});
		const secondRow = stagedRow({
			id: "row_2",
			normalizedPayload: {
				employeeId: "emp_1",
				startsAt: "2026-01-02T08:00:00.000Z",
				endsAt: "2026-01-02T12:00:00.000Z",
			},
		});
		dbMock.rows = [firstRow, secondRow];
		dbMock.persistedRows.set("row_1", { ...firstRow });
		dbMock.persistedRows.set("row_2", { ...secondRow });
		dbMock.latestEntries.set("emp_1", { id: "entry_prev", hash: "hash_prev" });
		dbMock.candidateBarrier = twoPartyBarrier();
		const bothRowsClaimed = twoPartyBarrier();
		const secondLockAcquired = deferred();
		const releaseSecondLock = deferred();
		dbMock.afterUpdate = async (values, matchedRows) => {
			if (values.rowStatus === "committing" && matchedRows.length === 1) {
				await bothRowsClaimed();
			}
		};
		dbMock.afterLockAcquired = async (acquisition) => {
			if (acquisition !== 2) return;
			secondLockAcquired.resolve();
			await releaseSecondLock.promise;
		};

		const firstWorker = commitAcceptedRowsForEntity(commitJob("work_period"));
		const secondWorker = commitAcceptedRowsForEntity(commitJob("work_period"));
		await secondLockAcquired.promise;
		const firstResult = await firstWorker;
		releaseSecondLock.resolve();
		const secondResult = await secondWorker;
		const results = [firstResult, secondResult];

		expect(results.reduce((total, result) => total + result.committedRows, 0)).toBe(2);
		const clockIns = dbMock.insertCalls.filter((insert) => insert.type === "clock_in");
		const clockOuts = dbMock.insertCalls.filter((insert) => insert.type === "clock_out");
		expect(clockIns).toHaveLength(2);
		expect(clockOuts).toHaveLength(2);
		expect(clockIns.filter((entry) => entry.previousEntryId === "entry_prev")).toHaveLength(1);
		expect(
			clockIns.filter((entry) =>
				clockOuts.some((clockOut) => entry.previousHash === clockOut.hash),
			),
		).toHaveLength(1);
		expect(executeCallsWithParameterCount(1)).toHaveLength(2);
		expect(sqlParameterValues(executeCallsWithParameterCount(1)[0][0])).toEqual(["org_1:emp_1"]);
		expect(results.map((result) => result.summary)).toEqual(
			expect.arrayContaining([
				{ remainingRows: 1, totalCommittedRows: 1, terminalFailedRows: 0 },
				{ remainingRows: 0, totalCommittedRows: 2, terminalFailedRows: 0 },
			]),
		);
	});

	it("selects the actual leaf when chain entries share createdAt and event times are backdated", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2025-01-02T08:00:00.000Z",
					endsAt: null,
				},
			}),
		];
		const sharedCreatedAt = new Date("2026-03-01T12:00:00.000Z");
		dbMock.timeEntries = [
			{
				id: "entry_clock_in",
				hash: "hash_clock_in",
				employeeId: "emp_1",
				organizationId: "org_1",
				previousEntryId: null,
				createdAt: sharedCreatedAt,
				timestamp: new Date("2026-02-10T08:00:00.000Z"),
			},
			{
				id: "entry_clock_out",
				hash: "hash_clock_out",
				employeeId: "emp_1",
				organizationId: "org_1",
				previousEntryId: "entry_clock_in",
				createdAt: sharedCreatedAt,
				timestamp: new Date("2026-02-10T16:00:00.000Z"),
			},
		];
		dbMock.latestEntries.set("emp_1", {
			id: "entry_clock_in",
			hash: "hash_clock_in",
		});

		await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(dbMock.insertCalls[0]).toEqual(
			expect.objectContaining({
				type: "clock_in",
				previousEntryId: "entry_clock_out",
				previousHash: "hash_clock_out",
			}),
		);
		expect(sqlParameterValues(executeCallsWithParameterCount(4)[0][0])).toEqual([
			"emp_1",
			"org_1",
			"emp_1",
			"org_1",
		]);
	});

	it("fails closed when legacy data has multiple chain leaves", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-02T08:00:00.000Z",
					endsAt: null,
				},
			}),
		];
		dbMock.timeEntries = [
			{
				id: "legacy_leaf_1",
				hash: "hash_leaf_1",
				employeeId: "emp_1",
				organizationId: "org_1",
				previousEntryId: null,
			},
			{
				id: "legacy_leaf_2",
				hash: "hash_leaf_2",
				employeeId: "emp_1",
				organizationId: "org_1",
				previousEntryId: null,
			},
		];

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [
				{
					rowId: "row_1",
					message:
						"Ambiguous time entry chain for employee emp_1 in organization org_1: multiple leaves found",
				},
			],
		});
		expect(dbMock.insertCalls).toEqual([]);
	});

	it("rolls back production writes when a row fails before marking commit_failed", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T16:00:00.000Z",
				},
			}),
		];
		dbMock.returning.mockImplementationOnce(() =>
			Promise.resolve([{ id: "created_1", hash: "hash_1" }]),
		);
		dbMock.returning.mockImplementationOnce(() =>
			Promise.reject(new Error("clock out insert failed")),
		);

		const result = await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [{ rowId: "row_1", message: "clock out insert failed" }],
		});
		expect(dbMock.insertCalls).toEqual([]);
		expect(dbMock.updates).toEqual([
			expect.objectContaining({
				rowStatus: "commit_failed",
				commitError: "clock out insert failed",
			}),
		]);
		expect(dbMock.updatePredicates.at(-1)).toEqual({
			values: expect.objectContaining({ rowStatus: "commit_failed" }),
			predicate: {
				id: "row_1",
				batchId: "batch_1",
				organizationId: "org_1",
				entityType: "work_period",
				rowStatus: "accepted",
			},
		});
	});

	it("restores accepted after a transaction failure so a later attempt can claim and commit", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-01T08:00:00.000Z",
					endsAt: "2026-01-01T16:00:00.000Z",
				},
			}),
		];
		dbMock.returning.mockRejectedValueOnce(new Error("clock in insert failed"));

		const firstResult = await commitAcceptedRowsForEntity(commitJob("work_period"), {
			finalAttempt: false,
		});

		expect(firstResult.failedRows).toBe(1);
		expect(dbMock.persistedRows.get("row_1")?.rowStatus).toBe("accepted");

		const retryResult = await commitAcceptedRowsForEntity(commitJob("work_period"));

		expect(retryResult).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(dbMock.persistedRows.get("row_1")?.rowStatus).toBe("committed");
	});

	it("does not let a final failure overwrite a concurrent committed row", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "absence",
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-02-03T00:00:00.000Z",
					endsAt: "2026-02-04T00:00:00.000Z",
					categoryName: "Vacation",
				},
			}),
		];
		dbMock.categories.set("Vacation", {
			id: "cat_1",
			organizationId: "org_1",
			name: "Vacation",
		});
		dbMock.returning.mockRejectedValueOnce(new Error("absence insert failed"));
		const failedUpdateReached = deferred();
		const releaseFailedUpdate = deferred();
		dbMock.beforeUpdate = async (values) => {
			if (values.rowStatus !== "commit_failed") return;
			failedUpdateReached.resolve();
			await releaseFailedUpdate.promise;
		};

		const failingCommit = commitAcceptedRowsForEntity(commitJob("absence"));
		await failedUpdateReached.promise;
		const successfulResult = await commitAcceptedRowsForEntity(commitJob("absence"));
		releaseFailedUpdate.resolve();
		const failedResult = await failingCommit;

		expect(successfulResult).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(failedResult).toMatchObject({ committedRows: 0, failedRows: 0, errors: [] });
		expect(dbMock.persistedRows.get("row_1")).toEqual(
			expect.objectContaining({ rowStatus: "committed", commitTargetTable: "absence_entry" }),
		);
		expect(dbMock.insertCalls).toHaveLength(1);
	});

	it("suppresses a non-final error after another worker commits the restored row", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "absence",
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-02-03T00:00:00.000Z",
					endsAt: "2026-02-04T00:00:00.000Z",
					categoryName: "Vacation",
				},
			}),
		];
		dbMock.categories.set("Vacation", {
			id: "cat_1",
			organizationId: "org_1",
			name: "Vacation",
		});
		dbMock.returning.mockRejectedValueOnce(new Error("absence insert failed"));
		let concurrentResult: Awaited<ReturnType<typeof commitAcceptedRowsForEntity>> | undefined;
		dbMock.afterRollback = async () => {
			dbMock.afterRollback = undefined;
			concurrentResult = await commitAcceptedRowsForEntity(commitJob("absence"));
		};

		const staleResult = await commitAcceptedRowsForEntity(commitJob("absence"), {
			finalAttempt: false,
		});

		expect(concurrentResult).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(staleResult).toMatchObject({ committedRows: 0, failedRows: 0, errors: [] });
		expect(dbMock.persistedRows.get("row_1")?.rowStatus).toBe("committed");
	});

	it("does not erase another transaction's committed row during rollback", async () => {
		const failingRow = stagedRow({
			id: "row_1",
			entityType: "absence",
			normalizedPayload: {
				employeeId: "emp_1",
				startsAt: "2026-02-03T00:00:00.000Z",
				endsAt: "2026-02-04T00:00:00.000Z",
				categoryName: "Vacation",
			},
		});
		const successfulRow = stagedRow({
			id: "row_2",
			entityType: "absence",
			normalizedPayload: {
				employeeId: "emp_1",
				startsAt: "2026-02-05T00:00:00.000Z",
				endsAt: "2026-02-06T00:00:00.000Z",
				categoryName: "Vacation",
			},
		});
		dbMock.rows = [failingRow];
		dbMock.persistedRows.set("row_1", { ...failingRow });
		dbMock.persistedRows.set("row_2", { ...successfulRow });
		dbMock.categories.set("Vacation", {
			id: "cat_1",
			organizationId: "org_1",
			name: "Vacation",
		});
		dbMock.returning.mockRejectedValueOnce(new Error("absence insert failed"));
		let concurrentResult: Awaited<ReturnType<typeof commitAcceptedRowsForEntity>> | undefined;
		dbMock.beforeRollbackRestore = async () => {
			dbMock.beforeRollbackRestore = undefined;
			dbMock.rows = [successfulRow];
			concurrentResult = await commitAcceptedRowsForEntity(commitJob("absence"));
		};

		const failingResult = await commitAcceptedRowsForEntity(commitJob("absence"), {
			finalAttempt: false,
		});

		expect(failingResult.failedRows).toBe(1);
		expect(concurrentResult).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(dbMock.persistedRows.get("row_1")?.rowStatus).toBe("accepted");
		expect(dbMock.persistedRows.get("row_2")?.rowStatus).toBe("committed");
	});
});
