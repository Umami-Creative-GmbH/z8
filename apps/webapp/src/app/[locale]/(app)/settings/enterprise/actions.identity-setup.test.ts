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
	organizationDomain: {},
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
const { buildEnterpriseIdentityScimTokenResponse } = await import(
	"@/lib/enterprise-identity/scim-token-response"
);

function getFunctionSource(functionName: string) {
	const match = source.match(
		new RegExp(`export async function ${functionName}\\([\\s\\S]*?\\r?\\n}\\r?\\n`),
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
		"refreshEnterpriseIdentityDomainStatusAction",
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
		expect(source).toContain("listSSOProviders");
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
			buildEnterpriseIdentityScimTokenResponse({ scimToken: "scim-secret" }, "provider-1"),
		).toEqual({
			providerId: "provider-1",
			scimToken: "scim-secret",
			baseUrl: "/api/auth/scim/v2",
		});
	});

	it("does not export synchronous runtime helpers from the server action module", () => {
		expect(source).not.toContain("export function ");
	});

	it("generates SCIM token before persisting enabled setup state", () => {
		const actionSource = getFunctionSource("generateEnterpriseIdentityScimTokenAction");
		const generateIndex = actionSource.indexOf("generateSCIMToken");
		const configWriteIndex = actionSource.indexOf("insert(scimProviderConfig)");
		const setupWriteIndex = actionSource.indexOf("updateEnterpriseIdentitySetupRecord");

		expect(configWriteIndex).toBeGreaterThan(-1);
		expect(setupWriteIndex).toBeGreaterThan(-1);
		expect(generateIndex).toBeLessThan(configWriteIndex);
		expect(generateIndex).toBeLessThan(setupWriteIndex);
		expect(actionSource.slice(generateIndex)).not.toContain("getSetupResponse");
	});

	it("does not persist generated SCIM token text in setup state", () => {
		const actionSource = getFunctionSource("generateEnterpriseIdentityScimTokenAction");
		const setupWriteIndex = actionSource.indexOf("updateEnterpriseIdentitySetupRecord");
		const generateIndex = actionSource.indexOf("generateSCIMToken");

		expect(setupWriteIndex).toBeGreaterThan(-1);
		expect(generateIndex).toBeLessThan(setupWriteIndex);
		expect(actionSource.slice(setupWriteIndex)).not.toContain("scimToken");
	});

	it("filters SCIM token generation audit rows out of provisioning status", () => {
		const actionSource = getFunctionSource("refreshEnterpriseIdentityScimStatusAction");

		expect(actionSource).toContain("isScimTokenGenerationLog");
		expect(actionSource).toContain('metadata.idpProvider === "scim"');
		expect(actionSource).toContain('metadata.scimDisplayName?.startsWith("SCIM Provider ")');
	});

	it("refreshes domain verification from org-scoped Better Auth providers", () => {
		const actionSource = getFunctionSource("refreshEnterpriseIdentityDomainStatusAction");

		expect(actionSource).toContain("requireEnterpriseOrgAdmin()");
		expect(actionSource).toContain("findEnterpriseIdentitySSOProvider");
		expect(actionSource).toContain("domainVerified");
		expect(actionSource).toContain("updateEnterpriseIdentitySetupRecord");
	});

	it("syncs domain verification and domain auth config during activation", () => {
		const actionSource = getFunctionSource("activateEnterpriseIdentitySetupAction");

		expect(actionSource).toContain("syncEnterpriseIdentityDomainVerification");
		expect(actionSource).toContain("listOrganizationDomains");
		expect(actionSource).toContain("selectVerifiedEnterpriseIdentityDomain");
		expect(actionSource).toContain("updateDomainAuthConfig");
		expect(actionSource).toContain("ssoProviderId: setupRecord.providerId");
		expect(actionSource).not.toContain("const [domainRecord] = domains");
	});

	it("scopes domain management actions to the active organization", () => {
		const domainActions = [
			"verifyDomainAction",
			"regenerateVerificationTokenAction",
			"updateDomainAuthConfigAction",
			"deleteDomainAction",
		];

		for (const actionName of domainActions) {
			const actionSource = getFunctionSource(actionName);

			expect(actionSource).toContain("requireEnterpriseOrgAdmin()");
			expect(actionSource).toContain("requireOrganizationDomain(domainId, organizationId)");
		}
	});

	it("validates provider and SSO registration input before side effects", () => {
		const providerSource = getFunctionSource("updateEnterpriseIdentityProviderAction");
		const ssoSource = getFunctionSource("registerEnterpriseIdentitySSOProviderAction");
		const validationCall = "validateEnterpriseIdentityProviderInput({ providerId, domain })";

		expect(source).toContain("validateEnterpriseIdentityProviderInput");
		expect(providerSource).toContain(validationCall);
		expect(ssoSource).toContain(validationCall);
		expect(providerSource.indexOf(validationCall)).toBeLessThan(
			providerSource.indexOf("getOrCreateEnterpriseIdentitySetupRecord"),
		);
		expect(ssoSource.indexOf(validationCall)).toBeLessThan(
			ssoSource.indexOf("getOrCreateEnterpriseIdentitySetupRecord"),
		);
		expect(ssoSource.indexOf(validationCall)).toBeLessThan(ssoSource.indexOf("storeOrgSecret"));
		expect(ssoSource.indexOf(validationCall)).toBeLessThan(
			ssoSource.indexOf("registerSSOProvider"),
		);
	});
});
