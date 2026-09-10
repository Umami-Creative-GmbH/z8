import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	getUserOrganizations: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async () => ({
	...(await vi.importActual<typeof import("next/server")>("next/server")),
	connection: async () => {},
}));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth-helpers", () => ({
	getUserOrganizations: mocks.getUserOrganizations,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

const { GET } = await import("./route");

describe("GET /api/session/organization-status", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns organization status with legacy disabled app flags", async () => {
		mocks.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				canUseWebapp: false,
				canUseDesktop: false,
				canUseMobile: false,
			},
			session: { activeOrganizationId: "org-1" },
		});
		mocks.getUserOrganizations.mockResolvedValue([
			{ id: "org-1", name: "Organization One" },
		]);

		const response = await GET();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			hasActiveOrganization: true,
			activeOrganizationId: "org-1",
			organizations: [{ id: "org-1", name: "Organization One" }],
		});
	});

	it("requires an authenticated session before loading organizations", async () => {
		mocks.getSession.mockResolvedValue(null);

		const response = await GET();

		expect(response.status).toBe(401);
		expect(mocks.getUserOrganizations).not.toHaveBeenCalled();
	});
});
