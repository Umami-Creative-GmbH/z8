import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSSOTrustedOrigins } from "./auth";

describe("SSO trusted origins", () => {
	it("does not trust an issuer supplied by the SSO registration request", async () => {
		const origins = await getSSOTrustedOrigins(
			new Request("https://ui.z8-time.app/api/auth/sso/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					issuer: "http://169.254.169.254/latest/meta-data",
				}),
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
			source.indexOf("async function getUserPrimaryOrganizationId"),
		);

		expect(trustedOriginsSource).not.toContain("ssoProvider.findMany");
	});
});

describe("Better Auth 1.7 core configuration", () => {
	it("removes the incompatible SCIM plugin", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");

		expect(source).not.toContain('from "@better-auth/scim"');
		expect(source).not.toMatch(/\bscim\s*\(\s*\{/);
	});

	it("enables joins in advanced database without trusting proxy headers", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");

		expect(source).toMatch(
			/advanced:\s*\{\s*database:\s*\{\s*joins:\s*true,?\s*\},\s*ipAddress:\s*\{\s*ipv6Subnet:\s*64,?\s*\},?\s*\}/,
		);
		expect(source).not.toMatch(/experimental:\s*\{[\s\S]*?joins:/);
		expect(source).not.toContain("trustedProxyHeaders");
	});

	it("retains the legacy SCIM provider physical table as application-owned schema", () => {
		const source = readFileSync(
			join(process.cwd(), "src/db/schema/scim.ts"),
			"utf8",
		);
		const tableSource = source.slice(
			source.indexOf("export const legacyScimProvider"),
			source.indexOf("export const scimProviderConfig"),
		);

		expect(tableSource).toContain('pgTable("scim_provider"');
		expect(tableSource).toContain('id: text("id").primaryKey()');
		expect(tableSource).toContain(
			'providerId: text("provider_id").notNull().unique()',
		);
		expect(tableSource).toContain(
			'scimToken: text("scim_token").notNull().unique()',
		);
		expect(tableSource).toContain('organizationId: text("organization_id")');
		expect(tableSource).not.toContain(
			'organizationId: text("organization_id").notNull()',
		);
		expect(
			tableSource.match(/\b(?:id|providerId|scimToken|organizationId):/g),
		).toHaveLength(4);
	});
});
