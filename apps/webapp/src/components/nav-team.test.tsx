/* @vitest-environment jsdom */

import { IconBeach, IconUsers } from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NavTeam } from "./nav-team";

const { pathnameMock } = vi.hoisted(() => ({
	pathnameMock: vi.fn(() => "/"),
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
	useIsMobile: () => false,
}));

describe("NavTeam", () => {
	beforeEach(() => {
		pathnameMock.mockReturnValue("/");
	});

	it("marks the matching nested team route active", () => {
		pathnameMock.mockReturnValue("/team/absences/pending");

		render(
			<SidebarProvider>
				<NavTeam
					items={[
						{ title: "Team", url: "/team", icon: IconUsers },
						{ title: "Team Absences", url: "/team/absences", icon: IconBeach },
					]}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByRole("link", { name: "Team Absences" }).getAttribute("data-active")).toBe(
			"true",
		);
		expect(screen.getByRole("link", { name: "Team" }).getAttribute("data-active")).toBe("true");
	});
});
