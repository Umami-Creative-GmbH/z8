/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const { location } = vi.hoisted(() => ({
	location: { pathname: "/analytics/overtime-burn-down" },
}));
vi.mock("@/navigation", () => ({ usePathname: () => location.pathname }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { AnalyticsHeading } from "./analytics-heading";

it.each(["admitted", "pending", "restricted", "no employee"])(
	"keeps one task title in the layout's %s presentation",
	(arrival) => {
		location.pathname = "/analytics/overtime-burn-down";
		render(
			<AnalyticsHeading
				title="Analytics"
				description={arrival === "admitted" ? "Analytics context" : undefined}
			/>,
		);
		expect(
			screen.getAllByRole("heading", { level: 1 }).map((n) => n.textContent),
		).toEqual(["Overtime Burn-Down"]);
		expect(screen.getByText("Analytics")).toBeTruthy();
	},
);
it.each(["/analytics", "/analytics/vacation-trends"])(
	"retains staged parent heading at %s",
	(pathname) => {
		location.pathname = pathname;
		render(
			<AnalyticsHeading title="Analytics" description="Original context" />,
		);
		expect(
			screen.getAllByRole("heading", { level: 1 }).map((n) => n.textContent),
		).toEqual(["Analytics"]);
		expect(screen.getByText("Original context")).toBeTruthy();
	},
);

it.each(["admitted", "pending", "restricted", "no employee"])(
	"names the team comparison in %s arrival",
	(arrival) => {
		location.pathname = "/de/analytics/team-performance";
		render(
			<AnalyticsHeading
				title="Analytics"
				description={arrival === "admitted" ? "Analytics context" : undefined}
			/>,
		);
		expect(
			screen.getAllByRole("heading", { level: 1 }).map((n) => n.textContent),
		).toEqual(["Team Performance"]);
	},
);

it.each(["admitted", "pending", "restricted", "no employee"])(
	"names work hours in %s arrival",
	(arrival) => {
		location.pathname = "/de/analytics/work-hours";
		render(
			<AnalyticsHeading
				title="Analytics"
				description={arrival === "admitted" ? "Original context" : undefined}
			/>,
		);
		expect(
			screen.getAllByRole("heading", { level: 1 }).map((n) => n.textContent),
		).toEqual(["Work Hours"]);
	},
);
