import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { getSSOTrustedOrigins } from "./auth";

const productionSourceRoot = join(process.cwd(), "src");
const scimCredentialTokenFlowPaths = {
	controlPlane: "lib/scim/managed-control-plane.ts",
	actions: "app/[locale]/(app)/settings/enterprise/scim-actions.ts",
	controller:
		"components/settings/enterprise/scim/use-scim-admin-controller.ts",
	step: "components/settings/enterprise/scim/scim-step.tsx",
} as const;

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

function readScimCredentialTokenFlowSources() {
	return Object.fromEntries(
		Object.entries(scimCredentialTokenFlowPaths).map(([name, path]) => [
			name,
			readFileSync(join(productionSourceRoot, path), "utf8"),
		]),
	) as Record<keyof typeof scimCredentialTokenFlowPaths, string>;
}

function assertScimCredentialTokenFlow(
	sources: Record<keyof typeof scimCredentialTokenFlowPaths, string>,
) {
	const normalize = (source: string) => source.replace(/\s+/g, " ").trim();
	const rawTokenAccesses = (source: string) =>
		[
			...source.matchAll(/\b[$\w]+\s*\.\s*token\b|\[\s*["']token["']\s*\]/g),
		].map((match) => match[0].replace(/\s+/g, ""));
	const requireShape = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};

	const controlPlane = normalize(sources.controlPlane);
	requireShape(
		JSON.stringify(rawTokenAccesses(controlPlane)) ===
			JSON.stringify(["created.token", "result.token"]),
		"Unexpected raw token access in the managed control plane",
	);
	requireShape(
		/return \{ connection: toConnectionDTO\(created\.connection\), credential: toCredentialDTO\(created\.credential\), token: created\.token,? \};/.test(
			controlPlane,
		),
		"The create token must only be returned by the managed issue DTO",
	);
	requireShape(
		/return \{ connection: toConnectionDTO\(result\.connection\), credential: toCredentialDTO\(result\.credential\), token: result\.token,? \};/.test(
			controlPlane,
		),
		"The rotate token must only be returned by the managed issue DTO",
	);

	const actions = normalize(sources.actions);
	requireShape(
		rawTokenAccesses(actions).length === 0,
		"Unexpected raw token access in SCIM actions",
	);
	for (const name of [
		"createEnterpriseIdentityScimConnectionAction",
		"rotateEnterpriseIdentityScimCredentialAction",
	]) {
		const start = actions.indexOf(`export async function ${name}`);
		const next = actions.indexOf("export async function", start + 1);
		const action = actions.slice(start, next === -1 ? undefined : next);
		requireShape(
			action.startsWith(`export async function ${name}`),
			"Missing managed action",
		);
		requireShape(
			/return result;/.test(action),
			"Actions must directly return the managed result",
		);
		requireShape(
			!/return \{/.test(action),
			"Actions must not add status, event, cache, or token fields",
		);
	}

	const controller = normalize(sources.controller);
	requireShape(
		!/[{,]\s*token\s*(?::|[,}])/.test(controller),
		"Controller must not destructure or alias the token",
	);
	requireShape(
		JSON.stringify(rawTokenAccesses(controller)) ===
			JSON.stringify(["result.token", "result.token"]),
		"Unexpected raw token access in the controller",
	);
	requireShape(
		/const create =.*await createEnterpriseIdentityScimConnectionAction\([^)]*\).*if \("token" in result\) setCredential\(result\.token \?\? null\);/.test(
			controller,
		),
		"Create must transfer the managed result token directly to transient credential state",
	);
	requireShape(
		/const rotate =.*await rotateEnterpriseIdentityScimCredentialAction\(connectionId\); setCredential\(result\.token \?\? null\);/.test(
			controller,
		),
		"Rotate must transfer the managed result token directly to transient credential state",
	);

	const step = normalize(sources.step);
	const controllerCredentialAccesses =
		step.match(/controller\.credential/g) ?? [];
	requireShape(
		controllerCredentialAccesses.length === 2,
		"Credential state may only flow to the one-time dialog",
	);
	requireShape(
		/<ScimOneTimeCredentialDialog credential=\{controller\.credential\} open=\{controller\.credential !== null\} onClosed=\{controller\.clearCredential\} \/>/.test(
			step,
		),
		"Credential state must only be passed to the one-time dialog",
	);
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
		const sources = readScimCredentialTokenFlowSources();
		assertScimCredentialTokenFlow(sources);

		const mutate = (key: keyof typeof sources, from: string, to: string) => ({
			...sources,
			[key]: sources[key].replace(from, to),
		});
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"controlPlane",
					"return {\n\t\t\tconnection: toConnectionDTO(created.connection),",
					"logger.info({ token: created.token });\n\t\treturn {\n\t\t\tconnection: toConnectionDTO(created.connection),",
				),
			),
		).toThrow(/raw token access/i);
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"controller",
					"setCredential(result.token ?? null)",
					"const { token } = result; setCredential(token ?? null)",
				),
			),
		).toThrow(/destructure or alias/i);
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"actions",
					"return result;",
					'return { ...result, status: "active" };',
				),
			),
		).toThrow(/managed result/i);
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"controller",
					"await createEnterpriseIdentityScimConnectionAction(",
					"await getEnterpriseIdentityScimStatusAction(",
				),
			),
		).toThrow(/Create must transfer/i);
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"step",
					"credential={controller.credential}",
					"credential={controller.credential} cacheKey={controller.credential}",
				),
			),
		).toThrow(/one-time dialog/i);
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
