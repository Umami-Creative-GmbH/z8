/* @vitest-environment jsdom */

import { IconHelp } from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NavSecondary } from "./nav-secondary";

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

describe("NavSecondary", () => {
	beforeEach(() => {
		pathnameMock.mockReturnValue("/");
	});

	it("opens external items in a new tab and marks them with an external-link icon", () => {
		render(
			<SidebarProvider>
				<NavSecondary
					items={[
						{
							title: "Get Help",
							url: "https://docs.z8-time.app/docs",
							icon: IconHelp,
							external: true,
						},
					]}
				/>
			</SidebarProvider>,
		);

		const helpLink = screen.getByRole("link", { name: "Get Help" });

		expect(helpLink.getAttribute("href")).toBe("https://docs.z8-time.app/docs");
		expect(helpLink.getAttribute("target")).toBe("_blank");
		expect(helpLink.getAttribute("rel")).toBe("noreferrer");
		expect(helpLink.querySelector("[data-testid='external-link-icon']")).not.toBeNull();
	});

	it("marks matching internal secondary routes active", () => {
		pathnameMock.mockReturnValue("/settings/profile");

		render(
			<SidebarProvider>
				<NavSecondary
					items={[
						{
							title: "Settings",
							url: "/settings",
							icon: IconHelp,
						},
						{
							title: "Get Help",
							url: "https://docs.z8-time.app/docs",
							icon: IconHelp,
							external: true,
						},
					]}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("link", { name: "Settings" }).getAttribute("data-active")).toBe("true");
		expect(screen.getByRole("link", { name: "Get Help" }).getAttribute("data-active")).toBe(
			"false",
		);
	});
});
