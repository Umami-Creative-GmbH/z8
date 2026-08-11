import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AppLayout", () => {
	const source = readFileSync("src/app/[locale]/(app)/layout.tsx", "utf8");

	it("places the authenticated app layout behind the visible app-frame boundary", () => {
		expect(source).toMatch(
			/export default function AppLayout\(props: AppLayoutProps\) \{\s*return \(\s*<Suspense fallback=\{<AppFrameLoading \/>\}>\s*<AuthenticatedAppLayout \{\.\.\.props\} \/>\s*<\/Suspense>\s*\);\s*\}/,
		);
	});

	it("keeps auth checks and protected children inside the async layout", () => {
		const wrapperStart = source.indexOf("export default function AppLayout");
		const authenticatedStart = source.indexOf(
			"async function AuthenticatedAppLayout",
		);

		expect(wrapperStart).toBeGreaterThan(-1);
		expect(authenticatedStart).toBeGreaterThan(wrapperStart);

		const wrapperSource = source.slice(wrapperStart, authenticatedStart);
		const authenticatedSource = source.slice(authenticatedStart);

		expect(wrapperSource).not.toContain("auth.api.getSession");
		expect(wrapperSource).not.toContain("redirect(");
		expect(wrapperSource).not.toContain("{children}");
		expect(authenticatedSource).toContain("auth.api.getSession");
		expect(authenticatedSource).toContain("redirect(");
		expect(authenticatedSource).toContain("<ServerAppSidebar");
		expect(authenticatedSource).toContain("{children}");
	});
});
