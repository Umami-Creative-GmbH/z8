/* @vitest-environment jsdom */

import { IconBeach, IconMapPin, IconUsers } from "@tabler/icons-react";
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

	function renderTeamNav() {
		render(
			<SidebarProvider>
				<NavTeam
					items={[
						{ title: "Team", url: "/team", icon: IconUsers },
						{ title: "Team Absences", url: "/team/absences", icon: IconBeach },
						{ title: "Presence", url: "/team/presence", icon: IconMapPin },
					]}
				/>
			</SidebarProvider>,
		);
	}

	function activeState(name: string) {
		return screen.getByRole("link", { name }).getAttribute("data-active");
	}

	it.each([
		["/team/absences/pending", "Team Absences"],
		["/team/presence", "Presence"],
		["/team/presence/location-1", "Presence"],
	])("marks only the most specific item active on %s", (pathname, activeName) => {
		pathnameMock.mockReturnValue(pathname);

		renderTeamNav();

		for (const name of ["Team", "Team Absences", "Presence"]) {
			expect(activeState(name)).toBe(name === activeName ? "true" : "false");
		}
	});

	it("keeps the team overview active on its own nested routes", () => {
		pathnameMock.mockReturnValue("/team/members");

		renderTeamNav();

		expect(activeState("Team")).toBe("true");
		expect(activeState("Team Absences")).toBe("false");
		expect(activeState("Presence")).toBe("false");
	});
});
