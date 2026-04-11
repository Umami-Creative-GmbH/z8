import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getSession: vi.fn(),
	findManyMembers: vi.fn(),
	findOrganization: vi.fn(),
	findEmployee: vi.fn(),
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
		query: {
			member: {
				findMany: mockState.findManyMembers,
			},
			organization: {
				findFirst: mockState.findOrganization,
			},
			employee: {
				findFirst: mockState.findEmployee,
			},
		},
	},
}));

const { GET } = await import("./route");

describe("GET /api/mobile/session", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects cookie-only access for mobile endpoints", async () => {
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				name: "Pat Example",
				email: "pat@example.com",
				canUseMobile: true,
			},
			session: {
				activeOrganizationId: "org-1",
			},
		});

		const response = await GET(
			new Request("https://app.example.com/api/mobile/session", {
				headers: {
					cookie: "session=abc",
				},
			}),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Bearer token required" });
	});

	it("rejects bearer requests that are not marked as mobile", async () => {
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				name: "Pat Example",
				email: "pat@example.com",
				canUseMobile: true,
			},
			session: {
				activeOrganizationId: "org-1",
			},
		});

		const response = await GET(
			new Request("https://app.example.com/api/mobile/session", {
				headers: {
					Authorization: "Bearer session-token",
					"X-Z8-App-Type": "web",
				},
			}),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Mobile app access required" });
	});

	it("rejects bearer requests with a mobile user-agent when X-Z8-App-Type is missing", async () => {
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				name: "Pat Example",
				email: "pat@example.com",
				canUseMobile: true,
			},
			session: {
				activeOrganizationId: "org-1",
			},
		});

		const response = await GET(
			new Request("https://app.example.com/api/mobile/session", {
				headers: {
					Authorization: "Bearer session-token",
					"User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile",
				},
			}),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Mobile app access required" });
	});

	it("returns the active organization and org memberships for a mobile bearer session", async () => {
		mockState.getSession.mockResolvedValue({
			user: {
				id: "user-1",
				name: "Pat Example",
				email: "pat@example.com",
				canUseMobile: true,
			},
			session: {
				activeOrganizationId: "org-1",
			},
		});
		mockState.findManyMembers.mockResolvedValue([
			{ organizationId: "org-1" },
			{ organizationId: "org-2" },
		]);
		mockState.findOrganization.mockResolvedValueOnce({
			id: "org-1",
			name: "Org One",
			slug: "org-one",
		});
		mockState.findOrganization.mockResolvedValueOnce({
			id: "org-2",
			name: "Org Two",
			slug: "org-two",
		});
		mockState.findEmployee.mockResolvedValueOnce({ id: "emp-1" });
		mockState.findEmployee.mockResolvedValueOnce(undefined);

		const response = await GET(
			new Request("https://app.example.com/api/mobile/session", {
				headers: {
					Authorization: "Bearer session-token",
					"X-Z8-App-Type": "mobile",
				},
			}),
		);

		expect(response.status).toBe(200);
		const payload = await response.json();

		expect(payload).toEqual({
			user: {
				id: "user-1",
				name: "Pat Example",
				email: "pat@example.com",
			},
			activeOrganizationId: "org-1",
			organizations: [
				{
					id: "org-1",
					name: "Org One",
					slug: "org-one",
					hasEmployeeRecord: true,
				},
				{
					id: "org-2",
					name: "Org Two",
					slug: "org-two",
					hasEmployeeRecord: false,
				},
			],
		});
		expect(payload.organizations[1]).toEqual(
			expect.objectContaining({ hasEmployeeRecord: false }),
		);
	});
});
