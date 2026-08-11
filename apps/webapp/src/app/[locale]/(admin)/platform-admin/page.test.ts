import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("platform admin analytics preview request boundary", () => {
	it("resolves the current live preview inside its focused Suspense section", () => {
		const previewStart = source.indexOf(
			"async function DashboardAnalyticsPreview",
		);
		const previewEnd = source.indexOf(
			"\nfunction DashboardAnalyticsPreviewLoading",
			previewStart,
		);
		const previewSource = source.slice(previewStart, previewEnd);
		const connectionIndex = previewSource.indexOf("await connection();");
		const rangeIndex = previewSource.indexOf(
			'parsePlatformAnalyticsParams({ range: "30d", bucket: "week" })',
		);
		const analyticsIndex = previewSource.indexOf(
			"getPlatformAnalyticsData(params",
		);

		expect(connectionIndex).toBeGreaterThanOrEqual(0);
		expect(rangeIndex).toBeGreaterThan(connectionIndex);
		expect(analyticsIndex).toBeGreaterThan(rangeIndex);
		expect(previewSource).not.toMatch(/["']use cache/);
		expect(source).toMatch(
			/<Suspense fallback=\{<DashboardAnalyticsPreviewLoading \/>\}>\s*<DashboardAnalyticsPreview \/>\s*<\/Suspense>/,
		);
	});
});
