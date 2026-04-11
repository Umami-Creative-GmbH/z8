import { beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
	findFirst: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: queryState.findFirst,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		userId: "employee.userId",
		organizationId: "employee.organizationId",
		isActive: "employee.isActive",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
}));

import { findCurrentEmployeeByUserId } from "./current-employee";

describe("findCurrentEmployeeByUserId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when the active organization has no active employee row", async () => {
		queryState.findFirst
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ id: "employee-in-other-org", organizationId: "org-2" });

		await expect(
			findCurrentEmployeeByUserId(
				{
					query: {
						employee: {
							findFirst: queryState.findFirst,
						},
					},
				},
				"user-1",
				"org-1",
			),
		).resolves.toBeNull();
	});
});
