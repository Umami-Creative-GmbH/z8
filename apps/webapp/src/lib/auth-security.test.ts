import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { getSSOTrustedOrigins } from "./auth";

const productionSourceRoot = join(process.cwd(), "src");
const approvedManagedTokenBoundaries = new Map([
	[
		"lib/scim/managed-control-plane.ts",
		["token: created.token", "token: result.token"],
	],
	[
		"components/settings/enterprise/scim/use-scim-admin-controller.ts",
		["setCredential(result.token ?? null)"],
	],
]);

function productionSourceFiles(directory = productionSourceRoot): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : productionSourceFiles(path);
		}
		if (
			!entry.isFile() ||
			!/[.]tsx?$/.test(entry.name) ||
			/[.](test|spec)[.]tsx?$/.test(entry.name) ||
			path === join(productionSourceRoot, "db/auth-schema.ts")
		) {
			return [];
		}
		return [path];
	});
}

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
	it("keeps legacy SCIM APIs, provider helpers, and token models out of production source", () => {
		const legacyNames = [
			"generateSCIMToken",
			"listSCIMProviderConnections",
			"deleteSCIMProviderConnection",
			"legacyScimProvider",
			"getScimProviderConfig",
			"SCIMProvisioningService",
			"EnterpriseIdentityScimTokenResponse",
			"buildEnterpriseIdentityScimTokenResponse",
			"scimToken",
		];
		const violations = productionSourceFiles().flatMap((path) => {
			const source = readFileSync(path, "utf8");
			const relativePath = relative(productionSourceRoot, path);
			return legacyNames
				.filter((name) => source.includes(name))
				.map((name) => `${relativePath}:${name}`);
		});

		expect(violations).toEqual([]);
		const managedTokenSourceFiles = new Set(
			productionSourceFiles()
				.filter((path) =>
					/\b(?:created|result)\.token\b/.test(readFileSync(path, "utf8")),
				)
				.map((path) => relative(productionSourceRoot, path)),
		);
		expect([...managedTokenSourceFiles].sort()).toEqual(
			[...approvedManagedTokenBoundaries.keys()].sort(),
		);
		for (const [
			path,
			allowedTokenExpressions,
		] of approvedManagedTokenBoundaries) {
			const source = readFileSync(join(productionSourceRoot, path), "utf8");
			for (const expression of allowedTokenExpressions) {
				expect(source).toContain(expression);
			}
		}
	});

	it("registers managed SCIM with native Drizzle transactions and the dedicated secret", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");

		expect(source).toContain(
			"createZ8SCIMPlugin(getSCIMCredentialHashSecret())",
		);
		expect(source).toMatch(
			/drizzleAdapter\(db,\s*\{\s*provider:\s*"pg",\s*schema:\s*authDatabaseSchema,\s*transaction:\s*true,?\s*\}\)/,
		);
		expect(source).toContain(
			"configureSCIMProjectionReplay(createSCIMProjectionReplayLoader(auth.api))",
		);
	});

	it("enables joins in advanced database without trusting proxy headers", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");

		expect(source).toMatch(
			/advanced:\s*\{\s*database:\s*\{\s*joins:\s*true,?\s*\},\s*ipAddress:\s*\{\s*ipv6Subnet:\s*64,?\s*\},?\s*\}/,
		);
		expect(source).not.toMatch(/experimental:\s*\{[\s\S]*?joins:/);
		expect(source).not.toContain("trustedProxyHeaders");
	});

	it("does not retain SCIM provider credentials in application-owned schema", () => {
		const source = readFileSync(
			join(process.cwd(), "src/db/schema/scim.ts"),
			"utf8",
		);

		expect(source).not.toContain("legacyScimProvider");
		expect(source).not.toContain('pgTable("scim_provider"');
		expect(source).not.toContain("providerId");
		expect(source).not.toContain("scimToken");
		expect(source).not.toContain("tokenGenerated");
		expect(source).not.toContain("requestPayload");
	});
});
