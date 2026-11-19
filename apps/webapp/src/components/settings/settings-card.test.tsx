/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsCard } from "./settings-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const shiftPlanning = {
	title: "Shift Planning",
	description: "Configure shift templates and coverage targets",
	href: "/settings/shifts",
	icon: "calendar-clock",
	requiredFeature: "shiftsEnabled",
} as const;

describe("SettingsCard", () => {
	it("links the whole card to an available setting", () => {
		render(<SettingsCard {...shiftPlanning} />);

		expect(screen.getByRole("link").getAttribute("href")).toBe("/settings/shifts");
	});

	it("explains a feature switched off and links admins to its switch", () => {
		render(<SettingsCard {...shiftPlanning} disabled canChangeFeatures />);

		expect(screen.getByText("Disabled")).toBeTruthy();
		expect(screen.getByText("Turned off for this organization")).toBeTruthy();
		// The switch link is the card's only interactive element.
		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(1);
		expect(links[0].getAttribute("href")).toBe("/settings/organization#shifts-toggle");
		expect(
			screen.getByRole("link", {
				name: "Turn on in Organization settings (Shift Planning)",
			}),
		).toBeTruthy();
		expect(screen.queryByText("Ask an organization admin to turn this on.")).toBeNull();
	});

	it("tells viewers who cannot switch features to ask an organization admin", () => {
		render(<SettingsCard {...shiftPlanning} disabled />);

		expect(screen.getByText("Turned off for this organization")).toBeTruthy();
		expect(screen.getByText("Ask an organization admin to turn this on.")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});
});
