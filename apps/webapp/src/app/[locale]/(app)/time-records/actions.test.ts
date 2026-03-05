import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const insertReturning = vi.fn();
	const insertValues = vi.fn(() => ({ returning: insertReturning }));
	const dbInsert = vi.fn(() => ({ values: insertValues }));

	const selectLimit = vi.fn();
	const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
	const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const dbSelect = vi.fn(() => ({ from: selectFrom }));

	const employeeFindFirst = vi.fn();
	const getAuthContext = vi.fn();

	return {
		insertReturning,
		insertValues,
		dbInsert,
		selectLimit,
		selectOrderBy,
		selectWhere,
		selectFrom,
		dbSelect,
		employeeFindFirst,
		getAuthContext,
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	desc: vi.fn((column: unknown) => ({ type: "desc", column })),
	eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
	gte: vi.fn((column: unknown, value: unknown) => ({ type: "gte", column, value })),
	lte: vi.fn((column: unknown, value: unknown) => ({ type: "lte", column, value })),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "employee.id",
		organizationId: "employee.organizationId",
		isActive: "employee.isActive",
	},
	timeRecord: {
		id: "timeRecord.id",
		organizationId: "timeRecord.organizationId",
		employeeId: "timeRecord.employeeId",
		recordKind: "timeRecord.recordKind",
		startAt: "timeRecord.startAt",
	},
}));

vi.mock("@/db", () => ({
	db: {
		insert: mockState.dbInsert,
		select: mockState.dbSelect,
		query: {
			employee: {
				findFirst: mockState.employeeFindFirst,
			},
		},
	},
}));

const { createTimeRecord, listTimeRecords } = await import("./actions");

describe("time-record canonical actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns unauthorized when no employee context exists", async () => {
		mockState.getAuthContext.mockResolvedValue(null);

		const createResult = await createTimeRecord({
			employeeId: "emp-1",
			recordKind: "work",
			startAt: "2026-01-01T08:00:00.000Z",
		});

		const listResult = await listTimeRecords({});

		expect(createResult).toEqual({ success: false, error: "Unauthorized" });
		expect(listResult).toEqual({ success: false, error: "Unauthorized" });
		expect(mockState.dbInsert).not.toHaveBeenCalled();
		expect(mockState.dbSelect).not.toHaveBeenCalled();
	});

	it("creates a time record scoped to active organization", async () => {
		const insertedRecord = {
			id: "rec-1",
			organizationId: "org-1",
			employeeId: "emp-1",
			recordKind: "work",
			startAt: new Date("2026-01-01T08:00:00.000Z"),
		};

		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: { id: "emp-1", organizationId: "org-1", role: "employee", teamId: null },
		});
		mockState.employeeFindFirst.mockResolvedValue({ id: "emp-1" });
		mockState.insertReturning.mockResolvedValue([insertedRecord]);

		const result = await createTimeRecord({
			employeeId: "emp-1",
			recordKind: "work",
			startAt: "2026-01-01T08:00:00.000Z",
		});

		expect(result).toEqual({ success: true, data: insertedRecord });
		expect(mockState.employeeFindFirst).toHaveBeenCalledTimes(1);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "emp-1",
				createdBy: "user-1",
				updatedBy: "user-1",
			}),
		);
	});

	it("denies create for another employee when actor is a regular employee", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: { id: "emp-1", organizationId: "org-1", role: "employee", teamId: null },
		});

		const result = await createTimeRecord({
			employeeId: "emp-2",
			recordKind: "work",
			startAt: "2026-01-01T08:00:00.000Z",
		});

		expect(result).toEqual({ success: false, error: "Forbidden" });
		expect(mockState.employeeFindFirst).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("allows create for another employee when actor is manager", async () => {
		const insertedRecord = {
			id: "rec-2",
			organizationId: "org-1",
			employeeId: "emp-2",
			recordKind: "work",
			startAt: new Date("2026-01-01T08:00:00.000Z"),
		};

		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: { id: "mgr-1", organizationId: "org-1", role: "manager", teamId: null },
		});
		mockState.employeeFindFirst.mockResolvedValue({ id: "emp-2" });
		mockState.insertReturning.mockResolvedValue([insertedRecord]);

		const result = await createTimeRecord({
			employeeId: "emp-2",
			recordKind: "work",
			startAt: "2026-01-01T08:00:00.000Z",
		});

		expect(result).toEqual({ success: true, data: insertedRecord });
	});

	it("lists records with organization predicate and limit", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: { id: "emp-1", organizationId: "org-1", role: "employee", teamId: null },
		});
		mockState.selectLimit.mockResolvedValue([]);

		const result = await listTimeRecords({ employeeId: "emp-1", recordKind: "work", limit: 10 });

		expect(result).toEqual({ success: true, data: [] });
		const whereArg = mockState.selectWhere.mock.calls[0]?.[0] as {
			conditions: Array<{ type: string; column: string; value: string }>;
		};
		expect(whereArg.conditions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "eq", column: "timeRecord.organizationId", value: "org-1" }),
			]),
		);
		expect(mockState.selectLimit).toHaveBeenCalledWith(10);
	});

	it("denies list for another employee when actor is a regular employee", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: { id: "emp-1", organizationId: "org-1", role: "employee", teamId: null },
		});

		const result = await listTimeRecords({ employeeId: "emp-2", limit: 10 });

		expect(result).toEqual({ success: false, error: "Forbidden" });
		expect(mockState.dbSelect).not.toHaveBeenCalled();
	});

	it("enforces self-scope list when employeeId filter is omitted for regular employee", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: { id: "emp-1", organizationId: "org-1", role: "employee", teamId: null },
		});
		mockState.selectLimit.mockResolvedValue([]);

		const result = await listTimeRecords({ recordKind: "work", limit: 10 });

		expect(result).toEqual({ success: true, data: [] });
		const whereArg = mockState.selectWhere.mock.calls[0]?.[0] as {
			conditions: Array<{ type: string; column: string; value: string }>;
		};
		expect(whereArg.conditions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "eq", column: "timeRecord.employeeId", value: "emp-1" }),
			]),
		);
	});

	it("allows list for another employee when actor is admin", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: { id: "admin-1", organizationId: "org-1", role: "admin", teamId: null },
		});
		mockState.selectLimit.mockResolvedValue([]);

		const result = await listTimeRecords({ employeeId: "emp-2", limit: 10 });

		expect(result).toEqual({ success: true, data: [] });
		const whereArg = mockState.selectWhere.mock.calls[0]?.[0] as {
			conditions: Array<{ type: string; column: string; value: string }>;
		};
		expect(whereArg.conditions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "eq", column: "timeRecord.employeeId", value: "emp-2" }),
			]),
		);
	});
});
