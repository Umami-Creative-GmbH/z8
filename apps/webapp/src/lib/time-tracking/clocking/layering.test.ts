import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function appImports(relativePath: string) {
	return [...source(relativePath).matchAll(/from "(@\/app\/[^"]+)"/g)].map(
		([, specifier]) => `${relativePath}: ${specifier}`,
	);
}

// #524: bots, API routes and the departure worker run the Clocking module
// outside a web request, so it must not reach into the web actions.
describe("Clocking module layering", () => {
	it("imports nothing from the app layer but the break writer's raw entry helper", () => {
		const moduleFiles = readdirSync(fileURLToPath(new URL(".", import.meta.url))).filter(
			(file) => file.endsWith(".ts") && !file.includes(".test."),
		);

		expect(moduleFiles).toContain("index.ts");
		expect(moduleFiles.flatMap((file) => appImports(`./${file}`))).toEqual([
			"./break.ts: @/app/[locale]/(app)/time-tracking/actions/entry-helpers",
		]);
	});

	it("keeps the follow-up effects and the canonical work record writer in lib", () => {
		expect([
			...appImports("../clock-out-effects.ts"),
			...appImports("../canonical-work-record.ts"),
		]).toEqual([]);
	});
});
