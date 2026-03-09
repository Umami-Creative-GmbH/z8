import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const insertReturning = vi.fn();
	const insertValues = vi.fn(() => ({ returning: insertReturning }));

	const updateReturning = vi.fn();
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));

	return {
		getAuthContext: vi.fn(),
		revalidatePath: vi.fn(),
		dbInsert: vi.fn(() => ({ values: insertValues })),
		dbUpdate: vi.fn(() => ({ set: updateSet })),
		insertReturning,
		updateWhere,
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	ne: vi.fn((left: unknown, right: unknown) => ({ ne: [left, right] })),
	desc: vi.fn((value: unknown) => ({ desc: value })),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockState.revalidatePath,
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));

vi.mock("@/db/schema", () => ({
	travelExpensePolicy: {
		id: "id",
		organizationId: "organizationId",
		effectiveFrom: "effectiveFrom",
		isActive: "isActive",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			travelExpensePolicy: {
				findMany: vi.fn(),
			},
		},
		insert: mockState.dbInsert,
		update: mockState.dbUpdate,
	},
}));

const { upsertTravelExpensePolicy } = await import("./actions");

describe("travel expense policy actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("unauthorized non-admin cannot upsert", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: {
				id: "emp-1",
				organizationId: "org-1",
				role: "employee",
			},
		});

		const result = await upsertTravelExpensePolicy({
			effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
			currency: "EUR",
			isActive: true,
		});

		expect(result).toEqual({ success: false, error: "Unauthorized: Admin access required" });
		expect(mockState.dbInsert).not.toHaveBeenCalled();
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("admin can create policy and gets success id", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			employee: {
				id: "emp-admin",
				organizationId: "org-1",
				role: "admin",
			},
		});
		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.insertReturning.mockResolvedValue([{ id: "policy-1" }]);

		const result = await upsertTravelExpensePolicy({
			effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
			effectiveTo: null,
			currency: "EUR",
			mileageRatePerKm: 0.42,
			perDiemRatePerDay: 28,
			isActive: true,
		});

		expect(result).toEqual({ success: true, data: { id: "policy-1" } });
		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(mockState.dbInsert).toHaveBeenCalledTimes(1);
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/settings/travel-expenses");
	});
});
