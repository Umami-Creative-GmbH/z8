/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

let pathname = "/";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/navigation", () => ({
	usePathname: () => pathname,
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
}));

vi.mock("@/components/notifications", () => ({
	NotificationBell: () => <button type="button">Notifications</button>,
}));

vi.mock("@/components/time-tracking/time-clock-popover", () => ({
	TimeClockPopover: () => <button type="button">Clock In</button>,
}));

vi.mock("@/components/ui/sidebar", () => ({
	SidebarTrigger: () => <button type="button">Toggle sidebar</button>,
}));

vi.mock("@/components/dashboard/dashboard-header-customize", () => ({
	DashboardHeaderCustomize: () => <button type="button">Customize dashboard</button>,
}));

describe("SiteHeader", () => {
	it("shows the dashboard customize trigger before notifications on the dashboard route", () => {
		pathname = "/en";

		render(<SiteHeader />);

		const buttons = screen.getAllByRole("button").map((button) => button.textContent);
		expect(buttons).toEqual([
			"Toggle sidebar",
			"Customize dashboard",
			"Notifications",
			"Clock In",
		]);
	});

	it("does not show the dashboard customize trigger outside the dashboard route", () => {
		pathname = "/en/time-tracking";

		render(<SiteHeader />);

		expect(screen.queryByRole("button", { name: "Customize dashboard" })).toBeNull();
		expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
	});
});
