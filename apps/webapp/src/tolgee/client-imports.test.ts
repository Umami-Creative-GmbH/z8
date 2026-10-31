import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
// `shared.ts` builds an import map over every messages/ file at module load; a client
// import puts that map (and the Tolgee catalog loaders) into every page bundle.
const SHARED = path.join(SRC, "tolgee", "shared");
// Modules "use client" files reach statically that must stay free of it too.
const CLIENT_REACHABLE_MODULES = [
	"i18n/routing.ts",
	"navigation.ts",
	"tolgee/catalog-config.ts",
	"tolgee/catalog-slices.ts",
	"tolgee/catalog-store.ts",
	// Loads `./shared` with import() so the map becomes an async chunk.
	"tolgee/client-catalog-loader.ts",
	"tolgee/tolgee-core.ts",
];

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
	});
}

function importsShared(file: string, source: string): boolean {
	for (const [, specifier] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
		const resolved = specifier.startsWith("@/")
			? path.join(SRC, specifier.slice(2))
			: specifier.startsWith(".")
				? path.resolve(path.dirname(file), specifier)
				: null;
		if (resolved === SHARED) return true;
	}
	return false;
}

describe("client translation imports", () => {
	it("keeps the server catalog loader out of client modules", () => {
		const offenders = sourceFiles(SRC)
			.map((file) => ({ file, relative: path.relative(SRC, file).replaceAll("\\", "/") }))
			.filter(({ file, relative }) => {
				const source = readFileSync(file, "utf8");
				const isClient = /^\s*["']use client["']/.test(source);
				return (isClient || CLIENT_REACHABLE_MODULES.includes(relative)) && importsShared(file, source);
			})
			.map(({ relative }) => relative);

		expect(offenders).toEqual([]);
	});
});
