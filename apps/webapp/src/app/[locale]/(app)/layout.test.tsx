import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AppLayout", () => {
	const source = readFileSync("src/app/[locale]/(app)/layout.tsx", "utf8");
	const contentSource = readFileSync(
		"src/app/[locale]/(app)/app-layout-content.tsx",
		"utf8",
	);

	it("places the authenticated app layout behind the visible app-frame boundary", () => {
		expect(source).toMatch(
			/<Suspense fallback=\{<AuthenticatedAppShell \/>\}>\s*<AuthenticatedAppContent params=\{params\}>\s*\{children\}\s*<\/AuthenticatedAppContent>\s*<\/Suspense>/,
		);
	});

	it("keeps auth checks and protected children inside the async layout", () => {
		expect(source).not.toContain("auth.api.getSession");
		expect(source).not.toContain("redirect(");
		expect(contentSource).toContain("auth.api.getSession");
		expect(contentSource).toContain("redirect(");
		expect(contentSource).toContain("<ServerAppSidebar");
		expect(contentSource).toContain("{children}");
	});

	it("defers auth database instrumentation until request time", () => {
		const contentStart = contentSource.indexOf("export async function AuthenticatedAppContent");
		const connectionCall = contentSource.indexOf("await connection();", contentStart);
		expect(contentSource).toContain('import { connection } from "next/server"');
		expect(connectionCall).toBeGreaterThan(contentStart);
		expect(connectionCall).toBeLessThan(contentSource.indexOf("auth.api.getSession"));
	});
});
