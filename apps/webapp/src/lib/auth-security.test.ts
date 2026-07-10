import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSCIMAdministrator, getSSOTrustedOrigins } from "./auth";

describe("SSO trusted origins", () => {
	it("does not trust an issuer supplied by the SSO registration request", async () => {
		const origins = await getSSOTrustedOrigins(
			new Request("https://ui.z8-time.app/api/auth/sso/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ issuer: "http://169.254.169.254/latest/meta-data" }),
			}),
			"/api/auth",
			{
				loadConfiguredOrigins: () => ["https://accounts.google.com"],
			},
		);

		expect(origins).toContain("https://accounts.google.com");
		expect(origins).not.toContain("http://169.254.169.254");
	});

	it("does not derive operator trust from tenant-owned provider rows", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const trustedOriginsSource = source.slice(
			source.indexOf("export async function getSSOTrustedOrigins"),
			source.indexOf("export function assertSCIMAdministrator"),
		);

		expect(trustedOriginsSource).not.toContain("ssoProvider.findMany");
	});
});

describe("SCIM administrator policy", () => {
	it("rejects personal and non-admin SCIM token generation", () => {
		expect(() => assertSCIMAdministrator(null)).toThrow(
			"Only organization admins can generate SCIM tokens",
		);
		expect(() => assertSCIMAdministrator({ role: "member" })).toThrow(
			"Only organization admins can generate SCIM tokens",
		);
		expect(() => assertSCIMAdministrator({ role: "admin" })).not.toThrow();
		expect(() => assertSCIMAdministrator({ role: "owner" })).not.toThrow();
		expect(() => assertSCIMAdministrator({ role: "member,admin" })).not.toThrow();
		expect(() => assertSCIMAdministrator({ role: "owner,member" })).not.toThrow();
	});

	it("rejects unauthorized generation before Better Auth rotates an existing token", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const scimConfig = source.slice(source.indexOf("scim({"), source.indexOf("nextCookies()"));

		expect(scimConfig).toContain("canGenerateToken");
		expect(scimConfig).toContain("assertSCIMAdministrator(member)");
	});
});
