import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectWithLocaleMock } = vi.hoisted(() => ({
	redirectWithLocaleMock: vi.fn((path: string): never => {
		throw new Error(`NEXT_REDIRECT:${path}`);
	}),
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: redirectWithLocaleMock,
}));

vi.mock("@/components/settings/settings-skeletons", () => ({
	SettingsPageSkeleton: () => <div>Loading statistics</div>,
}));

import StatisticsPage from "./page";

describe("/settings/statistics legacy redirect (#1955)", () => {
	beforeEach(() => {
		redirectWithLocaleMock.mockClear();
	});

	it("redirects to /analytics preserving the active locale", async () => {
		const page = StatisticsPage();
		const contentElement = page.props.children as {
			type: () => Promise<never>;
		};

		await expect(contentElement.type()).rejects.toThrow("NEXT_REDIRECT:/analytics");
		expect(redirectWithLocaleMock).toHaveBeenCalledTimes(1);
		expect(redirectWithLocaleMock).toHaveBeenCalledWith("/analytics");
	});

	it("provides a Suspense fallback while redirecting", () => {
		const html = renderToStaticMarkup(StatisticsPage());
		expect(html).toContain("Loading statistics");
	});
});
