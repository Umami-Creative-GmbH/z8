import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ employee: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async () => ({
	...(await vi.importActual("next/server")),
	connection: async () => {},
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: "actor" },
				session: {
					id: "session",
					userId: "actor",
					activeOrganizationId: "open",
				},
			}),
		},
	},
}));
vi.mock("@/lib/app-url", () => ({
	getDefaultAppBaseUrl: () => "https://app.test",
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: async (
		_session: unknown,
		organizationId: string,
	) => organizationId === "open",
}));
vi.mock("@/db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: async () => [{ organizationId: "locked", role: "owner" }],
			}),
		}),
		query: {
			organization: {
				findFirst: async () => ({
					id: "locked",
					name: "Locked",
					slug: "locked",
					logo: null,
				}),
			},
			employee: { findFirst: mocks.employee },
		},
	},
}));
import { GET } from "./route";
describe("desktop SSO organization discovery", () => {
	it("lists the workspace for reauthentication without exposing employee access", async () => {
		mocks.employee.mockResolvedValue({ id: "private-employee" });
		const response = await GET(
			new Request("https://app.test/api/desktop/organizations"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			organizations: [
				{ id: "locked", hasEmployeeRecord: false, ssoRequired: true },
			],
		});
		expect(mocks.employee).not.toHaveBeenCalled();
	});
});
