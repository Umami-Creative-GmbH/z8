import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	sso: {
		listSsoProviders: vi.fn(),
		registerSsoProvider: vi.fn(),
		deleteSsoProvider: vi.fn(),
		requestSsoDomainVerification: vi.fn(),
		verifySsoDomain: vi.fn(),
	},
	domain: {
		deleteCustomDomain: vi.fn(),
		getOrganizationBranding: vi.fn(),
		listOrganizationDomains: vi.fn(),
		registerCustomDomain: vi.fn(),
		requestNewVerificationToken: vi.fn(),
		updateDomainAuthConfig: vi.fn(),
		updateOrganizationBranding: vi.fn(),
		verifyDomainOwnership: vi.fn(),
	},
	socialOAuth: {
		checkSocialOAuthConfiguration: vi.fn(),
		createSocialOAuthConfig: vi.fn(),
		deleteSocialOAuthConfig: vi.fn(),
		getConfiguredProviders: vi.fn(),
		listOrgSocialOAuthConfigs: vi.fn(),
		updateSocialOAuthConfig: vi.fn(),
	},
	vault: { deleteOrgSecret: vi.fn(), storeOrgSecret: vi.fn() },
	getOrCreateSetupRecord: vi.fn(),
	domainFindFirst: vi.fn(),
	updateReturning: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: {
					organizationDomain: { findFirst: mocks.domainFindFirst },
					roleTemplate: { findFirst: vi.fn() },
				},
				select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
				update: () => ({
					set: () => ({ where: () => ({ returning: mocks.updateReturning }) }),
				}),
			},
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/enterprise-identity/sso-provider-api", () => mocks.sso);
vi.mock("@/lib/domain", () => mocks.domain);
vi.mock("@/lib/social-oauth", () => mocks.socialOAuth);
vi.mock("@/lib/vault", () => mocks.vault);
vi.mock("./identity-setup-record", () => ({
	getOrCreateEnterpriseIdentitySetupRecord: mocks.getOrCreateSetupRecord,
}));

const actions = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

const setupRecord = {
	organizationId: "org-1",
	preset: "generic",
	protocol: "saml",
	providerId: "acme-okta",
	domain: "example.com",
	domainVerified: false,
	currentStep: "sso",
	ssoTest: null,
	scim: null,
	enforcement: null,
	activatedAt: null,
	defaultRoleTemplateId: null,
};

const socialConfig = {
	id: "cfg-1",
	organizationId: "org-1",
	provider: "google",
	clientId: "client-id",
	providerConfig: null,
	isActive: true,
	lastTestAt: null,
	lastTestSuccess: null,
	lastTestError: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const domainId = "6f1c7a1e-0d7b-4b1a-9c55-2f4f0b6a1d11";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.getOrCreateSetupRecord.mockResolvedValue(setupRecord);
	mocks.updateReturning.mockResolvedValue([setupRecord]);
	mocks.sso.registerSsoProvider.mockResolvedValue({});
	mocks.sso.listSsoProviders.mockResolvedValue([]);
	mocks.vault.deleteOrgSecret.mockResolvedValue(undefined);
});

