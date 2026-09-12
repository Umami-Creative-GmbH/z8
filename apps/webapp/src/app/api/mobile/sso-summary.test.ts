import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	employee: vi.fn(),
	allowed: vi.fn(async () => false),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: mocks.allowed,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: async () => ({
					id: "locked",
					name: "Locked",
					slug: "locked",
				}),
			},
			employee: { findFirst: mocks.employee },
		},
	},
}));
import { getMobileOrganizationSummary } from "./shared";
describe("mobile organization discovery", () => {
	it("keeps discovery available but does not load or imply employee access without SSO proof", async () => {
		mocks.employee.mockResolvedValue({ id: "private-employee" });
		expect(
			await getMobileOrganizationSummary("actor", "locked", {
				id: "session",
				userId: "actor",
			}),
		).toMatchObject({
			id: "locked",
			ssoRequired: true,
			hasEmployeeRecord: false,
		});
		expect(mocks.employee).not.toHaveBeenCalled();
	});
});
