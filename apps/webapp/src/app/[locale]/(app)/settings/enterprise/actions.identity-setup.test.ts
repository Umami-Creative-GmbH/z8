import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const {
	generateEnterpriseIdentityScimTokenAction,
	refreshEnterpriseIdentityScimStatusAction,
} = await import("./actions");
const { canManageCurrentOrganizationSettings, requireUser } = await import("@/lib/auth-helpers");

const SCIM_UNAVAILABLE_MESSAGE =
	"SCIM provisioning is temporarily unavailable during the Better Auth 1.7 migration";

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

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireUser).mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		} as never);
		vi.mocked(canManageCurrentOrganizationSettings).mockResolvedValue(true);
	});

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

	it("uses Better Auth SSO APIs without referencing removed SCIM APIs", () => {
		expect(source).toContain("registerSSOProvider");
		expect(source).toContain("listSSOProviders");
		expect(source).not.toContain("listSCIMProviderConnections");
		expect(source).not.toContain("generateSCIMToken");
		expect(source).not.toContain("deleteSCIMProviderConnection");
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

	it("scaffolds setup responses with no SCIM connection", () => {
		const setupResponseSource = source.slice(
			source.indexOf("async function getSetupResponse"),
			source.indexOf("async function getOrganizationSSOProviders"),
		);

		expect(setupResponseSource).toContain("scimConnection: null");
		expect(setupResponseSource).not.toContain("listSCIMProviderConnections");
		expect(setupResponseSource).not.toContain("getEnterpriseIdentityScimConnection");
	});

	it("does not export synchronous runtime helpers from the server action module", () => {
		expect(source).not.toContain("export function ");
	});

	it("authorizes then fails closed when generating a SCIM token", async () => {
		const actionSource = getFunctionSource("generateEnterpriseIdentityScimTokenAction");

		await expect(
			generateEnterpriseIdentityScimTokenAction({ providerId: "provider-1" }),
		).rejects.toThrow(SCIM_UNAVAILABLE_MESSAGE);
		expect(requireUser).toHaveBeenCalledOnce();
		expect(canManageCurrentOrganizationSettings).toHaveBeenCalledOnce();
		expect(actionSource.indexOf("requireEnterpriseOrgAdmin()")).toBeLessThan(
			actionSource.indexOf("void input"),
		);
		expect(actionSource).toContain("throw new Error(SCIM_UNAVAILABLE_MESSAGE)");
		expect(actionSource).not.toMatch(/\b(?:db\.|auth\.api|updateEnterpriseIdentitySetupRecord|getOrCreateEnterpriseIdentitySetupRecord|revalidatePath)\b/);
	});

	it("authorizes then fails closed when refreshing SCIM status", async () => {
		const actionSource = getFunctionSource("refreshEnterpriseIdentityScimStatusAction");

		await expect(refreshEnterpriseIdentityScimStatusAction()).rejects.toThrow(
			SCIM_UNAVAILABLE_MESSAGE,
		);
		expect(requireUser).toHaveBeenCalledOnce();
		expect(canManageCurrentOrganizationSettings).toHaveBeenCalledOnce();
		expect(actionSource).toContain("requireEnterpriseOrgAdmin()");
		expect(actionSource).toContain("throw new Error(SCIM_UNAVAILABLE_MESSAGE)");
		expect(actionSource).not.toMatch(/\b(?:db\.|auth\.api|updateEnterpriseIdentitySetupRecord|getOrCreateEnterpriseIdentitySetupRecord|revalidatePath)\b/);
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
