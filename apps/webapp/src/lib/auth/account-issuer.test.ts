import { describe, expect, it } from "vitest";
import { getAccountIssuer } from "./account-issuer";

describe("getAccountIssuer", () => {
	it.each([
		["credential", "local:credential"],
		["google", "https://accounts.google.com"],
		["apple", "https://appleid.apple.com"],
		["github", "local:oauth:github"],
		["linkedin", "local:oauth:linkedin"],
	])("returns the Better Auth issuer for %s", (providerId, issuer) => {
		expect(getAccountIssuer(providerId)).toBe(issuer);
	});

	it("rejects an unknown provider", () => {
		expect(() => getAccountIssuer("tenant-oidc")).toThrow(
			"Unknown account provider: tenant-oidc",
		);
	});
});
