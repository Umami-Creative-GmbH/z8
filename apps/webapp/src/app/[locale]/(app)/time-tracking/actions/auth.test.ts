import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
	findFirst: vi.fn(),
	findUserSettings: vi.fn(),
}));

const authState = vi.hoisted(() => ({
	getSession: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: dbState.findFirst,
			},
			userSettings: {
				findFirst: dbState.findUserSettings,
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
	userSettings: {
		userId: "userSettings.userId",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: authState.getSession,
		},
	},
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
}));

import { getCurrentEmployee } from "./auth";

describe("getCurrentEmployee", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not fall back to another org employee when activeOrganizationId is set", async () => {
		authState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		dbState.findFirst
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ id: "employee-in-other-org", organizationId: "org-2" });

		await expect(getCurrentEmployee()).resolves.toBeNull();
	});
});
