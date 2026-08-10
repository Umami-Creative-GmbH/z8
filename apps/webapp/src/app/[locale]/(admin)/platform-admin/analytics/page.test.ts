import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("platform admin analytics page", () => {
	it("keeps the search params promise inside the focused page boundary", () => {
		expect(source).toMatch(
			/<Suspense fallback=\{<PlatformAnalyticsPageLoading \/>\}>\s*<PlatformAnalyticsPageContent searchParams=\{searchParams\} \/>\s*<\/Suspense>/,
		);
		expect(source).toMatch(
			/async function PlatformAnalyticsPageContent\([\s\S]*?const \[t, params\] = await Promise\.all\(\[getTranslate\(\), searchParams\]\)/,
		);
	});

	it("uses the selected range and bucket for controls and fresh analytics data", () => {
		expect(source).toContain("parsePlatformAnalyticsParams(params ?? {})");
		expect(source).toMatch(
			/<PlatformAnalyticsControls\s+range=\{parsedParams\.range\}\s+bucket=\{parsedParams\.bucket\}\s*\/>/,
		);
		expect(source).toMatch(
			/key=\{`\$\{parsedParams\.range\}-\$\{parsedParams\.bucket\}`\}/,
		);
		expect(source).toContain(
			"<PlatformAnalyticsDataSection parsedParams={parsedParams} />",
		);
	});
});
