import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findFirst: vi.fn(async () => null),
	getAuthContext: vi.fn(async () => null),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: mockState.findFirst,
			},
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	organization: {
		id: "organization.id",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));

vi.mock("drizzle-orm", () => ({
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
}));

const { GET } = await import("./route");

describe("GET /api/auth/context", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getAuthContext.mockResolvedValue({
			employee: {
				id: "employee_1",
				organizationId: "org_1",
				role: "admin",
				teamId: null,
			},
			session: { activeOrganizationId: "org_1" },
			user: {
				email: "admin@example.com",
				id: "user_1",
				name: "Admin User",
			},
		});
	});

	it("normalizes invalid persisted fiscal year start months before hydration", async () => {
		mockState.findFirst.mockResolvedValue({
			deletedAt: null,
			demoDataEnabled: true,
			fiscalYearStartMonth: 13,
			id: "org_1",
			projectsEnabled: false,
			shiftsEnabled: false,
			surchargesEnabled: false,
			timezone: "UTC",
		});

		const response = await GET();
		const body = await response.json();

		expect(body.organizationSettings.fiscalYearStartMonth).toBe(1);
	});
});
