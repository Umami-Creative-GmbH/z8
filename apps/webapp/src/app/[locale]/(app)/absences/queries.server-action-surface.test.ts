import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const absencesDir = dirname(fileURLToPath(import.meta.url));

function readSource(file: string) {
	return readFileSync(join(absencesDir, file), "utf8");
}

// #445: every export of a "use server" module can become a public endpoint, so
// reads that take employee or organization IDs from the caller stay out of them.
describe("absence read helper surface", () => {
	it("keeps the absence queries a server-only helper module", () => {
		const source = readSource("queries.ts");

		expect(source).toContain('import "server-only";');
		expect(source).not.toContain('"use server"');
	});

	it("exposes no unauthenticated absence category read from the actions module", () => {
		expect(readSource("actions.ts")).not.toMatch(/^export\b[^\n]*\bgetAbsenceCategories\b/m);
	});
});
