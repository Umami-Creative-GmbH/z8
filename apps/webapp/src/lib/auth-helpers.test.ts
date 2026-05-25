import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapSessionUserToAuthContextUser } from "./auth/auth-context-user";

describe("mapSessionUserToAuthContextUser", () => {
	it("exposes trimmed first and last names while preserving the existing name", () => {
		expect(
			mapSessionUserToAuthContextUser({
				id: "user_123",
				email: "ada@example.com",
				name: "Ada Lovelace",
				firstName: "  Ada ",
				lastName: " Lovelace  ",
				canCreateOrganizations: true,
				canUseWebapp: true,
				canUseDesktop: false,
				canUseMobile: true,
			}),
		).toMatchObject({
			id: "user_123",
			email: "ada@example.com",
			name: "Ada Lovelace",
			firstName: "Ada",
			lastName: "Lovelace",
			canCreateOrganizations: true,
			canUseWebapp: true,
			canUseDesktop: false,
			canUseMobile: true,
		});
	});

	it("drops blank structured names and keeps compatibility defaults", () => {
		expect(
			mapSessionUserToAuthContextUser({
				id: "user_456",
				email: "grace@example.com",
				name: "Grace Hopper",
				firstName: "  ",
				lastName: undefined,
			}),
		).toMatchObject({
			name: "Grace Hopper",
			firstName: undefined,
			lastName: undefined,
			canCreateOrganizations: false,
			canUseWebapp: true,
			canUseDesktop: true,
			canUseMobile: true,
		});
	});
});

const mockState = vi.hoisted(() => ({
	selectResults: [] as unknown[][],
	getSession: vi.fn(),
}));

function queryBuilder(result: unknown[]) {
	const builder = {
		from: vi.fn(() => builder),
		innerJoin: vi.fn(() => builder),
		where: vi.fn(() => builder),
		limit: vi.fn(async () => result),
		then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
			Promise.resolve(result).then(resolve, reject),
	};
	return builder;
}

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/db", () => ({
	db: {
		select: vi.fn(() => queryBuilder(mockState.selectResults.shift() ?? [])),
	},
}));

const { getPrincipalContext } = await import("./auth-helpers");

describe("getPrincipalContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.selectResults = [];
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1", role: "user" },
			session: { activeOrganizationId: "org-1" },
		});
	});

	it("loads assigned custom role permissions into the principal", async () => {
		mockState.selectResults = [
			[{ id: "member-1", organizationId: "org-1", role: "member" }],
			[
				{
					id: "employee-1",
					organizationId: "org-1",
					role: "employee",
					teamId: null,
				},
			],
			[],
			[
				{
					roleId: "role-1",
					roleName: "Works Council Reviewer",
					baseTier: "employee",
					action: "read",
					subject: "WorksCouncil",
				},
				{
					roleId: "role-1",
					roleName: "Works Council Reviewer",
					baseTier: "employee",
					action: "export",
					subject: "WorksCouncil",
				},
			],
			[],
		];

		const principal = await getPrincipalContext();

		expect(principal?.customRoles).toEqual([
			{
				roleId: "role-1",
				roleName: "Works Council Reviewer",
				baseTier: "employee",
				permissions: [
					{ action: "read", subject: "WorksCouncil" },
					{ action: "export", subject: "WorksCouncil" },
				],
			},
		]);
	});
});
