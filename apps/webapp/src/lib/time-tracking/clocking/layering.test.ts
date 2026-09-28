import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// Static, dynamic and relative specifiers into `src/app`.
const APP_SPECIFIER = /(?:from |import\()"((?:@\/|(?:\.\.\/)+)app\/[^"]+)"/g;

function appImports(relativePath: string) {
	return [...source(relativePath).matchAll(APP_SPECIFIER)].map(
		([, specifier]) => `${relativePath}: ${specifier}`,
	);
}

// #524: bots, API routes and the departure worker run the Clocking module
// outside a web request, so it must not reach into the web actions.
describe("Clocking module layering", () => {
	it("imports nothing from the app layer", () => {
		const moduleFiles = readdirSync(fileURLToPath(new URL(".", import.meta.url))).filter(
			(file) => file.endsWith(".ts") && !file.includes(".test."),
		);

		expect(moduleFiles).toContain("index.ts");
		expect(moduleFiles.flatMap((file) => appImports(`./${file}`))).toEqual([]);
	});

	it("keeps the follow-up effects and the work record and entry writers in lib", () => {
		expect([
			...appImports("../clock-out-effects.ts"),
			...appImports("../canonical-work-record.ts"),
			...appImports("../time-entry-writer.ts"),
		]).toEqual([]);
	});
});
