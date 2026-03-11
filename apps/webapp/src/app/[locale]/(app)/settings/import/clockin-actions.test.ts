import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireUser: vi.fn(),
	findFirst: vi.fn(),
	clockinTestConnection: vi.fn(),
	clockinGetEmployees: vi.fn(),
	clockinSearchWorkdays: vi.fn(),
	clockinSearchAbsences: vi.fn(),
	selectWhere: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();

	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: mockState.requireUser,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: {
				findFirst: mockState.findFirst,
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: mockState.selectWhere,
				})),
			})),
		})),
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "member.userId",
		organizationId: "member.organizationId",
	},
	user: {
		email: "user.email",
		name: "user.name",
		id: "user.id",
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "employee.id",
		userId: "employee.userId",
		firstName: "employee.firstName",
		lastName: "employee.lastName",
		organizationId: "employee.organizationId",
	},
}));

vi.mock("@/lib/clockin/client", () => ({
	ClockinClient: class {
		testConnection = mockState.clockinTestConnection;
		getEmployees = mockState.clockinGetEmployees;
		searchWorkdays = mockState.clockinSearchWorkdays;
		searchAbsences = mockState.clockinSearchAbsences;
	},
}));

const { fetchClockinEmployees, validateClockinCredentials } = await import("./clockin-actions");

describe("Clockin actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireUser.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org_123" },
		});
		mockState.findFirst.mockResolvedValue({ role: "admin" });
		mockState.clockinTestConnection.mockResolvedValue({ success: true });
		mockState.clockinGetEmployees.mockResolvedValue([]);
		mockState.clockinSearchWorkdays.mockResolvedValue([]);
		mockState.clockinSearchAbsences.mockResolvedValue([]);
		mockState.selectWhere.mockResolvedValue([]);
	});

	it("returns unauthorized when the current user is not an admin", async () => {
		mockState.findFirst.mockResolvedValue({ role: "employee" });

		const result = await validateClockinCredentials("token", "org_123");

		expect(result).toEqual({ success: false, error: "Unauthorized" });
		expect(mockState.clockinTestConnection).not.toHaveBeenCalled();
	});

	it("fetches provider employees for authorized admins", async () => {
		mockState.clockinGetEmployees.mockResolvedValue([
			{ id: 1, first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
		]);

		const result = await fetchClockinEmployees("token", "org_123");

		expect(result).toEqual({
			success: true,
			data: [
				{ id: 1, name: "Ada Lovelace", email: "ada@example.com" },
			],
		});
	});
});
