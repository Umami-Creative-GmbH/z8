import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
	persistedRows: new Map<string, Record<string, unknown>>(),
	transaction: vi.fn(),
	select: vi.fn(),
	update: vi.fn(),
	insert: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	from: vi.fn(),
	values: vi.fn(),
	returning: vi.fn(),
	insertCalls: [] as Array<Record<string, unknown>>,
	updates: [] as Array<Record<string, unknown>>,
	updatePredicates: [] as Array<{
		values: Record<string, unknown>;
		predicate: Record<string, unknown>;
	}>,
	candidateBarrier: undefined as (() => Promise<void>) | undefined,
	query: {
		employee: { findFirst: vi.fn() },
		absenceCategory: { findFirst: vi.fn() },
		holidayCategory: { findFirst: vi.fn() },
		timeEntry: { findFirst: vi.fn() },
		importStagedRow: { findMany: vi.fn() },
	},
}));

vi.mock("@/db", () => ({
	db: {
		transaction: dbMock.transaction,
		select: dbMock.select,
		update: dbMock.update,
		insert: dbMock.insert,
		query: dbMock.query,
	},
}));

vi.mock("@/lib/time-tracking/blockchain", () => ({
	calculateHash: vi.fn(),
}));

const { commitAcceptedRowsForEntity } = await import("./committers");

function commitJob(entityType: string) {
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
		entityType: "team",
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

function clonePersistedRows() {
	return new Map([...dbMock.persistedRows].map(([id, row]) => [id, { ...row }] as const));
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
	dbMock.rows = [];
	dbMock.persistedRows = new Map();
	dbMock.insertCalls = [];
	dbMock.updates = [];
	dbMock.updatePredicates = [];
	dbMock.candidateBarrier = undefined;
	dbMock.transaction.mockImplementation(async (callback) => {
		const insertSnapshot = [...dbMock.insertCalls];
		const updateSnapshot = [...dbMock.updates];
		const predicateSnapshot = [...dbMock.updatePredicates];
		const persistedSnapshot = clonePersistedRows();
		try {
			return await callback({
				select: dbMock.select,
				update: dbMock.update,
				insert: dbMock.insert,
				query: dbMock.query,
			});
		} catch (error) {
			dbMock.insertCalls = insertSnapshot;
			dbMock.updates = updateSnapshot;
			dbMock.updatePredicates = predicateSnapshot;
			dbMock.persistedRows = persistedSnapshot;
			throw error;
		}
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
		return {
			where: (condition: unknown) => {
				const predicate = predicateValues(condition);
				dbMock.updatePredicates.push({ values, predicate });
				let execution: Promise<Array<Record<string, unknown>>> | undefined;
				const execute = () => {
					execution ??= Promise.resolve().then(() => {
						const matched: Array<Record<string, unknown>> = [];
						for (const [id, row] of dbMock.persistedRows) {
							if (Object.entries(predicate).every(([key, value]) => row[key] === value)) {
								const updated = { ...row, ...values };
								dbMock.persistedRows.set(id, updated);
								matched.push({ ...updated });
							}
						}
						return matched;
					});
					return execution;
				};
				return Object.assign(execute(), { returning: execute });
			},
		};
	});
	dbMock.insert.mockReturnValue({ values: dbMock.values });
	dbMock.values.mockImplementation((values) => {
		dbMock.insertCalls.push(values);
		return { returning: dbMock.returning };
	});
	dbMock.returning.mockImplementation(() => {
		const id = `created_${dbMock.insertCalls.length}`;
		return Promise.resolve([{ id }]);
	});
	dbMock.query.holidayCategory.findFirst.mockResolvedValue({ id: "holiday_category_1" });
	dbMock.query.importStagedRow.findMany.mockImplementation(({ where }) => {
		const predicate = predicateValues(where);
		return Promise.resolve(
			[...dbMock.persistedRows.values()]
				.filter((row) => Object.entries(predicate).every(([key, value]) => row[key] === value))
				.map((row) => ({ rowStatus: row.rowStatus })),
		);
	});
});

