/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const { location } = vi.hoisted(() => ({
	location: { pathname: "/analytics" },
}));
vi.mock("@/navigation", () => ({ usePathname: () => location.pathname }));

import { AnalyticsTabs } from "./analytics-tabs";

const destinations = [
	["/analytics", "overview", "Overview"],
	["/analytics/team-performance", "team-performance", "Team Performance"],
	["/analytics/work-hours", "work-hours", "Work Hours"],
	["/analytics/overtime-burn-down", "overtime-burn-down", "Overtime Burn-Down"],
	["/analytics/vacation-trends", "vacation-trends", "Absences & Vacation"],
];

function Navigation() {
	return (
		<AnalyticsTabs>
			<TabsList>
				{destinations.map(([href, value, label]) => (
					<TabsTrigger key={href} value={value} asChild>
						<a href={href}>{label}</a>
					</TabsTrigger>
				))}
			</TabsList>
		</AnalyticsTabs>
	);
}

it.each(destinations)(
	"marks the current destination on direct arrival at %s",
	(pathname, _value, label) => {
		location.pathname = pathname;
		render(<Navigation />);
		expect(
			screen
				.getAllByRole("tab", { selected: true })
				.map((element) => element.textContent),
		).toEqual([label]);
		expect(screen.getByRole("tab", { name: label }).getAttribute("href")).toBe(
			pathname,
		);
	},
);

it("updates the current destination after client navigation and returning to overview", () => {
	location.pathname = "/analytics";
	const view = render(<Navigation />);
	location.pathname = "/analytics/overtime-burn-down";
	view.rerender(<Navigation />);
	expect(
		screen
			.getByRole("tab", { name: "Overtime Burn-Down" })
			.getAttribute("aria-selected"),
	).toBe("true");
	location.pathname = "/analytics";
	view.rerender(<Navigation />);
	expect(
		screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
	).toBe("true");
});
