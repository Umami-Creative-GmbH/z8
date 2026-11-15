/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";
import { PageHeader } from "./ui/page-header";

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

vi.mock("@/components/header-refresh-button", () => ({
	HeaderRefreshButton: ({ children }: { children?: ReactNode }) => (
		<button type="button">{children ?? "Refresh data"}</button>
	),
}));

vi.mock("@/components/header-timezone-control", () => ({
	HeaderTimezoneControl: ({ trigger }: { trigger?: ReactElement }) =>
		trigger ?? <button type="button">Timezone</button>,
}));

vi.mock("@/components/notifications", () => ({
	NotificationBell: () => <button type="button">Notifications</button>,
}));

vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: ({ trigger }: { trigger?: ReactElement }) =>
		trigger ?? <button type="button">Toggle theme</button>,
}));

vi.mock("@/components/time-tracking/time-clock-popover", () => ({
	TimeClockPopover: () => <button type="button">Clock In</button>,
}));

vi.mock("@/components/ui/sidebar", () => ({
	SidebarTrigger: () => <button type="button">Toggle sidebar</button>,
}));

vi.mock("@/components/dashboard/dashboard-header-customize", () => ({
	DashboardHeaderCustomize: ({ trigger }: { trigger?: ReactElement }) =>
		trigger ?? <button type="button">Customize dashboard</button>,
}));

describe("SiteHeader", () => {
	it("hands the personal equipment title to its page without adopting other destinations", () => {
		pathname = "/en/my-equipment";
		const page = render(
			<>
				<SiteHeader />
				<PageHeader title="My equipment" />
			</>,
		);
		expect(
			screen.getAllByRole("heading", { level: 1 }).map((n) => n.textContent),
		).toEqual(["My equipment"]);
		page.unmount();
		pathname = "/en/my-equipment/other";
		render(<SiteHeader />);
		expect(
			screen.getByRole("heading", { level: 1, name: "My equipment" }),
		).toBeTruthy();
	});
	it("hands the suspended recovery title to the page without opting descendants into heading ownership", () => {
		pathname = "/de/billing/suspended";
		const page = render(
			<>
				<SiteHeader />
				<PageHeader title="Organization suspended" />
			</>,
		);
		expect(
			screen
				.getAllByRole("heading", { level: 1 })
				.map((heading) => heading.textContent),
		).toEqual(["Organization suspended"]);
		page.unmount();
		pathname = "/en/billing/suspended/unconverted";
		render(<SiteHeader />);
		expect(
			screen.getByRole("heading", { level: 1, name: "Billing & Subscription" }),
		).toBeTruthy();
	});
	it("hands the main title to converted pages while retaining unknown descendant titles", () => {
		pathname = "/de/reports";
		const page = render(
			<>
				<SiteHeader />
				<PageHeader title="Employee Reports" />
			</>,
		);
		expect(
			screen
				.getAllByRole("heading", { level: 1 })
				.map((heading) => heading.textContent),
		).toEqual(["Employee Reports"]);
		page.unmount();
		pathname = "/de/calendar/employee-1";
		const calendar = render(
			<>
				<SiteHeader />
				<PageHeader title="Calendar" />
			</>,
		);
		expect(
			screen
				.getAllByRole("heading", { level: 1 })
				.map((heading) => heading.textContent),
		).toEqual(["Calendar"]);
		calendar.unmount();
		pathname = "/en/calendar/employee-1/detail";
		render(<SiteHeader />);
		expect(
			screen.getByRole("heading", { level: 1, name: "Calendar" }),
		).toBeTruthy();
	});

	it("does not remove the shell heading from unconverted report subpages", () => {
		pathname = "/en/reports/vehicles";
		render(<SiteHeader />);
		expect(
			screen.getByRole("heading", { level: 1, name: "Distance per Vehicle" }),
		).toBeTruthy();
	});
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
			"Refresh data",
			"Toggle theme",
			"Notifications",
			"More actions",
		]);
	});

	it("keeps secondary dashboard controls available as labeled actions in the mobile overflow", async () => {
		pathname = "/en";
		render(<SiteHeader />);
		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		const panel = await screen.findByRole("dialog", { name: "More actions" });
		expect(
			within(panel).getByRole("button", { name: "Customize dashboard" }),
		).toBeTruthy();
		expect(
			within(panel).getByRole("button", { name: "Saved timezone" }),
		).toBeTruthy();
		expect(
			within(panel).getByRole("button", { name: "Refresh data" }),
		).toBeTruthy();
		expect(
			within(panel).getByRole("button", { name: "Toggle theme" }),
		).toBeTruthy();
		expect(
			within(panel).queryByRole("button", { name: "Clock In" }),
		).toBeNull();
		expect(
			within(panel).queryByRole("button", { name: "Notifications" }),
		).toBeNull();
	});

	it("keeps mobile overflow actions available outside the dashboard without customization", async () => {
		pathname = "/en/time-tracking";
		render(<SiteHeader />);
		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		const panel = await screen.findByRole("dialog", { name: "More actions" });
		expect(
			within(panel).queryByRole("button", { name: "Customize dashboard" }),
		).toBeNull();
		expect(
			within(panel).getByRole("button", { name: "Saved timezone" }),
		).toBeTruthy();
		expect(
			within(panel).getByRole("button", { name: "Refresh data" }),
		).toBeTruthy();
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

		expect(screen.getByText("Employees")).toBeTruthy();
		expect(screen.queryByText("Dashboard")).toBeNull();
		expect(screen.getByRole("heading", { name: "Employees" })).toBeTruthy();
	});

	it("truncates a long title so the header actions stay on a phone screen (#846)", () => {
		pathname = "/en/notifications";

		render(<SiteHeader />);

		const title = screen.getByText("Notifications", {
			selector: '[data-slot="route-title"]',
		});
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
