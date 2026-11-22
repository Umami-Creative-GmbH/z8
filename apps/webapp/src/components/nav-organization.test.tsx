/* @vitest-environment jsdom */

import { IconLicense, IconReceipt, IconReportMoney, IconUsers } from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarMenuBadge, SidebarProvider } from "@/components/ui/sidebar";
import { NavMain } from "./nav-main";
import { NavOrganization } from "./nav-organization";
import { NavTeam } from "./nav-team";

const { pathnameMock, isMobileMock } = vi.hoisted(() => ({
	pathnameMock: vi.fn(() => "/"),
	isMobileMock: vi.fn(() => false),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
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
	useIsMobile: () => isMobileMock(),
}));

describe("NavOrganization and cross-section active state (#1953)", () => {
	beforeEach(() => {
		pathnameMock.mockReturnValue("/");
		isMobileMock.mockReturnValue(false);
	});

	it("renders Organization landmark, items, accessible names, and Expense Finance badge", () => {
		render(
			<SidebarProvider defaultOpen={false}>
				<NavOrganization
					items={[
						{
							title: "Expense Finance",
							url: "/travel-expenses/finance",
							icon: IconReportMoney,
							badge: <SidebarMenuBadge>4</SidebarMenuBadge>,
						},
						{
							title: "Driving licences",
							url: "/team/driving-licence",
							icon: IconLicense,
						},
					]}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("navigation", { name: "Organization" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Expense Finance" }).getAttribute("href")).toBe(
			"/travel-expenses/finance",
		);
		expect(screen.getByRole("link", { name: "Driving licences" }).getAttribute("href")).toBe(
			"/team/driving-licence",
		);
		expect(screen.getByText("4").closest("[data-sidebar='menu-badge']")).toBeTruthy();
	});

	it("marks only the most specific destination active across split-pair sections", () => {
		const allNavHrefs = [
			"/travel-expenses",
			"/team",
			"/travel-expenses/finance",
			"/team/driving-licence",
		];

		pathnameMock.mockReturnValue("/de/travel-expenses/finance");
		const { unmount } = render(
			<SidebarProvider>
				<NavMain
					label="Workplace"
					items={[{ title: "Travel Expenses", url: "/travel-expenses", icon: IconReceipt }]}
					allNavHrefs={allNavHrefs}
				/>
				<NavTeam
					items={[{ title: "Team", url: "/team", icon: IconUsers }]}
					allNavHrefs={allNavHrefs}
				/>
				<NavOrganization
					items={[
						{ title: "Expense Finance", url: "/travel-expenses/finance", icon: IconReportMoney },
						{ title: "Driving licences", url: "/team/driving-licence", icon: IconLicense },
					]}
					allNavHrefs={allNavHrefs}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("link", { name: "Expense Finance" }).getAttribute("data-active")).toBe(
			"true",
		);
		expect(screen.getByRole("link", { name: "Travel Expenses" }).getAttribute("data-active")).toBe(
			"false",
		);
		unmount();

		pathnameMock.mockReturnValue("/en/team/driving-licence/emp-1");
		render(
			<SidebarProvider>
				<NavMain
					label="Workplace"
					items={[{ title: "Travel Expenses", url: "/travel-expenses", icon: IconReceipt }]}
					allNavHrefs={allNavHrefs}
				/>
				<NavTeam
					items={[{ title: "Team", url: "/team", icon: IconUsers }]}
					allNavHrefs={allNavHrefs}
				/>
				<NavOrganization
					items={[
						{ title: "Expense Finance", url: "/travel-expenses/finance", icon: IconReportMoney },
						{ title: "Driving licences", url: "/team/driving-licence", icon: IconLicense },
					]}
					allNavHrefs={allNavHrefs}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("link", { name: "Driving licences" }).getAttribute("data-active")).toBe(
			"true",
		);
		expect(screen.getByRole("link", { name: "Team" }).getAttribute("data-active")).toBe("false");
	});
});
