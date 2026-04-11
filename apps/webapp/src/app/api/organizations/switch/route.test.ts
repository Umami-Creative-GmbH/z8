import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn();
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));

	return {
		resolvedHeaders: new Headers(),
		headers: vi.fn(async () => mockState.resolvedHeaders),
		getSession: vi.fn(),
		setActiveOrganization: vi.fn(),
		select,
		from,
		where,
		limit,
		connection: vi.fn(),
	};
});

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: mockState.connection,
	};
});

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
			setActiveOrganization: mockState.setActiveOrganization,
		},
	},
}));

vi.mock("@/db", () => ({
	db: {
		select: mockState.select,
	},
}));

vi.mock("@/lib/app-url", () => ({
	getDefaultAppBaseUrl: () => "https://app.example.com",
}));

vi.mock("@/lib/diagnostics", () => ({
	getAuthRequestDiagnostics: vi.fn(() => ({})),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "member.userId",
		organizationId: "member.organizationId",
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		userId: "employee.userId",
		organizationId: "employee.organizationId",
		isActive: "employee.isActive",
	},
}));

const { POST } = await import("./route");

function createRequest(headers: HeadersInit, body: unknown): NextRequest {
	return new Request("https://app.example.com/api/organizations/switch", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	}) as NextRequest;
}

describe("POST /api/organizations/switch bearer access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.resolvedHeaders = new Headers();
		mockState.limit.mockResolvedValueOnce([{ id: "member-1" }]).mockResolvedValueOnce([{ id: "emp-1" }]);
	});

	it("allows bearer org switching when the user has any non-web app access even if X-Z8-App-Type is spoofed", async () => {
		mockState.resolvedHeaders = new Headers({
			authorization: "Bearer session-token",
			"x-z8-app-type": "mobile",
		});
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				canUseDesktop: true,
				canUseMobile: false,
			},
			session: {},
		});

		const response = await POST(
			createRequest(
				{ Authorization: "Bearer session-token", "X-Z8-App-Type": "mobile" },
				{ organizationId: "org-2" },
			),
		);

		expect(response.status).toBe(200);
		expect(mockState.setActiveOrganization).toHaveBeenCalledWith({
			headers: mockState.resolvedHeaders,
			body: { organizationId: "org-2" },
		});
	});

	it("rejects bearer org switching when the user has no non-web client access", async () => {
		mockState.resolvedHeaders = new Headers({
			authorization: "Bearer session-token",
			"x-z8-app-type": "desktop",
		});
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				canUseDesktop: false,
				canUseMobile: false,
			},
			session: {},
		});

		const response = await POST(
			createRequest(
				{ Authorization: "Bearer session-token", "X-Z8-App-Type": "desktop" },
				{ organizationId: "org-2" },
			),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Access denied" });
		expect(mockState.setActiveOrganization).not.toHaveBeenCalled();
	});
});
