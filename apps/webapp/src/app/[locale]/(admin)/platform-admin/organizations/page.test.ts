import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform admin organizations page query params", () => {
	it("does not read window.location.search during render", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).not.toContain("window.location.search");
	});
});
