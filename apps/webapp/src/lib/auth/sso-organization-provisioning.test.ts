import { describe, expect, it } from "vitest";
import {
	ssoMemberRole,
	verifiedEmailDomain,
	verifiedProviderDomainMatches,
} from "./sso-organization-provisioning";

describe("ssoMemberRole", () => {
	it.each([
		[{ attributes: { role: "admin" } }, "admin"],
		[{ attributes: { role: "manager" } }, "admin"],
		[{ attributes: { role: "owner" } }, "member"],
		[{ attributes: {} }, "member"],
		[{}, "member"],
		[undefined, "member"],
	])("maps provider attributes %j to organization role %s", (userInfo, role) => {
		expect(ssoMemberRole(userInfo)).toBe(role);
	});
});

describe("verifiedEmailDomain", () => {
	it.each([
		["Person@Example.COM", "example.com"],
		["  person@sub.example.com ", "sub.example.com"],
		["person@example.com/path", null],
		["person@example.com:443", null],
		["a@b@example.com", null],
		["@example.com", null],
		["person@", null],
	])("reads the domain of %s as %s", (email, domain) => {
		expect(verifiedEmailDomain(email)).toBe(domain);
	});
});

describe("verifiedProviderDomainMatches", () => {
	it.each([
		["example.com", "example.com", true],
		["sub.example.com", "example.com", true],
		["notexample.com", "example.com", false],
		["example.com", "other.test, Example.com", true],
		["example.com", "https://example.com/sso", true],
		["example.com", " , ", false],
		["example.com", "exa mple.com", false],
	])("matches %s against provider domains %s: %s", (domain, providerDomains, matches) => {
		expect(verifiedProviderDomainMatches(domain, providerDomains)).toBe(matches);
	});
});
