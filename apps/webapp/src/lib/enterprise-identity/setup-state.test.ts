import { describe, expect, it } from "vitest";
import {
	ENTERPRISE_IDENTITY_PROVIDER_PRESETS,
	getEnterpriseIdentityPreset,
} from "./provider-presets";
import {
	createDefaultEnterpriseIdentitySetupState,
	getEnterpriseIdentityReadiness,
	mapBetterAuthIdentityError,
	validateEnterpriseIdentityProviderInput,
} from "./setup-state";

describe("enterprise identity setup helpers", () => {
	it("defines the supported provider presets", () => {
		expect(Object.keys(ENTERPRISE_IDENTITY_PROVIDER_PRESETS)).toEqual([
			"okta",
			"microsoft-entra",
			"google-workspace",
			"generic",
		]);
		expect(getEnterpriseIdentityPreset("okta")?.supportedProtocols).toContain("oidc");
		expect(getEnterpriseIdentityPreset("generic")?.supportedProtocols).toEqual(["oidc", "saml"]);
	});

	it("creates conservative default setup state", () => {
		const state = createDefaultEnterpriseIdentitySetupState({ organizationId: "org_1" });

		expect(state.organizationId).toBe("org_1");
		expect(state.currentStep).toBe("provider");
		expect(state.enforcement.ssoRequired).toBe(false);
		expect(state.enforcement.domainRestrictionEnabled).toBe(false);
		expect(state.enforcement.inviteRestrictionEnabled).toBe(false);
		expect("defaultRoleTemplateId" in state.enforcement).toBe(false);
		expect(state.scim.enabled).toBe(false);
	});

	it("requires verified domain and passing SSO test before activation readiness", () => {
		const state = createDefaultEnterpriseIdentitySetupState({ organizationId: "org_1" });

		expect(getEnterpriseIdentityReadiness(state)).toMatchObject({
			canActivate: false,
			missing: ["provider", "domain", "ssoTest"],
		});

		const ready = getEnterpriseIdentityReadiness({
			...state,
			provider: { preset: "okta", protocol: "oidc", providerId: "acme-okta" },
			domain: { domain: "acme.test", verified: true },
			ssoTest: {
				status: "passed",
				testEmail: "admin@acme.test",
				providerId: "acme-okta",
				checkedAt: "2026-05-03T10:00:00.000Z",
				error: null,
			},
		});

		expect(ready).toEqual({ canActivate: true, missing: [] });
	});

	it("requires the passing SSO test to match the current provider", () => {
		const state = createDefaultEnterpriseIdentitySetupState({ organizationId: "org_1" });

		const readiness = getEnterpriseIdentityReadiness({
			...state,
			provider: { preset: "okta", protocol: "oidc", providerId: "new-okta" },
			domain: { domain: "acme.test", verified: true },
			ssoTest: {
				status: "passed",
				testEmail: "admin@acme.test",
				providerId: "old-okta",
				checkedAt: "2026-05-03T10:00:00.000Z",
				error: null,
			},
		});

		expect(readiness).toEqual({ canActivate: false, missing: ["ssoTest"] });
	});

	it("maps Better Auth setup errors to actionable copy", () => {
		expect(mapBetterAuthIdentityError({ code: "discovery_untrusted_origin" })).toBe(
			"The identity provider origin is not trusted by the auth server. Check the issuer URL and trusted origin configuration.",
		);
		expect(mapBetterAuthIdentityError({ code: "unsupported_token_auth_method" })).toBe(
			"The identity provider only advertises an unsupported token authentication method. Use client_secret_basic or client_secret_post.",
		);
		expect(mapBetterAuthIdentityError(new Error("metadata failed"))).toBe("metadata failed");
	});
});

describe("enterprise identity validation", () => {
	it("rejects invalid provider IDs and domains", () => {
		expect(
			validateEnterpriseIdentityProviderInput({ providerId: "Bad ID", domain: "acme.com" }),
		).toEqual("Provider ID must contain only lowercase letters, numbers, and hyphens");
		for (const providerId of ["-", "--", "acme-", "-okta"]) {
			expect(validateEnterpriseIdentityProviderInput({ providerId, domain: "acme.com" })).toEqual(
				"Provider ID must contain only lowercase letters, numbers, and hyphens",
			);
		}
		expect(
			validateEnterpriseIdentityProviderInput({ providerId: "acme-okta", domain: "not a domain" }),
		).toEqual("Enter a valid email domain such as example.com");
		for (const providerId of ["a", "acme", "acme-okta", "acme-123"]) {
			expect(validateEnterpriseIdentityProviderInput({ providerId, domain: "acme.com" })).toBeNull();
		}
		expect(
			validateEnterpriseIdentityProviderInput({ providerId: "acme-okta", domain: "acme.com" }),
		).toBeNull();
	});
});
