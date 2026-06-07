import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const uiDir = join(process.cwd(), "src/components/ui");
const srcDir = join(process.cwd(), "src");
const forbiddenRadixImportPattern = /(?:from\s+["'](?:@radix-ui\/[^"']+|radix-ui)["']|import\s+["'](?:@radix-ui\/[^"']+|radix-ui)["'])/;
const forbiddenRadixDependencyPattern = /"(?:@radix-ui\/[^"']+|radix-ui)"\s*:/;

function collectSourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			return collectSourceFiles(path);
		}

		return /\.(ts|tsx)$/.test(entry) ? [path] : [];
	});
}

describe("Radix source guard", () => {
	it("does not import Radix from active UI wrappers", () => {
		const offenders = collectSourceFiles(uiDir).filter((file) =>
			forbiddenRadixImportPattern.test(readFileSync(file, "utf8")),
		);

		expect(offenders.map((file) => relative(process.cwd(), file))).toEqual([]);
	});

	it("does not import Radix from active webapp source", () => {
		const offenders = collectSourceFiles(srcDir).filter((file) => {
			if (/\.(test|spec|types)\.(ts|tsx)$/.test(file)) {
				return false;
			}

			return forbiddenRadixImportPattern.test(readFileSync(file, "utf8"));
		});

		expect(offenders.map((file) => relative(process.cwd(), file))).toEqual([]);
	});

	it("does not declare direct Radix dependencies in the webapp package", () => {
		const packageSource = readFileSync(join(process.cwd(), "package.json"), "utf8");

		expect(packageSource.match(forbiddenRadixDependencyPattern)).toBeNull();
	});
});
