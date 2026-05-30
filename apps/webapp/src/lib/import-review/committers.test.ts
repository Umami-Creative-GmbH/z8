import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
	latestEntries: new Map<string, { id: string; hash: string }>(),
	employees: new Map<string, { id: string; organizationId: string }>(),
	categories: new Map<string, { id: string; organizationId: string; name: string }>(),
	transaction: vi.fn(),
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
	query: {
		employee: { findFirst: vi.fn() },
		absenceCategory: { findFirst: vi.fn() },
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

beforeEach(() => {
	vi.clearAllMocks();
	dbMock.rows = [];
	dbMock.latestEntries = new Map();
	dbMock.employees = new Map([["emp_1", { id: "emp_1", organizationId: "org_1" }]]);
	dbMock.categories = new Map();
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
		const values = dbMock.insertCalls.at(-1) ?? {};
		const id = `created_${dbMock.insertCalls.length}`;
		return Promise.resolve([{ id, hash: values.hash ?? `hash_${id}` }]);
	});
	dbMock.query.employee.findFirst.mockResolvedValue(dbMock.employees.get("emp_1") ?? null);
	dbMock.query.absenceCategory.findFirst.mockImplementation(() => {
		return Promise.resolve(dbMock.categories.get("Vacation") ?? null);
	});
	dbMock.query.timeEntry.findFirst.mockImplementation(() => {
		return Promise.resolve(dbMock.latestEntries.get("emp_1") ?? null);
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

		expect(result).toEqual({ committedRows: 1, failedRows: 0, errors: [] });
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

		expect(result).toEqual({ committedRows: 1, failedRows: 0, errors: [] });
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

		expect(result).toEqual({ committedRows: 0, failedRows: 0, errors: [] });
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

		expect(result).toEqual({
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

		expect(result).toEqual({
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

	it("chains multiple rows for the same employee through the in-memory chain head", async () => {
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

		expect(result).toEqual({ committedRows: 2, failedRows: 0, errors: [] });
		expect(dbMock.query.timeEntry.findFirst).toHaveBeenCalledTimes(1);
		expect(dbMock.insertCalls[3]).toEqual(
			expect.objectContaining({
				type: "clock_in",
				previousEntryId: "created_2",
				previousHash: expect.stringContaining("clock_out"),
			}),
		);
	});

	it("selects the existing chain head by latest createdAt instead of latest timestamp", async () => {
		dbMock.rows = [
			stagedRow({
				normalizedPayload: {
					employeeId: "emp_1",
					startsAt: "2026-01-02T08:00:00.000Z",
					endsAt: null,
				},
			}),
		];

		await commitAcceptedRowsForEntity(commitJob("work_period"));

		const orderBy = dbMock.query.timeEntry.findFirst.mock.calls[0][0].orderBy;
		expect(orderBy).toHaveLength(1);
		expect(orderBy[0].queryChunks[1].config.name).toBe("created_at");
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

		expect(result).toEqual({
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
	});
});
