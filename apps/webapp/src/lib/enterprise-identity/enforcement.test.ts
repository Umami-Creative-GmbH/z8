import { describe, expect, it } from "vitest";
import {
	isEmailInEnterpriseIdentityDomain,
	selectVerifiedEnterpriseIdentityDomain,
} from "./enforcement";

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

	it("selects only the verified organization domain matching the setup domain", () => {
		const domains = [
			{
				id: "domain-1",
				domain: "wrong.example.com",
				domainVerified: true,
				authConfig: { ssoEnabled: false },
			},
			{
				id: "domain-2",
				domain: "Example.com",
				domainVerified: true,
				authConfig: { ssoEnabled: false },
			},
		];

		expect(selectVerifiedEnterpriseIdentityDomain(domains, "example.com")?.id).toBe("domain-2");
	});

	it("does not select an unverified matching organization domain", () => {
		expect(
			selectVerifiedEnterpriseIdentityDomain(
				[
					{
						id: "domain-1",
						domain: "example.com",
						domainVerified: false,
						authConfig: { ssoEnabled: false },
					},
				],
				"example.com",
			),
		).toBeNull();
	});
});
