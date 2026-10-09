import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaDirectory = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = fileURLToPath(new URL("../../../", import.meta.url));

// The same conservative scan as docker/scripts/prepare-target-runtime.mjs: the
// migration and db-seed images trace the schema's imports, `import type` included.
const IMPORT_PATTERN =
	/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];

/** Packages the schema's import closure may reach; everything else is app runtime. */
const SCHEMA_RUNTIME_PACKAGES = new Set([
	"drizzle-orm",
	// `@/lib/enterprise-identity/setup-state`
	"luxon",
	// `@/lib/datetime/temporal-core`
	"temporal-polyfill",
]);

function resolveLocalImport(fromDirectory: string, specifier: string): string {
	const raw = path.resolve(fromDirectory, specifier);
	const candidates = [
		raw,
		...SOURCE_EXTENSIONS.map((extension) => `${raw}${extension}`),
		...SOURCE_EXTENSIONS.map((extension) => path.join(raw, `index${extension}`)),
	];
	const resolved = candidates.find(
		(candidate) => existsSync(candidate) && statSync(candidate).isFile(),
	);
	if (!resolved) throw new Error(`Unable to resolve ${specifier} from ${fromDirectory}`);
	return resolved;
}

function importSpecifiers(filePath: string): string[] {
	return [...readFileSync(filePath, "utf8").matchAll(IMPORT_PATTERN)]
		.map((match) => match[1] ?? match[2] ?? match[3])
		.filter((specifier): specifier is string => Boolean(specifier));
}

function packageName(specifier: string): string {
	const [scopeOrName, name] = specifier.split("/");
	return specifier.startsWith("@") && name ? `${scopeOrName}/${name}` : scopeOrName;
}

/** Every file the schema reaches, with the specifiers it imports. */
function schemaImportClosure(): Map<string, string[]> {
	const closure = new Map<string, string[]>();
	const pending = readdirSync(schemaDirectory)
		.filter((fileName) => fileName.endsWith(".ts") && !fileName.endsWith(".test.ts"))
		.map((fileName) => path.join(schemaDirectory, fileName));

	while (pending.length > 0) {
		const filePath = pending.pop() as string;
		if (closure.has(filePath)) continue;
		const specifiers = importSpecifiers(filePath);
		closure.set(filePath, specifiers);
		for (const specifier of specifiers) {
			if (specifier.startsWith("@/")) {
				pending.push(resolveLocalImport(sourceDirectory, specifier.slice(2)));
			} else if (specifier.startsWith(".")) {
				pending.push(resolveLocalImport(path.dirname(filePath), specifier));
			}
		}
	}
	return closure;
}

function sourceRelative(filePath: string): string {
	return path.relative(sourceDirectory, filePath).replaceAll("\\", "/");
}

describe("schema import boundaries", () => {
	it("reaches no app runtime packages, even through type-only imports", () => {
		const offenders = [...schemaImportClosure()].flatMap(([filePath, specifiers]) =>
			specifiers
				.filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("@/"))
				.filter((specifier) => !specifier.startsWith("node:"))
				.map(packageName)
				.filter((name) => !SCHEMA_RUNTIME_PACKAGES.has(name))
				.map((name) => `${sourceRelative(filePath)} -> ${name}`),
		);

		expect(offenders).toEqual([]);
	});

	it("imports travel expense types only from dependency-free modules", () => {
		// A travel expense module the schema reaches imports nothing but its
		// dependency-free siblings (`*.types.ts`); the runtime logic re-exports them.
		const offenders = [...schemaImportClosure()]
			.filter(([filePath]) => sourceRelative(filePath).startsWith("lib/travel-expenses/"))
			.flatMap(([filePath, specifiers]) =>
				specifiers
					.filter((specifier) => !specifier.startsWith("./"))
					.map((specifier) => `${sourceRelative(filePath)} -> ${specifier}`),
			);

		expect(offenders).toEqual([]);
	});

	it("imports personnel file vocabulary only from import-free `.types` modules", () => {
		// The schema reaches the Personnel File module only through its
		// dependency-free vocabulary (`*.types.ts`), which imports nothing; the
		// runtime logic (Temporal, storage, auth) re-exports it.
		const offenders = [...schemaImportClosure()]
			.filter(([filePath]) => sourceRelative(filePath).startsWith("lib/personnel-file/"))
			.flatMap(([filePath, specifiers]) => {
				const relative = sourceRelative(filePath);
				if (!relative.endsWith(".types.ts")) return [`${relative} is not a .types module`];
				return specifiers.map((specifier) => `${relative} -> ${specifier}`);
			});

		expect(offenders).toEqual([]);
	});

	it("keeps schema declarations independent from the Temporal runtime adapter", () => {
		const runtimeAdapterImports = readdirSync(schemaDirectory)
			.filter((fileName) => fileName.endsWith(".ts"))
			.filter((fileName) =>
				readFileSync(`${schemaDirectory}/${fileName}`, "utf8").includes(
					'from "@/lib/datetime/drizzle-adapter"',
				),
			);

		expect(runtimeAdapterImports).toEqual([]);
	});

	it("keeps Better Auth SCIM models in the generated auth schema", () => {
		const generatedAuthSchema = readFileSync(
			`${schemaDirectory}/../auth-schema.ts`,
			"utf8",
		);
		const expectedModels = [
			"scimManagedConnection",
			"scimManagedCredential",
			"scimManagedConnectionEvent",
			"scimConnectionBinding",
			"scimIdentityTombstone",
			"scimSubject",
			"scimUser",
			"scimProjectionGrant",
			"scimGroup",
			"scimGroupMember",
		];

		for (const model of expectedModels) {
			expect(generatedAuthSchema).toContain(`export const ${model} = pgTable(`);
		}
		expect(generatedAuthSchema).not.toContain("scimProviderConfig");
		expect(generatedAuthSchema).not.toContain("scimRoleMapping");
		expect(generatedAuthSchema).not.toContain("scimRoleTemplate");
	});
});
