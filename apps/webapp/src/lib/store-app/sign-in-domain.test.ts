import { describe, expect, it } from "vitest";
import { organizationsOfEmailDomain, selectStoreAppSignInDomain } from "./sign-in-domain";

const acmeCustomDomain = { organizationId: "org-acme", domain: "time.acme.example" };

describe("organizations of an email domain", () => {
	it("finds the organization with a custom sign-in domain under the email's domain", () => {
		expect(
			organizationsOfEmailDomain("acme.example", {
				customDomains: [acmeCustomDomain],
				ssoProviders: [],
			}),
		).toEqual(new Set(["org-acme"]));
	});

	it("finds the organization with a custom sign-in domain equal to the email's domain", () => {
		expect(
			organizationsOfEmailDomain("acme.example", {
				customDomains: [{ organizationId: "org-acme", domain: "Acme.Example" }],
				ssoProviders: [],
			}),
		).toEqual(new Set(["org-acme"]));
	});

	it("finds the organization whose verified SSO domain matches the email", () => {
		expect(
			organizationsOfEmailDomain("acme.example", {
				customDomains: [],
				ssoProviders: [
					{ organizationId: "org-acme", domain: "acme.example" },
					{ organizationId: null, domain: "acme.example" },
				],
			}),
		).toEqual(new Set(["org-acme"]));
	});

	it.each([
		["a lookalike domain", "time.notacme.example"],
		["a domain that only starts with the email's domain", "acme.example.attacker.example"],
	])("ignores %s", (_case, domain) => {
		expect(
			organizationsOfEmailDomain("acme.example", {
				customDomains: [{ organizationId: "org-other", domain }],
				ssoProviders: [{ organizationId: "org-other", domain: "other.example" }],
			}),
		).toEqual(new Set());
	});
});

describe("store app sign-in domain", () => {
	it("starts on the one verified custom domain of the one matching organization", () => {
		expect(
			selectStoreAppSignInDomain(new Set(["org-acme"]), [
				{ organizationId: "org-acme", domain: "Zeit.Acme-Gruppe.Example" },
				{ organizationId: "org-other", domain: "time.other.example" },
			]),
		).toBe("zeit.acme-gruppe.example");
	});

	it("uses the main origin when the email's domain points at more than one organization", () => {
		expect(
			selectStoreAppSignInDomain(new Set(["org-acme", "org-other"]), [acmeCustomDomain]),
		).toBeNull();
	});

	it("uses the main origin when no organization matches", () => {
		expect(selectStoreAppSignInDomain(new Set(), [acmeCustomDomain])).toBeNull();
	});

	it("uses the main origin when the organization has no or several verified custom domains", () => {
		expect(selectStoreAppSignInDomain(new Set(["org-acme"]), [])).toBeNull();
		expect(
			selectStoreAppSignInDomain(new Set(["org-acme"]), [
				acmeCustomDomain,
				{ organizationId: "org-acme", domain: "login.acme.example" },
			]),
		).toBeNull();
	});
});
