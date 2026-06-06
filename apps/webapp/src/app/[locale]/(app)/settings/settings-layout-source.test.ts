import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings layout sidebar", () => {
	it("keeps the settings nav scroll container flush for sticky headers", () => {
		const source = readFileSync("src/app/[locale]/(app)/settings/layout.tsx", "utf8");

		expect(source).toContain('className="w-64 border-r bg-card hidden md:block overflow-auto"');
		expect(source).not.toContain(
			'className="w-64 border-r bg-card p-4 hidden md:block overflow-auto"',
		);
	});
});
