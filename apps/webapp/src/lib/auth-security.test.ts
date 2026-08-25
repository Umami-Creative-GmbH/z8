import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { getSSOTrustedOrigins } from "./auth";

const productionSourceRoot = join(process.cwd(), "src");
const babelParse = createRequire(import.meta.url)(
	"next/dist/compiled/babel/parser",
).parse as (
	source: string,
	options: { sourceType: "module"; plugins: string[] },
) => unknown;
const babelTraverse = createRequire(import.meta.url)(
	"next/dist/compiled/babel/traverse",
).default as (
	ast: unknown,
	visitors: Record<string, (path: any) => void>,
) => void;
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

function syntaxIdentifiers(source: string): string[] {
	const identifiers: string[] = [];
	const visit = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		if (
			(value as { type?: string }).type === "Identifier" &&
			typeof (value as { name?: unknown }).name === "string"
		) {
			identifiers.push((value as { name: string }).name);
		}
		if (
			((value as { type?: string }).type === "MemberExpression" ||
				(value as { type?: string }).type === "OptionalMemberExpression") &&
			(value as { computed?: boolean }).computed === true &&
			(value as { property?: { value?: unknown } }).property?.value &&
			typeof (value as { property?: { value?: unknown } }).property?.value ===
				"string"
		)
			identifiers.push(
				(value as { property: { value: string } }).property.value,
			);
		for (const child of Object.values(value)) {
			if (Array.isArray(child)) child.forEach(visit);
			else visit(child);
		}
	};
	visit(
		babelParse(source, {
			sourceType: "module",
			plugins: ["typescript", "jsx"],
		}),
	);
	return identifiers;
}

