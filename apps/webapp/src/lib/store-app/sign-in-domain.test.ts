import { describe, expect, it } from "vitest";
import { selectStoreAppSignInDomain } from "./sign-in-domain";

const acmeCustomDomain = { organizationId: "org-acme", domain: "time.acme.example" };

describe("store app sign-in domain", () => {
	it("starts on the custom sign-in domain that sits under the email's domain", () => {
		expect(
			selectStoreAppSignInDomain("Ada@Acme.Example", {
				customDomains: [acmeCustomDomain],
				ssoProviders: [],
			}),
		).toBe("time.acme.example");
	});

	it("starts on a custom sign-in domain equal to the email's domain", () => {
		expect(
			selectStoreAppSignInDomain("ada@acme.example", {
				customDomains: [{ organizationId: "org-acme", domain: "acme.example" }],
				ssoProviders: [],
			}),
		).toBe("acme.example");
	});

	it("follows the organization whose verified SSO domain matches the email", () => {
		expect(
			selectStoreAppSignInDomain("ada@acme.example", {
				customDomains: [{ organizationId: "org-acme", domain: "zeit.acme-gruppe.example" }],
				ssoProviders: [{ organizationId: "org-acme", domain: "acme.example" }],
			}),
		).toBe("zeit.acme-gruppe.example");
	});

	it.each([
		["a lookalike domain", "time.notacme.example"],
		["a domain that only starts with the email's domain", "acme.example.attacker.example"],
	])("ignores %s", (_case, domain) => {
		expect(
			selectStoreAppSignInDomain("ada@acme.example", {
				customDomains: [{ organizationId: "org-other", domain }],
				ssoProviders: [],
			}),
		).toBeNull();
	});

	it("uses the main origin when the email's domain points at more than one organization", () => {
		expect(
			selectStoreAppSignInDomain("ada@acme.example", {
				customDomains: [acmeCustomDomain],
				ssoProviders: [{ organizationId: "org-other", domain: "acme.example" }],
			}),
		).toBeNull();
	});

	it("uses the main origin when the matching organization has no verified custom domain", () => {
		expect(
			selectStoreAppSignInDomain("ada@acme.example", {
				customDomains: [{ organizationId: "org-other", domain: "time.other.example" }],
				ssoProviders: [{ organizationId: "org-acme", domain: "acme.example" }],
			}),
		).toBeNull();
	});

	it.each(["not-an-email", "ada@", "@acme.example", "ada@acme.example/path"])(
		"uses the main origin for %j",
		(email) => {
			expect(
				selectStoreAppSignInDomain(email, {
					customDomains: [acmeCustomDomain],
					ssoProviders: [],
				}),
			).toBeNull();
		},
	);
});
