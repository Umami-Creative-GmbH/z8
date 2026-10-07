import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Tolgee pulls overwrite local catalog fixes, so placeholder damage that reaches the
// server (a `${}` default, an i18next `{{x}}` fallback) keeps coming back (#730).
const MESSAGES_ROOT = fileURLToPath(new URL("../../messages", import.meta.url));
const COMPLEX_ICU = /,\s*(?:plural|select|selectordinal)\s*,/;

function catalogFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) return catalogFiles(path);
		return path.endsWith(".json") ? [path] : [];
	});
}

function catalogEntries(value: unknown, prefix = ""): [string, string][] {
	if (typeof value === "string") return [[prefix, value]];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) =>
		catalogEntries(child, prefix ? `${prefix}.${key}` : key),
	);
}

const entries = catalogFiles(MESSAGES_ROOT).flatMap((file) =>
	catalogEntries(JSON.parse(readFileSync(file, "utf8"))).map(([key, value]) => ({
		where: `${relative(MESSAGES_ROOT, file).replaceAll("\\", "/")} ${key}`,
		value,
	})),
);

describe("catalog placeholders", () => {
	it("contains no JavaScript template placeholders", () => {
		const offenders = entries
			.filter(({ value }) => value.includes("${"))
			.map(({ where, value }) => `${where}: ${value}`);

		expect(offenders).toEqual([]);
	});

	it("uses ICU {name} arguments instead of i18next {{name}}", () => {
		const offenders = entries
			.filter(({ value }) => !COMPLEX_ICU.test(value) && /\{\{\s*\w+\s*\}\}/.test(value))
			.map(({ where, value }) => `${where}: ${value}`);

		expect(offenders).toEqual([]);
	});
});
