import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROUTE_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("app layout locale preference", () => {
	it("does not mutate the locale cookie while rendering the layout", () => {
		const source = stripComments(readFileSync(join(APP_ROUTE_ROOT, "layout.tsx"), "utf8"));

		expect(source).not.toContain("setLanguage(");
		expect(source).not.toContain("@/tolgee/language");
	});
});

describe("app layout user preferences", () => {
	it("passes the saved user timezone to the client preference provider", () => {
		const source = stripComments(readFileSync(join(APP_ROUTE_ROOT, "layout.tsx"), "utf8"));

		expect(source).toContain("getUserTimezone(session.user.id)");
		expect(source).toContain("timezone={timezone}");
	});
});
