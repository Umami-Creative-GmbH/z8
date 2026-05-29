import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTimeEntriesForMonth } from "./time-entry-service";

const mockOperators = vi.hoisted(() => ({
	and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
	eq: vi.fn((column: unknown, value: unknown) => ({ column, type: "eq", value })),
	gte: vi.fn((column: unknown, value: unknown) => ({ column, type: "gte", value })),
	lte: vi.fn((column: unknown, value: unknown) => ({ column, type: "lte", value })),
}));

const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	from: vi.fn(),
	innerJoin: vi.fn(),
	where: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: mockOperators.and,
	eq: mockOperators.eq,
	gte: mockOperators.gte,
	lte: mockOperators.lte,
}));

vi.mock("@/db", () => ({
	db: {
		select: mockDb.select,
	},
}));

describe("getTimeEntriesForMonth", () => {
	beforeEach(() => {
		mockDb.select.mockReturnValue({ from: mockDb.from });
		mockDb.from.mockReturnValue({ innerJoin: mockDb.innerJoin });
		mockDb.innerJoin.mockReturnValue({ innerJoin: mockDb.innerJoin, where: mockDb.where });
		mockDb.where.mockResolvedValue([]);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses employee calendar timezone boundaries when querying month time entries", async () => {
		await getTimeEntriesForMonth(
			4,
			2026,
			{ organizationId: "org-1", employeeId: "employee-1" },
			"America/New_York",
		);

		expect(mockOperators.gte).toHaveBeenCalledWith(
			expect.anything(),
			new Date("2026-05-01T04:00:00.000Z"),
		);
		expect(mockOperators.lte).toHaveBeenCalledWith(
			expect.anything(),
			new Date("2026-06-01T03:59:59.999Z"),
		);
	});
});