function assertScimCredentialTokenFlow(
	sources: Record<keyof typeof scimCredentialTokenFlowPaths, string>,
) {
	const parse = (source: string) =>
		babelParse(source, {
			sourceType: "module",
			plugins: ["typescript", "jsx"],
		});
	const memberName = (node: any) =>
		node?.computed
			? node.property?.value
			: (node?.property?.name ?? node?.key?.name ?? node?.key?.value);
	const callName = (node: any) => memberName(node?.callee);
	const unwrap = (path: any): any => {
		while (
			["AwaitExpression", "TSAsExpression", "TSNonNullExpression"].includes(
				path?.node?.type,
			)
		)
			path = path.get("argument") || path.get("expression");
		return path;
	};
	const bindings = (path: any): any[] => {
		if (path.isIdentifier()) return [path.scope.getBinding(path.node.name)];
		return path.getBindingIdentifiers
			? Object.values(path.getBindingIdentifiers())
			: [];
	};

	for (const [sourceName, source] of Object.entries(sources) as [
		keyof typeof sources,
		string,
	][]) {
		const ast = parse(source);
		const tainted = new Set<any>();
		const credentialState = new Set<any>();
		const isProducer = (path: any) => {
			const value = unwrap(path);
			if (!value?.isCallExpression()) return false;
			const name = callName(value.node);
			const enclosingFunction = value.findParent((candidate: any) =>
				candidate.isFunctionDeclaration?.(),
			);
			const functionName = enclosingFunction?.node.id?.name;
			return sourceName === "controlPlane"
				? name === "createSCIMManagedConnection" ||
						name === "rotateSCIMManagedCredential"
				: sourceName === "actions"
					? (name === "create" &&
							functionName ===
								"createEnterpriseIdentityScimConnectionAction") ||
						(name === "rotate" &&
							functionName === "rotateEnterpriseIdentityScimCredentialAction")
					: sourceName === "controller"
						? name === "createEnterpriseIdentityScimConnectionAction" ||
							name === "rotateEnterpriseIdentityScimCredentialAction"
						: false;
		};
		const isTainted = (path: any): boolean => {
			path = unwrap(path);
			if (path?.isIdentifier())
				return tainted.has(path.scope.getBinding(path.node.name));
			if (path?.isMemberExpression() || path?.isOptionalMemberExpression()) {
				const property = memberName(path.node);
				return property === "token" && isTainted(path.get("object"));
			}
			return false;
		};

		let changed = true;
		while (changed) {
			changed = false;
			babelTraverse(ast, {
				VariableDeclarator(path) {
					const init = path.get("init");
					const id = path.get("id");
					if (
						sourceName === "controller" &&
						id.isArrayPattern() &&
						callName(unwrap(init)?.node) === "useState"
					) {
						const [, setter] = id.get("elements");
						if (setter?.node?.name === "setCredential")
							credentialState.add(setter.scope.getBinding(setter.node.name));
					}
					if (isProducer(init) || isTainted(init)) {
						for (const binding of bindings(id)) {
							if (binding && !tainted.has(binding)) {
								tainted.add(binding);
								changed = true;
							}
						}
					}
				},
				AssignmentExpression(path) {
					if (isTainted(path.get("right")) || isProducer(path.get("right"))) {
						for (const binding of bindings(path.get("left"))) {
							if (binding && !tainted.has(binding)) {
								tainted.add(binding);
								changed = true;
							}
						}
					}
				},
			});
		}

		const fails = (message: string) => {
			throw new Error(
				`Managed credential result escapes its approved flow: ${sourceName} (${message})`,
			);
		};
		babelTraverse(ast, {
			AssignmentExpression(path) {
				if (
					(path.get("left").isMemberExpression() ||
						path.get("left").isOptionalMemberExpression()) &&
					isTainted(path.get("right"))
				)
					fails("property assignment");
			},
			SpreadElement(path) {
				if (isTainted(path.get("argument"))) fails("object spread");
			},
			CallExpression(path) {
				if (
					path.get("arguments").some(isTainted) &&
					!credentialState.has(path.scope.getBinding(callName(path.node)))
				)
					fails("function call");
			},
		});
		for (const binding of tainted) {
			for (const reference of binding.referencePaths) {
				const path = reference as any;
				let value = path;
				if (
					path.parentPath?.isMemberExpression() ||
					path.parentPath?.isOptionalMemberExpression()
				) {
					const member = path.parentPath;
					if (
						member.node.object === path.node &&
						memberName(member.node) !== "token"
					)
						continue;
					if (member.node.object === path.node) value = member;
				}
				while (
					value.parentPath?.isLogicalExpression() ||
					value.parentPath?.isTSAsExpression()
				)
					value = value.parentPath;
				const parent = value.parentPath;
				if (
					(parent?.isAssignmentExpression() && parent.get("right") === value) ||
					(parent?.isVariableDeclarator() && parent.get("init") === value)
				)
					continue;
				const isIssueReturn =
					(sourceName === "actions" &&
						parent?.isReturnStatement() &&
						parent.get("argument") === value) ||
					(sourceName === "controlPlane" &&
						value.isMemberExpression?.() &&
						memberName(value.node) === "token" &&
						parent?.isObjectProperty() &&
						memberName(parent.node) === "token" &&
						parent.parentPath?.isObjectExpression() &&
						parent.parentPath.parentPath?.isReturnStatement());
				if (isIssueReturn) continue;
				if (
					value.isMemberExpression?.() &&
					parent?.isBinaryExpression() &&
					parent.node.operator === "in" &&
					memberName(value.node) === "token"
				)
					continue;
				if (
					parent?.isCallExpression() &&
					parent.get("arguments").some((argument: any) => argument === value) &&
					credentialState.has(parent.scope.getBinding(callName(parent.node)))
				)
					continue;
				if (
					parent?.isJSXExpressionContainer() &&
					parent.parentPath?.isJSXAttribute() &&
					parent.parentPath.node.name.name === "token" &&
					parent.parentPath.parentPath?.node.name?.name ===
						"ScimOneTimeCredentialDialog"
				)
					continue;
				fails(`${reference.node.name}:${reference.node.loc?.start.line}`);
			}
		}
		if (sourceName === "step") {
			babelTraverse(ast, {
				MemberExpression(path) {
					if (
						memberName(path.node) !== "credential" ||
						path.get("object").node?.name !== "controller"
					)
						return;
					const parent = path.parentPath;
					const safeDialogToken =
						parent?.isJSXExpressionContainer() &&
						parent.parentPath?.isJSXAttribute() &&
						parent.parentPath.node.name.name === "token" &&
						parent.parentPath.parentPath?.node.name?.name ===
							"ScimOneTimeCredentialDialog";
					const safeOpenCheck =
						parent?.isBinaryExpression() &&
						["===", "!=="].includes(parent.node.operator) &&
						parent.get("right").isNullLiteral();
					if (!safeDialogToken && !safeOpenCheck) fails("credential state");
				},
			});
		}
	}
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
			const identifiers = syntaxIdentifiers(source);
			return legacyNames
				.filter((name) => identifiers.includes(name))
				.map((name) => `${relativePath}:${name}`);
		});

		expect(violations).toEqual([]);
		const sources = readScimCredentialTokenFlowSources();
		assertScimCredentialTokenFlow(sources);

		const mutate = (key: keyof typeof sources, from: string, to: string) => {
			const next = sources[key].replace(from, to);
			if (next === sources[key])
				throw new Error(`Mutation target not found: ${from}`);
			return { ...sources, [key]: next };
		};
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"controlPlane",
					"return {\n\t\t\tconnection: toConnectionDTO(created.connection),",
					"logger.info({ token: created.token });\n\t\treturn {\n\t\t\tconnection: toConnectionDTO(created.connection),",
				),
			),
		).toThrow(/escapes/i);
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"controller",
					'if ("token" in result)',
					'const { token } = result; setCredential(token ?? null); if ("token" in result)',
				),
			),
		).not.toThrow();
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"actions",
					"return result;",
					'return { ...result, status: "active" };',
				),
			),
		).toThrow(/escapes/i);
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"step",
					"token={controller.credential}",
					"token={controller.credential} cacheKey={controller.credential}",
				),
			),
		).toThrow(/escapes/i);
		for (const leak of [
			"telemetry.capture('scim', created.token);",
			"cache.set(key, created.token);",
			"const leaked = { ...created };",
			"setState(created.token);",
			"recipient.token = created.token;",
		]) {
			expect(() =>
				assertScimCredentialTokenFlow(
					mutate(
						"controlPlane",
						"return {\n\t\t\tconnection: toConnectionDTO(created.connection),",
						`${leak}\n\t\treturn {\n\t\t\tconnection: toConnectionDTO(created.connection),`,
					),
				),
			).toThrow(/escapes/i);
		}
		for (const leak of [
			"setCredentialResult(created);",
			"setStatus(created);",
			"publishToChild(created);",
			"return { created };",
		]) {
			expect(() =>
				assertScimCredentialTokenFlow(
					mutate(
						"controlPlane",
						"return {\n\t\t\tconnection: toConnectionDTO(created.connection),",
						`${leak}\n\t\treturn {\n\t\t\tconnection: toConnectionDTO(created.connection),`,
					),
				),
			).toThrow(/escapes/i);
		}
		expect(() =>
			assertScimCredentialTokenFlow(
				mutate(
					"step",
					"<ScimOneTimeCredentialDialog",
					"<CredentialConsumer value={controller.credential} />\n\t\t\t<ScimOneTimeCredentialDialog",
				),
			),
		).toThrow(/escapes/i);
	});

	it("scans legacy SCIM names as syntax rather than comments or string literals", () => {
		expect(
			syntaxIdentifiers(
				'// generateSCIMToken\nconst note = "legacyScimProvider";',
			),
		).not.toContain("generateSCIMToken");
		expect(
			syntaxIdentifiers('import { generateSCIMToken } from "./legacy";'),
		).toContain("generateSCIMToken");
		expect(syntaxIdentifiers("api['generateSCIMToken']()")).toContain(
			"generateSCIMToken",
		);
		expect(syntaxIdentifiers("api?.['generateSCIMToken']()")).toContain(
			"generateSCIMToken",
		);
		expect(syntaxIdentifiers("api?.generateSCIMToken()")).toContain(
			"generateSCIMToken",
		);
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
