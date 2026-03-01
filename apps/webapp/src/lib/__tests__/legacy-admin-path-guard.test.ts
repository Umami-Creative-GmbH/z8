import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const FILE_EXTENSIONS = new Set([".ts", ".tsx"]);

const IGNORE_SEGMENTS = new Set([
	"__tests__",
	"messages",
	"docs",
	".source",
	"node_modules",
]);

function walk(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const stats = statSync(fullPath);

		if (stats.isDirectory()) {
			if (IGNORE_SEGMENTS.has(entry)) {
				continue;
			}
			walk(fullPath, files);
			continue;
		}

		if (stats.isFile() && [...FILE_EXTENSIONS].some((ext) => fullPath.endsWith(ext))) {
			if (fullPath.endsWith(".d.ts")) {
				continue;
			}
			files.push(fullPath);
		}
	}

	return files;
}

function containsForbiddenPathLiteral(content: string): boolean {
	const legacyApiAdmin = /["'`]\/api\/admin(?:\/|["'`]|\$\{|[?#])/;
	const legacyAdmin = /["'`]\/admin(?:\/|["'`]|\$\{|[?#])/;

	return legacyApiAdmin.test(content) || legacyAdmin.test(content);
}

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("legacy admin path guard", () => {
	it("does not allow runtime /admin or /api/admin path literals", () => {
		const offenders: string[] = [];

		for (const filePath of walk(SRC_ROOT)) {
			const content = readFileSync(filePath, "utf8");
			if (containsForbiddenPathLiteral(stripComments(content))) {
				offenders.push(filePath.replace(`${SRC_ROOT}/`, "src/"));
			}
		}

		expect(offenders).toEqual([]);
	});
});
