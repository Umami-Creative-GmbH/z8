/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push, search } = vi.hoisted(() => ({ push: vi.fn(), search: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: search }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push }) }));

import { PlatformAnalyticsControls } from "./analytics-controls";

describe("platform reporting filters", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		search.mockReturnValue(new URLSearchParams("range=12m&bucket=month&status=current"));
	});
	it("coerces the bucket when range changes and preserves unrelated deep-link state", async () => {
		const user = userEvent.setup();
		render(<PlatformAnalyticsControls range="12m" bucket="month" />);
		await user.click(screen.getByRole("combobox", { name: "Analytics range" }));
		await user.click(await screen.findByRole("option", { name: "Last 7 days" }));
		expect(push).toHaveBeenCalledWith(
			"/platform-admin/analytics?range=7d&bucket=day&status=current",
		);
	});
	it("offers only allowed buckets and keeps the selected range", async () => {
		const user = userEvent.setup();
		render(<PlatformAnalyticsControls range="30d" bucket="day" />);
		await user.click(screen.getByRole("combobox", { name: "Analytics bucket" }));
		expect(screen.queryByRole("option", { name: "Monthly" })).toBeNull();
		await user.click(await screen.findByRole("option", { name: "Weekly" }));
		expect(push).toHaveBeenCalledWith(
			"/platform-admin/analytics?range=30d&bucket=week&status=current",
		);
	});
});