const calls = [
	["getEnterpriseIdentitySetupAction", () => actions.getEnterpriseIdentitySetupAction()],
	[
		"updateEnterpriseIdentityProviderAction",
		() =>
			actions.updateEnterpriseIdentityProviderAction({
				preset: "generic",
				protocol: "saml",
				providerId: "acme",
				domain: "example.com",
			}),
	],
	[
		"registerEnterpriseIdentitySSOProviderAction",
		() =>
			actions.registerEnterpriseIdentitySSOProviderAction({
				protocol: "saml",
				providerId: "acme",
				issuer: "https://sp.example.com",
				domain: "example.com",
				metadata: "<EntityDescriptor />",
			}),
	],
	[
		"recordEnterpriseIdentitySsoTestAction",
		() =>
			actions.recordEnterpriseIdentitySsoTestAction({
				providerId: "acme",
				testEmail: "a@example.com",
				status: "passed",
			}),
	],
	[
		"refreshEnterpriseIdentityDomainStatusAction",
		() => actions.refreshEnterpriseIdentityDomainStatusAction(),
	],
	[
		"updateEnterpriseIdentityAccessPolicyAction",
		() =>
			actions.updateEnterpriseIdentityAccessPolicyAction({
				ssoRequired: true,
				domainRestrictionEnabled: false,
				inviteRestrictionEnabled: false,
			}),
	],
	["activateEnterpriseIdentitySetupAction", () => actions.activateEnterpriseIdentitySetupAction()],
	["listDomainsAction", () => actions.listDomainsAction()],
	["addDomainAction", () => actions.addDomainAction({ domain: "example.com" })],
	["verifyDomainAction", () => actions.verifyDomainAction({ domainId })],
	[
		"regenerateVerificationTokenAction",
		() => actions.regenerateVerificationTokenAction({ domainId }),
	],
	[
		"updateDomainAuthConfigAction",
		() =>
			actions.updateDomainAuthConfigAction({
				domainId,
				config: {
					emailPasswordEnabled: true,
					socialProvidersEnabled: [],
					ssoEnabled: false,
					passkeyEnabled: true,
				},
			}),
	],
	["deleteDomainAction", () => actions.deleteDomainAction({ domainId })],
	["listSSOProvidersAction", () => actions.listSSOProvidersAction()],
	[
		"registerSSOProviderAction",
		() =>
			actions.registerSSOProviderAction({
				providerId: "acme",
				issuer: "https://idp.example.com",
				domain: "example.com",
				clientId: "id",
				clientSecret: "secret",
			}),
	],
	["deleteSSOProviderAction", () => actions.deleteSSOProviderAction({ providerId: "acme" })],
	[
		"requestSSODomainVerificationAction",
		() => actions.requestSSODomainVerificationAction({ providerId: "acme" }),
	],
	["verifySSODomainAction", () => actions.verifySSODomainAction({ providerId: "acme" })],
	["getBrandingAction", () => actions.getBrandingAction()],
	["updateBrandingAction", () => actions.updateBrandingAction({ appName: "Acme" })],
	["listSocialOAuthConfigsAction", () => actions.listSocialOAuthConfigsAction()],
	[
		"addSocialOAuthConfigAction",
		() =>
			actions.addSocialOAuthConfigAction({
				provider: "google",
				clientId: "id",
				clientSecret: "secret",
			}),
	],
	[
		"updateSocialOAuthConfigAction",
		() => actions.updateSocialOAuthConfigAction({ configId: "cfg-1", isActive: false }),
	],
	[
		"deleteSocialOAuthConfigAction",
		() => actions.deleteSocialOAuthConfigAction({ configId: "cfg-1" }),
	],
	[
		"checkSocialOAuthConfigurationAction",
		() => actions.checkSocialOAuthConfigurationAction({ configId: "cfg-1" }),
	],
	["getConfiguredSocialProvidersAction", () => actions.getConfiguredSocialProvidersAction()],
	["storeTurnstileSecretAction", () => actions.storeTurnstileSecretAction({ secretKey: "s" })],
] as const;

function expectNothingTouched() {
	for (const group of [mocks.sso, mocks.domain, mocks.socialOAuth, mocks.vault]) {
		for (const fn of Object.values(group)) expect(fn).not.toHaveBeenCalled();
	}
	expect(mocks.getOrCreateSetupRecord).not.toHaveBeenCalled();
	expect(mocks.domainFindFirst).not.toHaveBeenCalled();
}

