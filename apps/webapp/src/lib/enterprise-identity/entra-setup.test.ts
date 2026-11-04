import { describe, expect, it } from "vitest";
import { getEntraIssuer, getOidcCallbackUrl } from "./entra-setup";

describe("Entra setup values", () => {
	it("uses a concrete directory ID and rejects placeholders or injected URL paths", () => {
		expect(getEntraIssuer("AABBCCDD-2222-3333-4444-555555555555")).toBe(
			"https://login.microsoftonline.com/aabbccdd-2222-3333-4444-555555555555/v2.0",
		);
		expect(getEntraIssuer(" 11111111-2222-3333-4444-555555555555 ")).toBe(
			"https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
		);
		for (const tenant of [
			"",
			"common",
			"organizations",
			"{tenant-id}",
			"tenant.example.com",
			"../common",
			"https://attacker.test",
		]) {
			expect(getEntraIssuer(tenant)).toBeNull();
		}
	});
	it("uses the supplied organization origin for the configured shared callback", () => {
		expect(getOidcCallbackUrl("https://organization.z8.test/")).toBe(
			"https://organization.z8.test/api/auth/sso/callback",
		);
	});
});
