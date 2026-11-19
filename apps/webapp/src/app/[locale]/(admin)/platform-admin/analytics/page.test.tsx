/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.platformAnalytics" ? "Plattformanalyse wird geladen" : fallback,
	}),
}));

vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: vi.fn(async () => ({ user: { role: "admin" } })),
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));

vi.mock("./analytics-charts", () => ({
	PlatformAnalyticsCharts: () => <div data-testid="platform-analytics-charts" />,
}));

vi.mock("./analytics-controls", () => ({
	PlatformAnalyticsControls: () => <div data-testid="platform-analytics-controls" />,
}));

vi.mock("@/lib/platform-analytics/service", () => ({
	getPlatformAnalyticsData: vi.fn(),
}));

const { default: PlatformAnalyticsPage } = await import("./page");

describe("PlatformAnalyticsPage", () => {
	it("keeps a main heading and working Retry in the public route error boundary", async () => {
		const { default: AnalyticsError } = await import("./error");
		const reset = vi.fn();
		render(<AnalyticsError reset={reset} />);
		expect(screen.getByRole("heading", { level: 1, name: "Platform Analytics" })).toBeTruthy();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		});
		expect(reset).toHaveBeenCalledTimes(1);
		expect(screen.queryByTestId("platform-analytics-charts")).toBeNull();
	});
	it("supplies a translated named fallback without awaiting search params", async () => {
		const pending = new Promise<never>(() => {});
		const timeout = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error("page awaited search params")), 100);
		});
		const page = await Promise.race([PlatformAnalyticsPage({ searchParams: pending }), timeout]);

		await act(async () => {
			render(page.props.fallback);
		});

		expect(screen.getByRole("heading", { name: "Platform Analytics" })).toBeTruthy();
		expect(screen.getAllByRole("status")[0].getAttribute("aria-busy")).toBe("true");
		expect(screen.getAllByRole("status")[0].getAttribute("aria-label")).toBe(
			"Loading platform analytics",
		);
	});

	it("passes the unresolved search params to the focused route content", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/app/[locale]/(admin)/platform-admin/analytics/page.tsx"),
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