describe("commitAcceptedRowsForEntity setup/reference rows", () => {
	it("commits accepted team rows as organization-scoped teams", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "team",
				normalizedPayload: { name: "Operations", leaderUserId: "provider-user-1" },
			}),
		];

		const result = await commitAcceptedRowsForEntity(commitJob("team"));

		expect(result).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(dbMock.insertCalls).toContainEqual(
			expect.objectContaining({
				organizationId: "org_1",
				name: "Operations",
			}),
		);
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "committed",
				commitTargetTable: "team",
				commitTargetId: "created_1",
				commitError: null,
			}),
		);
	});

	it("commits accepted work category rows with audit fields", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "work_category",
				normalizedPayload: { name: "Training", note: "Internal education", active: true },
			}),
		];

		const result = await commitAcceptedRowsForEntity(commitJob("work_category"));

		expect(result).toMatchObject({ committedRows: 1, failedRows: 0, errors: [] });
		expect(dbMock.insertCalls).toContainEqual(
			expect.objectContaining({
				organizationId: "org_1",
				name: "Training",
				description: "Internal education",
				isActive: true,
				createdBy: "user_1",
			}),
		);
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "committed",
				commitTargetTable: "work_category",
				commitTargetId: "created_1",
			}),
		);
	});

	it("reports mapping-required setup rows without blocking on non-final attempts", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "employee",
				normalizedPayload: { name: "Ada Lovelace", email: "ada@example.com" },
			}),
		];

		const result = await commitAcceptedRowsForEntity(commitJob("employee"), {
			finalAttempt: false,
		});

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [
				{
					rowId: "row_1",
					message: "employee import rows require mapping confirmation before commit",
				},
			],
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates.map((update) => update.rowStatus)).toEqual(["committing", "accepted"]);
		expect(dbMock.persistedRows.get("row_1")).toEqual(
			expect.objectContaining({ rowStatus: "accepted", commitError: null }),
		);
	});

	it("blocks mapping-required setup rows on final attempts", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "employee",
				normalizedPayload: { name: "Ada Lovelace", email: "ada@example.com" },
			}),
		];

		const result = await commitAcceptedRowsForEntity(commitJob("employee"));

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [
				{
					rowId: "row_1",
					message: "employee import rows require mapping confirmation before commit",
				},
			],
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "blocked",
				commitError: "employee import rows require mapping confirmation before commit",
			}),
		);
	});

	it("blocks holiday rows without confirmed category mapping", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "holiday",
				normalizedPayload: { name: "New Year", date: "2026-01-01" },
			}),
		];

		const result = await commitAcceptedRowsForEntity(commitJob("holiday"));

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [
				{
					rowId: "row_1",
					message: "holiday import row requires a confirmed categoryId before commit",
				},
			],
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "blocked",
				commitError: "holiday import row requires a confirmed categoryId before commit",
			}),
		);
	});

	it("reports missing holiday category without blocking on non-final attempts", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "holiday",
				normalizedPayload: {
					name: "New Year",
					date: "2026-01-01",
					categoryId: "holiday_category_other_org",
				},
			}),
		];
		dbMock.query.holidayCategory.findFirst.mockResolvedValueOnce(null);

		const result = await commitAcceptedRowsForEntity(commitJob("holiday"), { finalAttempt: false });

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [
				{
					rowId: "row_1",
					message:
						"Holiday category holiday_category_other_org does not belong to organization org_1",
				},
			],
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates.map((update) => update.rowStatus)).toEqual(["committing", "accepted"]);
		expect(dbMock.persistedRows.get("row_1")).toEqual(
			expect.objectContaining({ rowStatus: "accepted", commitError: null }),
		);
	});

	it("blocks holiday rows when the category is missing from the organization on final attempts", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "holiday",
				normalizedPayload: {
					name: "New Year",
					date: "2026-01-01",
					categoryId: "holiday_category_other_org",
				},
			}),
		];
		dbMock.query.holidayCategory.findFirst.mockResolvedValueOnce(null);

		const result = await commitAcceptedRowsForEntity(commitJob("holiday"));

		expect(result).toMatchObject({
			committedRows: 0,
			failedRows: 1,
			errors: [
				{
					rowId: "row_1",
					message:
						"Holiday category holiday_category_other_org does not belong to organization org_1",
				},
			],
		});
		expect(dbMock.query.holidayCategory.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ queryChunks: expect.any(Array) }),
			}),
		);
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "blocked",
				commitError:
					"Holiday category holiday_category_other_org does not belong to organization org_1",
			}),
		);
	});

	it("atomically claims overlapping team candidates so only one worker writes", async () => {
		const candidate = stagedRow({
			entityType: "team",
			normalizedPayload: { name: "Stale operations" },
		});
		dbMock.rows = [candidate];
		dbMock.persistedRows.set("row_1", {
			...candidate,
			normalizedPayload: { name: "Operations" },
		});
		dbMock.candidateBarrier = twoPartyBarrier();

		const [first, second] = await Promise.all([
			commitAcceptedRowsForEntity(commitJob("team")),
			commitAcceptedRowsForEntity(commitJob("team")),
		]);

		expect([first, second]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ committedRows: 1, failedRows: 0, errors: [] }),
				expect.objectContaining({ committedRows: 0, failedRows: 0, errors: [] }),
			]),
		);
		expect(dbMock.insertCalls).toHaveLength(1);
		expect(dbMock.insertCalls[0]).toEqual(
			expect.objectContaining({ organizationId: "org_1", name: "Operations" }),
		);
		expect(dbMock.persistedRows.get("row_1")).toEqual(
			expect.objectContaining({
				rowStatus: "committed",
				commitTargetTable: "team",
				commitTargetId: "created_1",
			}),
		);
	});

	it("rejects a stale candidate whose persisted row belongs to another organization", async () => {
		const candidate = stagedRow({
			entityType: "team",
			normalizedPayload: { name: "Operations" },
		});
		dbMock.rows = [candidate];
		dbMock.persistedRows.set("row_1", {
			...candidate,
			organizationId: "org_2",
		});

		const result = await commitAcceptedRowsForEntity(commitJob("team"));

		expect(result).toMatchObject({ committedRows: 0, failedRows: 0, errors: [] });
		expect(dbMock.insertCalls).toEqual([]);
		expect(dbMock.persistedRows.get("row_1")?.organizationId).toBe("org_2");
		expect(dbMock.persistedRows.get("row_1")?.rowStatus).toBe("accepted");
	});

	it("releases a non-final mapping blocker so a final attempt can claim and block it", async () => {
		const candidate = stagedRow({
			entityType: "employee",
			normalizedPayload: { name: "Ada Lovelace", email: "ada@example.com" },
		});
		dbMock.rows = [candidate];

		const retryableResult = await commitAcceptedRowsForEntity(commitJob("employee"), {
			finalAttempt: false,
		});

		expect(retryableResult.failedRows).toBe(1);
		expect(dbMock.persistedRows.get("row_1")).toEqual(
			expect.objectContaining({ rowStatus: "accepted", commitError: null }),
		);
		expect(dbMock.updatePredicates.at(-1)).toEqual({
			values: { rowStatus: "accepted", commitError: null },
			predicate: {
				id: "row_1",
				batchId: "batch_1",
				organizationId: "org_1",
				entityType: "employee",
				rowStatus: "committing",
			},
		});

		const finalResult = await commitAcceptedRowsForEntity(commitJob("employee"), {
			finalAttempt: true,
		});

		expect(finalResult.failedRows).toBe(1);
		expect(dbMock.persistedRows.get("row_1")).toEqual(
			expect.objectContaining({
				rowStatus: "blocked",
				commitError: "employee import rows require mapping confirmation before commit",
			}),
		);
		expect(dbMock.updatePredicates.at(-1)).toEqual({
			values: expect.objectContaining({ rowStatus: "blocked" }),
			predicate: {
				id: "row_1",
				batchId: "batch_1",
				organizationId: "org_1",
				entityType: "employee",
				rowStatus: "committing",
			},
		});
	});
});
