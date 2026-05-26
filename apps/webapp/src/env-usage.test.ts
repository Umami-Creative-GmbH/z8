import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL(".", import.meta.url));
const ALLOWED_DIRECT_ENV_READERS = new Set(["env.ts", "instrumentation.ts"]);

function collectRuntimeFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const absolutePath = join(directory, entry);
		const stats = statSync(absolutePath);

		if (stats.isDirectory()) {
			return collectRuntimeFiles(absolutePath);
		}

		if (
			(!entry.endsWith(".ts") && !entry.endsWith(".tsx")) ||
			entry.includes(".test.") ||
			ALLOWED_DIRECT_ENV_READERS.has(relative(SRC_ROOT, absolutePath))
		) {
			return [];
		}

		return [absolutePath];
	});
}

describe("environment variable usage", () => {
	it("reads env vars from @/env outside env and instrumentation setup", () => {
		const offenders = collectRuntimeFiles(SRC_ROOT).flatMap((filePath) => {
			const source = readFileSync(filePath, "utf8");

			if (!source.includes("process.env")) {
				return [];
			}

			return [relative(SRC_ROOT, filePath)];
		});

		expect(offenders).toEqual([]);
	});
});
