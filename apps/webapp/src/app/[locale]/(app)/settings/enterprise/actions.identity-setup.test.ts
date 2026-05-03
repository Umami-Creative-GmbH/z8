import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/db/schema", () => ({
	enterpriseIdentitySetup: {},
	roleTemplate: {},
	scimProviderConfig: {},
	scimProvisioningLog: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: {} },
}));

vi.mock("@/lib/auth-helpers", () => ({
	canManageCurrentOrganizationSettings: vi.fn(),
	requireUser: vi.fn(),
}));

vi.mock("@/lib/domain", () => ({
	deleteCustomDomain: vi.fn(),
	getOrganizationBranding: vi.fn(),
	listOrganizationDomains: vi.fn(),
	registerCustomDomain: vi.fn(),
	requestNewVerificationToken: vi.fn(),
	updateDomainAuthConfig: vi.fn(),
	updateOrganizationBranding: vi.fn(),
	verifyDomainOwnership: vi.fn(),
}));

vi.mock("@/lib/social-oauth", () => ({
	createSocialOAuthConfig: vi.fn(),
	deleteSocialOAuthConfig: vi.fn(),
	getConfiguredProviders: vi.fn(),
	listOrgSocialOAuthConfigs: vi.fn(),
	updateSocialOAuthConfig: vi.fn(),
	updateTestStatus: vi.fn(),
}));

vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: vi.fn(),
	storeOrgSecret: vi.fn(),
}));

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "actions.ts"), "utf8");
const actions = await import("./actions");

function getFunctionSource(functionName: string) {
	const match = source.match(
		new RegExp(`export async function ${functionName}\\([\\s\\S]*?\\n}\\n`),
	);

	if (!match) throw new Error(`Missing ${functionName}`);
	return match[0];
}

describe("enterprise identity setup action contracts", () => {
	const expectedExports = [
		"getEnterpriseIdentitySetupAction",
		"updateEnterpriseIdentityProviderAction",
		"registerEnterpriseIdentitySSOProviderAction",
		"recordEnterpriseIdentitySsoTestAction",
		"generateEnterpriseIdentityScimTokenAction",
		"refreshEnterpriseIdentityScimStatusAction",
		"updateEnterpriseIdentityAccessPolicyAction",
		"activateEnterpriseIdentitySetupAction",
	];

	it("exports the setup wizard server actions", () => {
		for (const actionName of expectedExports) {
			expect(source).toContain(`export async function ${actionName}`);
		}
	});

	it("gates actions through enterprise organization settings authorization", () => {
		expect(source).toContain("requireEnterpriseOrgAdmin()");
		expect(source).toContain("canManageCurrentOrganizationSettings(");
		expect(source).not.toContain('authContext.employee?.role !== "admin"');
	});

	it("keeps all setup persistence organization-scoped", () => {
		expect(source).toContain("enterpriseIdentitySetup.organizationId");
		expect(source).toContain("organizationId");
	});

	it("uses Better Auth SSO and SCIM APIs", () => {
		expect(source).toContain("registerSSOProvider");
		expect(source).toContain("generateSCIMToken");
		expect(source).toContain("listSCIMProviderConnections");
	});

	it("maps Better Auth identity errors before returning them", () => {
		expect(source).toContain("mapBetterAuthIdentityError");
	});

	it("does not modify or import generated auth schema", () => {
		expect(source).not.toContain("@/db/auth-schema");
		expect(source).not.toContain("../auth-schema");
	});

	it("keeps default role template as a top-level setup column", () => {
		expect(source).toContain("defaultRoleTemplateId");
		expect(source).not.toMatch(/pendingEnforcement\s*=\s*{[\s\S]*?defaultRoleTemplateId:/);
	});

	it("builds a safe SCIM token generation response without setup state", () => {
		expect(
			actions.buildEnterpriseIdentityScimTokenResponse({ scimToken: "scim-secret" }, "provider-1"),
		).toEqual({
			providerId: "provider-1",
			scimToken: "scim-secret",
			baseUrl: "/api/auth/scim/v2",
		});
	});

	it("does not do fallible setup response loading after SCIM token generation", () => {
		const actionSource = getFunctionSource("generateEnterpriseIdentityScimTokenAction");
		const generateIndex = actionSource.indexOf("generateSCIMToken");
		const configWriteIndex = actionSource.indexOf("insert(scimProviderConfig)");
		const setupWriteIndex = actionSource.indexOf("updateEnterpriseIdentitySetupRecord");

		expect(configWriteIndex).toBeGreaterThan(-1);
		expect(setupWriteIndex).toBeGreaterThan(-1);
		expect(generateIndex).toBeGreaterThan(configWriteIndex);
		expect(generateIndex).toBeGreaterThan(setupWriteIndex);
		expect(actionSource.slice(generateIndex)).not.toContain("getSetupResponse");
	});
});
