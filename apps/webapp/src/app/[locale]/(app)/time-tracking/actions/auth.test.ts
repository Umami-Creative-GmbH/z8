import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
	findFirst: vi.fn(),
	findMember: vi.fn(),
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
			member: {
				findFirst: dbState.findMember,
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

vi.mock("@/db/auth-schema", () => ({
	member: {
		organizationId: "member.organizationId",
		status: "member.status",
		userId: "member.userId",
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
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	eq: vi.fn((column: unknown, value: unknown) => ({
		type: "eq",
		column,
		value,
	})),
	relations: vi.fn(() => ({})),
}));

import { getCurrentEmployee } from "./auth";

describe("getCurrentEmployee", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("does not fall back to another org employee when activeOrganizationId is set", async () => {
		authState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		dbState.findMember.mockResolvedValue({ id: "member-1" });
		dbState.findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			id: "employee-in-other-org",
			organizationId: "org-2",
		});

		await expect(getCurrentEmployee()).resolves.toBeNull();
	});

	it("resolves a changed active organization freshly for each action", async () => {
		authState.getSession
			.mockResolvedValueOnce({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			})
			.mockResolvedValueOnce({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-2" },
			});
		dbState.findMember.mockResolvedValue({ id: "member-1", role: "employee" });
		dbState.findFirst
			.mockResolvedValueOnce({ id: "employee-1", organizationId: "org-1" })
			.mockResolvedValueOnce({ id: "employee-2", organizationId: "org-2" });

		await expect(getCurrentEmployee()).resolves.toMatchObject({
			id: "employee-1",
			organizationId: "org-1",
		});
		await expect(getCurrentEmployee()).resolves.toMatchObject({
			id: "employee-2",
			organizationId: "org-2",
		});
		expect(authState.getSession).toHaveBeenCalledTimes(2);
		expect(dbState.findMember).toHaveBeenLastCalledWith(
			expect.objectContaining({
				where: {
					type: "and",
					conditions: [
						{ type: "eq", column: "member.userId", value: "user-1" },
						{ type: "eq", column: "member.organizationId", value: "org-2" },
						{ type: "eq", column: "member.status", value: "approved" },
					],
				},
			}),
		);
	});

	it("denies the next action when membership is revoked even if the employee remains", async () => {
		authState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		dbState.findFirst.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
		});
		dbState.findMember
			.mockResolvedValueOnce({ id: "member-1", role: "owner" })
			.mockResolvedValueOnce(undefined);

		await expect(getCurrentEmployee()).resolves.toMatchObject({
			id: "employee-1",
		});
		await expect(getCurrentEmployee()).resolves.toBeNull();
		expect(authState.getSession).toHaveBeenCalledTimes(2);
	});
});
