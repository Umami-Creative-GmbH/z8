/* @vitest-environment jsdom */

import { IconDashboard, IconUsers } from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarMenuBadge, SidebarProvider } from "@/components/ui/sidebar";
import { NavMain } from "./nav-main";

const { pathnameMock } = vi.hoisted(() => ({
	pathnameMock: vi.fn(() => "/"),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	usePathname: () => pathnameMock(),
}));

vi.mock("@/hooks/use-mobile", () => ({
	useIsMobile: () => false,
}));

describe("NavMain", () => {
	beforeEach(() => {
		pathnameMock.mockReturnValue("/");
	});

	it("marks nested route parent links as active", () => {
		pathnameMock.mockReturnValue("/team/absences");

		render(
			<SidebarProvider>
				<NavMain
					items={[
						{ title: "Dashboard", url: "/", icon: IconDashboard },
						{ title: "Team", url: "/team", icon: IconUsers },
					]}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("link", { name: "Team" }).getAttribute("data-active")).toBe("true");
		expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("data-active")).toBe(
			"false",
		);
	});

	it("marks the dashboard link active only on the exact root route", () => {
		pathnameMock.mockReturnValue("/time-tracking");

		render(
			<SidebarProvider>
				<NavMain
					items={[
						{ title: "Dashboard", url: "/", icon: IconDashboard },
						{ title: "Time Tracking", url: "/time-tracking", icon: IconUsers },
					]}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("data-active")).toBe(
			"false",
		);
		expect(screen.getByRole("link", { name: "Time Tracking" }).getAttribute("data-active")).toBe(
			"true",
		);
	});

	it("marks only the most specific matching link active, and shows an item's badge (#753)", () => {
		pathnameMock.mockReturnValue("/de/travel-expenses/finance");

		render(
			<SidebarProvider>
				<NavMain
					items={[
						{ title: "Travel Expenses", url: "/travel-expenses", icon: IconUsers },
						{
							title: "Finance",
							url: "/travel-expenses/finance",
							icon: IconUsers,
							badge: <SidebarMenuBadge>3</SidebarMenuBadge>,
						},
					]}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("link", { name: "Finance" }).getAttribute("data-active")).toBe("true");
		expect(screen.getByRole("link", { name: "Travel Expenses" }).getAttribute("data-active")).toBe(
			"false",
		);
		expect(screen.getByText("3").closest("[data-sidebar='menu-badge']")).toBeTruthy();
	});
});
