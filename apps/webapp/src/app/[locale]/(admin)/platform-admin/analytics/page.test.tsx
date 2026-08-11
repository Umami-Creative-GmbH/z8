/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.platformAnalytics"
				? "Plattformanalyse wird geladen"
				: fallback,
	}),
}));

vi.mock("next/server", () => ({ connection: vi.fn() }));

vi.mock("@/components/platform-admin/platform-analytics-charts", () => ({
	PlatformAnalyticsCharts: () => (
		<div data-testid="platform-analytics-charts" />
	),
}));

vi.mock("./analytics-controls", () => ({
	PlatformAnalyticsControls: () => (
		<div data-testid="platform-analytics-controls" />
	),
}));

vi.mock("@/lib/platform-analytics/service", () => ({
	getPlatformAnalyticsData: vi.fn(),
}));

const { default: PlatformAnalyticsPage } = await import("./page");

describe("PlatformAnalyticsPage", () => {
	it("renders its translated shell while search params remain unresolved", async () => {
		const pending = new Promise<never>(() => {});
		const timeout = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error("page awaited search params")), 100);
		});
		const page = await Promise.race([
			PlatformAnalyticsPage({ searchParams: pending }),
			timeout,
		]);

		await act(async () => {
			render(page);
		});

		expect(
			screen.getByRole("heading", { name: "Platform Analytics" }),
		).toBeTruthy();
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Plattformanalyse wird geladen")).toBeTruthy();
	});

	it("passes the unresolved search params to the focused route content", () => {
		const source = readFileSync(
			resolve(
				process.cwd(),
				"src/app/[locale]/(admin)/platform-admin/analytics/page.tsx",
			),
			"utf8",
		);
		const defaultExport = source.slice(
			source.indexOf("export default"),
			source.indexOf("async function PlatformAnalyticsRouteContent"),
		);

		expect(defaultExport).toMatch(
			/<PlatformAnalyticsRouteContent[\s\S]*searchParams=\{searchParams\}/,
		);
		expect(defaultExport).not.toContain("await searchParams");
	});
});
