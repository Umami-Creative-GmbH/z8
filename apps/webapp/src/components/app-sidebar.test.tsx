/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IconShieldCheck } from "@tabler/icons-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navSecondarySpy } = vi.hoisted(() => ({
	navSecondarySpy: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: null,
		isPending: false,
	}),
}));

vi.mock("@/components/nav-main", () => ({
	NavMain: () => <div data-testid="nav-main" />,
}));

vi.mock("@/components/nav-team", () => ({
	NavTeam: () => <div data-testid="nav-team" />,
}));

vi.mock("@/components/nav-user", () => ({
	NavUser: () => <div data-testid="nav-user" />,
}));

vi.mock("@/components/organization-switcher", () => ({
	OrganizationSwitcher: () => <div data-testid="organization-switcher" />,
}));

vi.mock("@/components/nav-secondary", () => ({
	NavSecondary: ({ items }: { items: Array<{ title: string; url: string; icon: unknown }> }) => {
		navSecondarySpy(items);

		return (
			<nav>
				{items.map((item) => (
					<a href={item.url} key={item.url}>
						{item.title}
					</a>
				))}
			</nav>
		);
	},
}));

vi.mock("@/components/ui/sidebar", () => ({
	Sidebar: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
	SidebarContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SidebarFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SidebarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { AppSidebar } from "./app-sidebar";

describe("app sidebar compliance navigation", () => {
	beforeEach(() => {
		navSecondarySpy.mockClear();
	});

	it("renders the compliance entry in secondary nav only when enabled", () => {
		const { rerender } = render(<AppSidebar showComplianceNav />);

		expect(screen.getByRole("link", { name: "Compliance" }).getAttribute("href")).toBe(
			"/compliance",
		);
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Compliance",
					url: "/compliance",
					icon: IconShieldCheck,
				}),
			]),
		);

		rerender(<AppSidebar showComplianceNav={false} />);

		expect(screen.queryByRole("link", { name: "Compliance" })).toBeNull();
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.not.arrayContaining([
				expect.objectContaining({
					url: "/compliance",
					icon: IconShieldCheck,
				}),
			]),
		);
	});

	it("keeps the server sidebar wiring gated by the org-admin settings tier", () => {
		const serverSidebarSource = readFileSync(
			join(process.cwd(), "src/components/server-app-sidebar.tsx"),
			"utf8",
		);

		expect(serverSidebarSource).toContain("getCurrentSettingsAccessTier");
		expect(serverSidebarSource).toContain('showComplianceNav={settingsAccessTier === "orgAdmin"}');
	});
});
