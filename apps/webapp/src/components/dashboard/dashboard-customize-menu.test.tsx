/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardCustomizeMenu } from "./dashboard-customize-menu";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

describe("DashboardCustomizeMenu", () => {
	it("renders an icon-only accessible trigger", () => {
		render(
			<DashboardCustomizeMenu hiddenWidgets={[]} onReset={vi.fn()} onVisibilityChange={vi.fn()} />,
		);

		const trigger = screen.getByRole("button", { name: "Customize dashboard" });
		expect(trigger).toBeTruthy();
		expect(trigger.textContent).toBe("");
	});

	it("calls visibility changes from widget rows", () => {
		const onVisibilityChange = vi.fn();

		render(
			<DashboardCustomizeMenu
				hiddenWidgets={["quick-stats"]}
				onReset={vi.fn()}
				onVisibilityChange={onVisibilityChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Customize dashboard" }));
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Time Tracking" }));

		expect(onVisibilityChange).toHaveBeenCalledWith("quick-stats", true);
	});

	it("calls reset from the reset menu item", () => {
		const onReset = vi.fn();

		render(
			<DashboardCustomizeMenu hiddenWidgets={[]} onReset={onReset} onVisibilityChange={vi.fn()} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Customize dashboard" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Reset layout" }));

		expect(onReset).toHaveBeenCalledTimes(1);
	});
});
