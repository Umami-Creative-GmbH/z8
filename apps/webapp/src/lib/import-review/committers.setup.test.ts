import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
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
	query: {
		employee: { findFirst: vi.fn() },
		absenceCategory: { findFirst: vi.fn() },
		holidayCategory: { findFirst: vi.fn() },
		timeEntry: { findFirst: vi.fn() },
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

beforeEach(() => {
	vi.clearAllMocks();
	dbMock.rows = [];
	dbMock.insertCalls = [];
	dbMock.updates = [];
	dbMock.transaction.mockImplementation(async (callback) => {
		const insertSnapshot = [...dbMock.insertCalls];
		const updateSnapshot = [...dbMock.updates];
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
			throw error;
		}
	});

	dbMock.from.mockReturnValue({ where: dbMock.where });
	dbMock.where.mockImplementation(() => Promise.resolve(dbMock.rows));
	dbMock.select.mockReturnValue({ from: dbMock.from });
	dbMock.update.mockReturnValue({ set: dbMock.set });
	dbMock.set.mockImplementation((values) => {
		dbMock.updates.push(values);
		return { where: dbMock.where };
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

		expect(result).toEqual({ committedRows: 1, failedRows: 0, errors: [] });
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

		expect(result).toEqual({ committedRows: 1, failedRows: 0, errors: [] });
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

		const result = await commitAcceptedRowsForEntity(commitJob("employee"), { finalAttempt: false });

		expect(result).toEqual({
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
		expect(dbMock.updates).toEqual([]);
	});

	it("blocks mapping-required setup rows on final attempts", async () => {
		dbMock.rows = [
			stagedRow({
				entityType: "employee",
				normalizedPayload: { name: "Ada Lovelace", email: "ada@example.com" },
			}),
		];

		const result = await commitAcceptedRowsForEntity(commitJob("employee"));

		expect(result).toEqual({
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

		expect(result).toEqual({
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

		expect(result).toEqual({
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
		expect(dbMock.updates).toEqual([]);
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

		expect(result).toEqual({
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
			expect.objectContaining({ where: expect.objectContaining({ queryChunks: expect.any(Array) }) }),
		);
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(dbMock.updates).toContainEqual(
			expect.objectContaining({
				rowStatus: "blocked",
				commitError: "Holiday category holiday_category_other_org does not belong to organization org_1",
			}),
		);
	});
});
