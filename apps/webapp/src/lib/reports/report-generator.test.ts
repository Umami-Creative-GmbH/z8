import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	homeOfficeCategoryWhere: null as unknown,
	absenceEntryWhere: null as unknown,
	homeOfficeCategories: [] as Array<{ id: string }>,
	absences: [] as Array<{ categoryId: string; startDate: string; endDate: string }>,
	absenceCategoryFindMany: vi.fn(async (options?: { where?: unknown }) => {
		mockState.homeOfficeCategoryWhere = options?.where ?? null;
		return mockState.homeOfficeCategories;
	}),
	absenceEntryFindMany: vi.fn(async (options?: { where?: unknown }) => {
		mockState.absenceEntryWhere = options?.where ?? null;
		return mockState.absences;
	}),
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(async () => []),
		})),
	})),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	isNotNull: vi.fn((value: unknown) => ({ isNotNull: value })),
	isNull: vi.fn((value: unknown) => ({ isNull: value })),
	lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
	or: vi.fn((...args: unknown[]) => ({ or: args })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceCategory: {
				findMany: mockState.absenceCategoryFindMany,
			},
			absenceEntry: {
				findMany: mockState.absenceEntryFindMany,
			},
		},
		select: mockState.select,
	},
}));

vi.mock("@/db/schema", () => ({
	absenceCategory: {
		id: "id",
		isActive: "isActive",
		organizationId: "organizationId",
		type: "type",
	},
	absenceEntry: {
		categoryId: "categoryId",
		employeeId: "employeeId",
		endDate: "endDate",
		startDate: "startDate",
		status: "status",
	},
	employee: { id: "id" },
	employeeRateHistory: {},
	workPeriod: {},
}));

vi.mock("@/lib/time-tracking/calculations", () => ({
	calculateExpectedWorkHoursForEmployee: vi.fn(),
	calculateWorkHours: vi.fn(),
}));

const { aggregateHomeOfficeDays } = await import("./report-generator");

describe("report generator", () => {
	beforeEach(() => {
		mockState.homeOfficeCategoryWhere = null;
		mockState.absenceEntryWhere = null;
		mockState.homeOfficeCategories = [];
		mockState.absences = [];
		mockState.absenceCategoryFindMany.mockClear();
		mockState.absenceEntryFindMany.mockClear();
		mockState.select.mockClear();
	});

	it("scopes home office category lookup to all home office categories in the report organization", async () => {
		await aggregateHomeOfficeDays(
			"employee-1",
			"org-1",
			new Date("2026-01-01T00:00:00.000Z"),
			new Date("2026-01-31T00:00:00.000Z"),
		);

		expect(mockState.absenceCategoryFindMany).toHaveBeenCalledTimes(1);
		expect(mockState.homeOfficeCategoryWhere).toEqual({
			and: [{ eq: ["type", "home_office"] }, { eq: ["organizationId", "org-1"] }],
		});
	});

	it("aggregates home office days across active and inactive home office categories", async () => {
		mockState.homeOfficeCategories = [{ id: "home-office-1" }, { id: "home-office-2" }];
		mockState.absences = [
			{ categoryId: "home-office-1", startDate: "2026-01-05", endDate: "2026-01-06" },
			{ categoryId: "home-office-2", startDate: "2026-01-07", endDate: "2026-01-08" },
		];

		const result = await aggregateHomeOfficeDays(
			"employee-1",
			"org-1",
			new Date("2026-01-01T00:00:00.000Z"),
			new Date("2026-01-31T00:00:00.000Z"),
		);

		expect(result.days).toBe(2);
		expect(mockState.absenceEntryFindMany).toHaveBeenCalledTimes(1);
		expect(mockState.absenceEntryWhere).toEqual({
			and: [
				{ eq: ["employeeId", "employee-1"] },
				{ or: [{ eq: ["categoryId", "home-office-1"] }, { eq: ["categoryId", "home-office-2"] }] },
				{ eq: ["status", "approved"] },
				{ lte: ["startDate", "2026-01-31"] },
				{ gte: ["endDate", "2026-01-01"] },
			],
		});
	});
});
