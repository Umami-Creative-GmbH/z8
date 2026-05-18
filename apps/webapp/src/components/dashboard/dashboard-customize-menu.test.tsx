/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardCustomizeMenu } from "./dashboard-customize-menu";
import { DEFAULT_WIDGET_ORDER, type WidgetId } from "./widget-registry";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string>) =>
			values?.widget ? fallback.replace("{widget}", values.widget) : fallback,
	}),
}));

const visibleWidgetOrder: WidgetId[] = ["quick-stats", "presence-status", "vacation-balance"];

function renderMenu(props: Partial<React.ComponentProps<typeof DashboardCustomizeMenu>> = {}) {
	return render(
		<DashboardCustomizeMenu
			hiddenWidgets={[]}
			onReorder={vi.fn()}
			onReset={vi.fn()}
			onVisibilityChange={vi.fn()}
			visibleWidgetOrder={visibleWidgetOrder}
			{...props}
		/>,
	);
}

function openMenu() {
	fireEvent.pointerDown(screen.getByRole("button", { name: "Customize dashboard" }));
}

describe("DashboardCustomizeMenu", () => {
	it("renders an icon-only accessible trigger", () => {
		renderMenu();

		const trigger = screen.getByRole("button", { name: "Customize dashboard" });
		expect(trigger).toBeTruthy();
		expect(trigger.textContent).toBe("");
	});

	it("calls visibility changes from widget rows", () => {
		const onVisibilityChange = vi.fn();

		renderMenu({ hiddenWidgets: ["quick-stats"], onVisibilityChange });

		openMenu();
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Time Tracking" }));

		expect(onVisibilityChange).toHaveBeenCalledWith("quick-stats", true);
	});

	it("calls reset from the reset menu item", () => {
		const onReset = vi.fn();

		renderMenu({ onReset });

		openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Reset layout" }));

		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it("moves a visible widget up", () => {
		const onReorder = vi.fn();

		renderMenu({ onReorder });

		openMenu();
		const row = screen.getByTestId("dashboard-widget-menu-row-presence-status");
		fireEvent.click(within(row).getByRole("button", { name: "Move Presence Status up" }));

		expect(onReorder).toHaveBeenCalledWith(["presence-status", "quick-stats", "vacation-balance"]);
	});

	it("moves a visible widget down", () => {
		const onReorder = vi.fn();

		renderMenu({ onReorder });

		openMenu();
		const row = screen.getByTestId("dashboard-widget-menu-row-presence-status");
		fireEvent.click(within(row).getByRole("button", { name: "Move Presence Status down" }));

		expect(onReorder).toHaveBeenCalledWith(["quick-stats", "vacation-balance", "presence-status"]);
	});

	it("disables invalid first and last visible widget moves", () => {
		renderMenu();

		openMenu();
		const firstRow = screen.getByTestId("dashboard-widget-menu-row-quick-stats");
		const lastRow = screen.getByTestId("dashboard-widget-menu-row-vacation-balance");

		expect(
			(within(firstRow).getByRole("button", { name: "Move Time Tracking up" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(
				within(lastRow).getByRole("button", {
					name: "Move Vacation Balance down",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("keeps hidden widgets toggleable without active reorder controls", () => {
		renderMenu({ hiddenWidgets: ["quick-stats"] });

		openMenu();
		const hiddenRow = screen.getByTestId("dashboard-widget-menu-row-quick-stats");

		expect(screen.getByRole("menuitemcheckbox", { name: "Time Tracking" })).toBeTruthy();
		expect(within(hiddenRow).queryByRole("button", { name: "Move Time Tracking up" })).toBeNull();
		expect(within(hiddenRow).queryByRole("button", { name: "Move Time Tracking down" })).toBeNull();
	});

	it("reorders any visible widget list passed to the menu", () => {
		const onReorder = vi.fn();

		renderMenu({ onReorder, visibleWidgetOrder: DEFAULT_WIDGET_ORDER.slice(0, 3) });

		openMenu();
		const row = screen.getByTestId("dashboard-widget-menu-row-managed-employees");
		fireEvent.click(within(row).getByRole("button", { name: "Move Managed Employees up" }));

		expect(onReorder).toHaveBeenCalledWith([
			"managed-employees",
			"manager-today",
			"pending-approvals",
		]);
	});
});
