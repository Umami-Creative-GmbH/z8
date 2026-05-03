import { describe, expect, it } from "vitest";
import { isEmailInEnterpriseIdentityDomain } from "./enforcement";

describe("enterprise identity enforcement helpers", () => {
	it("accepts email addresses exactly in the configured domain", () => {
		expect(isEmailInEnterpriseIdentityDomain("Employee@Example.com", "example.com")).toBe(true);
	});

	it("rejects subdomains and unrelated domains", () => {
		expect(isEmailInEnterpriseIdentityDomain("employee@team.example.com", "example.com")).toBe(false);
		expect(isEmailInEnterpriseIdentityDomain("employee@example.co", "example.com")).toBe(false);
	});

	it("rejects malformed email and domain values", () => {
		expect(isEmailInEnterpriseIdentityDomain("not-an-email", "example.com")).toBe(false);
		expect(isEmailInEnterpriseIdentityDomain("employee@example.com", "")).toBe(false);
	});
});
