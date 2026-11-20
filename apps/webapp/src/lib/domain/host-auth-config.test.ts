import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const { defaultPlatformAuthConfig, parseStoredAuthConfig, withUsableSsoProvider } =
	await import("./host-auth-config");
const { filterOfferedSocialProviders, isRegistrationEnabled } = await import("./types");

const ENTRA_ONLY = {
	emailPasswordEnabled: false,
	socialProvidersEnabled: [],
	ssoEnabled: true,
	passkeyEnabled: false,
	registrationEnabled: false,
};

describe("host sign-in methods (#1885)", () => {
	it("reads a stored JSON config and keeps registration open for configs saved before the flag", () => {
		expect(
			parseStoredAuthConfig(
				'{"emailPasswordEnabled":true,"socialProvidersEnabled":["google"],"ssoEnabled":false,"passkeyEnabled":true}',
			),
		).toEqual({
			emailPasswordEnabled: true,
			socialProvidersEnabled: ["google"],
			ssoEnabled: false,
			passkeyEnabled: true,
			registrationEnabled: true,
		});
		expect(parseStoredAuthConfig(ENTRA_ONLY)).toEqual(ENTRA_ONLY);
		expect(parseStoredAuthConfig("not json")).toBeNull();
		expect(parseStoredAuthConfig(null)).toBeNull();
	});

	it("points SSO at a usable provider and turns it off without one", () => {
		expect(withUsableSsoProvider(ENTRA_ONLY, ["entra-acme"])).toEqual({
			...ENTRA_ONLY,
			ssoProviderId: "entra-acme",
		});
		expect(
			withUsableSsoProvider({ ...ENTRA_ONLY, ssoProviderId: "okta-acme" }, [
				"entra-acme",
				"okta-acme",
			]).ssoProviderId,
		).toBe("okta-acme");
		// A provider that is gone or unverified is replaced, never offered.
		expect(
			withUsableSsoProvider({ ...ENTRA_ONLY, ssoProviderId: "deleted" }, ["entra-acme"])
				.ssoProviderId,
		).toBe("entra-acme");
		expect(withUsableSsoProvider({ ...ENTRA_ONLY, ssoProviderId: "deleted" }, [])).toEqual({
			...ENTRA_ONLY,
			ssoEnabled: false,
		});
		expect(withUsableSsoProvider({ ...ENTRA_ONLY, ssoEnabled: false }, ["entra-acme"])).toEqual({
			...ENTRA_ONLY,
			ssoEnabled: false,
		});
	});

	it("offers SSO on the canonical domain by default once a provider is verified", () => {
		expect(withUsableSsoProvider(defaultPlatformAuthConfig(), ["entra-acme"])).toMatchObject({
			emailPasswordEnabled: true,
			ssoEnabled: true,
			ssoProviderId: "entra-acme",
			passkeyEnabled: true,
			registrationEnabled: true,
		});
	});

	it("offers only the social providers a host lists", () => {
		const configured = [{ id: "google" }, { id: "github" }];
		expect(filterOfferedSocialProviders({ socialProvidersEnabled: [] }, configured)).toEqual([]);
		expect(
			filterOfferedSocialProviders({ socialProvidersEnabled: ["github"] }, configured),
		).toEqual([{ id: "github" }]);
		expect(filterOfferedSocialProviders(null, configured)).toEqual(configured);
	});

	it("treats a missing registration flag as open", () => {
		expect(isRegistrationEnabled({})).toBe(true);
		expect(isRegistrationEnabled(null)).toBe(true);
		expect(isRegistrationEnabled({ registrationEnabled: false })).toBe(false);
	});
});
