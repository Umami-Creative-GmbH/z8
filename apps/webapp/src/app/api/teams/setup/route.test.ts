import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getSession: vi.fn(),
	headers: vi.fn(),
	getAbility: vi.fn(),
	employeeFindFirst: vi.fn(),
	organizationFindFirst: vi.fn(),
	teamsTenantFindFirst: vi.fn(),
	insertValues: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAbility: mockState.getAbility,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mockState.employeeFindFirst },
			organization: { findFirst: mockState.organizationFindFirst },
			teamsTenantConfig: { findFirst: mockState.teamsTenantFindFirst },
		},
		insert: () => ({ values: mockState.insertValues }),
	},
}));

vi.mock("@/db/schema", () => ({
	employee: { userId: "employee.userId", organizationId: "employee.organizationId" },
	teamsTenantConfig: {
		id: "teamsTenantConfig.id",
		tenantId: "teamsTenantConfig.tenantId",
		organizationId: "teamsTenantConfig.organizationId",
	},
}));

vi.mock("@/db/auth-schema", () => ({
	organization: { id: "organization.id" },
}));

vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => args,
	eq: (...args: unknown[]) => args,
}));

const { POST } = await import("./route");

function createRequest(body: unknown): NextRequest {
	return new Request("https://app.example.com/api/teams/setup", {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
	}) as NextRequest;
}

describe("POST /api/teams/setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-active" },
		});
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn().mockReturnValue(false),
		});
		mockState.employeeFindFirst.mockResolvedValue({ id: "emp-target" });
		mockState.organizationFindFirst.mockResolvedValue({ id: "org-target" });
		mockState.teamsTenantFindFirst.mockResolvedValue(null);
		mockState.insertValues.mockResolvedValue(undefined);
	});

	it("rejects setup for a non-active target organization", async () => {
		const response = await POST(
			createRequest({
				tenantId: "tenant-1",
				tenantName: "Tenant 1",
				organizationId: "org-target",
			}),
		);

		expect(response.status).toBe(403);
		expect(mockState.getAbility).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Access denied" });
	});
});
