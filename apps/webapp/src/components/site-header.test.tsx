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
	useUserTimezone: () => "Europe/Berlin",
}));

vi.mock("@/components/header-timezone-control", () => ({
	HeaderTimezoneControl: () => <button type="button">Timezone</button>,
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
	DashboardHeaderCustomize: () => (
		<button type="button">Customize dashboard</button>
	),
}));

describe("SiteHeader", () => {
	it("shows header actions in the requested order on the dashboard route", () => {
		pathname = "/en";

		render(<SiteHeader />);

		const buttons = screen
			.getAllByRole("button")
			.map((button) => button.textContent);
		expect(buttons).toEqual([
			"Toggle sidebar",
			"Customize dashboard",
			"Timezone",
			"Clock In",
			"Notifications",
		]);
	});

	it("does not show the dashboard customize trigger outside the dashboard route", () => {
		pathname = "/en/time-tracking";

		render(<SiteHeader />);

		expect(
			screen.queryByRole("button", { name: "Customize dashboard" }),
		).toBeNull();
		expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Timezone" })).toBeTruthy();
	});

	it("shows the most specific route title instead of falling back to Dashboard", () => {
		pathname = "/en/settings/employees/employee-1";

		render(<SiteHeader />);

		expect(screen.getByRole("heading", { name: "Employees" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Dashboard" })).toBeNull();
	});

	it("truncates a long title so the header actions stay on a phone screen (#846)", () => {
		pathname = "/en/notifications";

		render(<SiteHeader />);

		const title = screen.getByRole("heading");
		expect(title.classList.contains("truncate")).toBe(true);
		expect(title.classList.contains("min-w-0")).toBe(true);
	});

	it("clears the status bar when the app is drawn edge to edge (#846)", () => {
		pathname = "/en";

		const { container } = render(<SiteHeader />);

		const header = container.querySelector("header");
		expect(header?.className).toContain("pt-[env(safe-area-inset-top)]");
		expect(header?.className).toContain("box-content");
	});
});