describe("enterprise settings actions", () => {
	it("exports no access guard", () => {
		expect(actions).not.toHaveProperty("requireEnterpriseOrgAdmin");
		expect(actions).not.toHaveProperty("getOrCreateEnterpriseIdentitySetupRecord");
	});

	it.each(calls)("%s refuses a scoped manager before any work", async (_name, call) => {
		mocks.caller = scopedManager;

		await expect(call()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expectNothingTouched();
	});

	it("registers SAML metadata in Better Auth 1.7's IdP metadata envelope for the session's organization", async () => {
		const result = await actions.registerEnterpriseIdentitySSOProviderAction({
			protocol: "saml",
			providerId: "acme-okta",
			issuer: "https://sp.example.com",
			domain: "Example.com",
			metadata: "<EntityDescriptor />",
		});

		expect(result.success).toBe(true);
		expect(mocks.sso.registerSsoProvider).toHaveBeenCalledWith({
			providerId: "acme-okta",
			issuer: "https://sp.example.com",
			domain: "example.com",
			organizationId: "org-1",
			samlConfig: { idpMetadata: { metadata: "<EntityDescriptor />" } },
		});
	});

	it("refuses blank SAML metadata before calling Better Auth", async () => {
		await expect(
			actions.registerEnterpriseIdentitySSOProviderAction({
				protocol: "saml",
				providerId: "acme-okta",
				issuer: "https://sp.example.com",
				domain: "example.com",
				metadata: "   ",
			}),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "SAML metadata is required",
		});
		expect(mocks.sso.registerSsoProvider).not.toHaveBeenCalled();
	});

	it("removes the stored OIDC secret and maps the Better Auth error when registration fails", async () => {
		mocks.sso.registerSsoProvider.mockRejectedValue(new Error("boom"));

		const result = await actions.registerEnterpriseIdentitySSOProviderAction({
			protocol: "oidc",
			providerId: "acme",
			issuer: "https://idp.example.com",
			domain: "example.com",
			clientId: "id",
			clientSecret: "secret",
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.vault.deleteOrgSecret).toHaveBeenCalledWith("org-1", "sso/acme/client_secret");
	});

	it("treats a domain of another organization as not found", async () => {
		mocks.domainFindFirst.mockResolvedValue(undefined);

		await expect(actions.deleteDomainAction({ domainId })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(mocks.domain.deleteCustomDomain).not.toHaveBeenCalled();
	});

	it("verifies a domain of the session's organization", async () => {
		mocks.domainFindFirst.mockResolvedValue({ id: domainId, organizationId: "org-1" });
		mocks.domain.verifyDomainOwnership.mockResolvedValue(true);

		await expect(actions.verifyDomainAction({ domainId })).resolves.toEqual({
			success: true,
			data: true,
		});
		expect(mocks.domain.verifyDomainOwnership).toHaveBeenCalledWith(domainId);
	});

	it("refuses an SSO provider of another organization", async () => {
		mocks.sso.listSsoProviders.mockResolvedValue([
			{ providerId: "acme", organizationId: "org-2", domain: "example.com" },
		]);

		await expect(actions.deleteSSOProviderAction({ providerId: "acme" })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(mocks.sso.deleteSsoProvider).not.toHaveBeenCalled();
	});

	it("updates a social OAuth config of the session's organization", async () => {
		mocks.socialOAuth.updateSocialOAuthConfig.mockResolvedValue(socialConfig);

		const result = await actions.updateSocialOAuthConfigAction({
			configId: "cfg-1",
			clientId: "client-id",
			isActive: true,
		});

		expect(result).toMatchObject({
			success: true,
			data: { id: "cfg-1", hasProviderConfig: false },
		});
		expect(mocks.socialOAuth.updateSocialOAuthConfig).toHaveBeenCalledWith("cfg-1", "org-1", {
			clientId: "client-id",
			clientSecret: undefined,
			providerConfig: undefined,
			isActive: true,
		});
	});

	it("checks social OAuth readiness without revalidating", async () => {
		const check = { success: true, status: "ready" };
		mocks.socialOAuth.checkSocialOAuthConfiguration.mockResolvedValue(check);

		await expect(
			actions.checkSocialOAuthConfigurationAction({ configId: "cfg-4" }),
		).resolves.toEqual({ success: true, data: check });
		expect(mocks.socialOAuth.checkSocialOAuthConfiguration).toHaveBeenCalledWith("cfg-4", "org-1");
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("keeps the response free of a SCIM connection", async () => {
		const result = await actions.getEnterpriseIdentitySetupAction();

		expect(result).toMatchObject({ success: true, data: { scimConnection: null } });
		expect(mocks.getOrCreateSetupRecord).toHaveBeenCalledWith("org-1", "user-1");
	});
});
