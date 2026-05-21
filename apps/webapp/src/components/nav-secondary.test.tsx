/* @vitest-environment jsdom */

import { IconHelp } from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NavSecondary } from "./nav-secondary";

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/hooks/use-mobile", () => ({
	useIsMobile: () => false,
}));

describe("NavSecondary", () => {
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
});
