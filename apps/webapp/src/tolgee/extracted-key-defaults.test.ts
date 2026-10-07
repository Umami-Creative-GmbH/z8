import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import extractor from "../../tolgee-extractor.mjs";

// `tolgee sync` creates a key extracted without a default with no English text, and
// `pnpm i18n:pull` then omits it from every catalog, so all locales show the code fallback.
// Every key needs a static default at one or more of its call sites (see docs/refs/i18n.md).
const WEBAPP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_ROOT = join(WEBAPP_ROOT, "src");

// Mirrors the `./src/**/*.ts?(x)` pattern in tolgee.config.cjs.
function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry) ? [path] : [];
	});
}

type ExtractedKey = { keyName: string; namespace?: string; defaultValue?: string; line: number };

function extractedKeys() {
	const keys = new Map<string, { hasDefault: boolean; sites: string[] }>();
	for (const file of sourceFiles(SOURCE_ROOT)) {
		const fileName = relative(WEBAPP_ROOT, file).replaceAll("\\", "/");
		const result = extractor(readFileSync(file, "utf8"), fileName) as { keys: ExtractedKey[] };
		for (const key of result.keys) {
			const id = `${key.namespace}:${key.keyName}`;
			const entry = keys.get(id) ?? { hasDefault: false, sites: [] };
			entry.hasDefault ||= key.defaultValue !== undefined;
			entry.sites.push(`${fileName}:${key.line}`);
			keys.set(id, entry);
		}
	}
	return keys;
}

describe("extracted translation keys", () => {
	it("all have a default English value", () => {
		const offenders = [...extractedKeys()]
			.filter(([, { hasDefault }]) => !hasDefault)
			.map(([id, { sites }]) => `${id} (${sites.join(", ")})`);

		expect(offenders).toEqual([]);
	});
});
