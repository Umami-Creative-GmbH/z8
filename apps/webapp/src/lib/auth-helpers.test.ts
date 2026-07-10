import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

describe("getAuthContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.selectResults = [];
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1", role: "user" },
			session: { activeOrganizationId: "org-1" },
		});
	});

	it("requires current membership before exposing an employee", () => {
		const source = readFileSync(
			fileURLToPath(new URL("./auth-helpers.ts", import.meta.url)),
			"utf8",
		);
		const body = source.slice(
			source.indexOf("export const getAuthContext"),
			source.indexOf("/**\n * Require authenticated user"),
		);

		expect(body).toContain("memberRecord");
		expect(body).toContain("memberRecord && employeeRecord");
	});

	it("requires approved membership in every organization membership helper", () => {
		const source = readFileSync(
			fileURLToPath(new URL("./auth-helpers.ts", import.meta.url)),
			"utf8",
		);

		for (const marker of [
			"export async function verifyOrgMembership",
			"export async function getSettingsAccessInputForUser",
			"export async function isOrgAdminCasl",
		]) {
			const start = source.indexOf(marker);
			const nextExport = source.indexOf("export ", start + marker.length);
			const body = source.slice(start, nextExport === -1 ? undefined : nextExport);
			expect(body).toContain('eq(member.status, "approved")');
		}

		const settingsAccessBody = source.slice(
			source.indexOf("export async function getSettingsAccessInputForUser"),
			source.indexOf("export async function getSettingsAccessTierForUser"),
		);
		expect(settingsAccessBody).toContain(
			"employeeRole: membershipRecord ? (employeeRecord?.role ?? null) : null",
		);
	});
});

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

	it("drops employee authorization when organization membership is removed", async () => {
		mockState.selectResults = [
			[],
			[
				{
					id: "employee-1",
					organizationId: "org-1",
					role: "admin",
					teamId: null,
				},
			],
		];

		const principal = await getPrincipalContext();

		expect(principal?.orgMembership).toBeNull();
		expect(principal?.employee).toBeNull();
		expect(principal?.permissions.orgWide).toBeNull();
		expect(principal?.customRoles).toEqual([]);
	});
});
