import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getAuthContext: vi.fn(),
	canManageCurrentOrganizationSettings: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	desc: vi.fn((value: unknown) => ({ desc: value })),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
	canManageCurrentOrganizationSettings: mockState.canManageCurrentOrganizationSettings,
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
	},
}));

const actions = await import("./actions");

describe("legacy travel expense policy actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.canManageCurrentOrganizationSettings.mockResolvedValue(false);
	});

	it("no longer offers the non-transactional legacy save (#606)", () => {
		expect(Object.keys(actions)).toEqual(["getTravelExpensePolicies"]);
	});

	it("refuses non-admins", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
			employee: { id: "emp-1", organizationId: "org-1", role: "employee" },
		});

		expect(await actions.getTravelExpensePolicies()).toEqual({
			success: false,
			error: "Unauthorized: Admin access required",
		});
	});

	it("lets owners without an admin employee row read the legacy rows with their stored dates", async () => {
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-owner" },
			session: { activeOrganizationId: "org-1" },
			employee: null,
		});
		mockState.canManageCurrentOrganizationSettings.mockResolvedValue(true);
		const { db } = await import("@/db");
		vi.mocked(db.query.travelExpensePolicy.findMany).mockResolvedValueOnce([
			{
				id: "policy-1",
				organizationId: "org-1",
				effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
				effectiveTo: null,
				currency: "EUR",
				mileageRatePerKm: "0.3000",
				perDiemRatePerDay: null,
				isActive: true,
			},
		] as never);

		expect(await actions.getTravelExpensePolicies()).toEqual({
			success: true,
			data: [
				{
					id: "policy-1",
					effectiveFrom: "2026-03-01",
					effectiveTo: null,
					currency: "EUR",
					mileageRatePerKm: "0.3000",
					perDiemRatePerDay: null,
					isActive: true,
				},
			],
		});
	});
});
