/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsTabbedPage } from "./settings-tabbed-page";

let search = "";
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(search),
}));

function renderPage() {
	return render(
		<SettingsTabbedPage
			title="Audit"
			defaultTab="activity"
			tabs={[
				{
					value: "activity",
					label: "Activity",
					description: "Every action in the organization",
					panel: <table aria-label="Activity log" />,
				},
				{
					value: "config",
					label: "Configuration",
					description: "Export hardening",
					measure: true,
					panel: <form aria-label="Audit configuration" />,
				},
			]}
		/>,
	);
}

describe("SettingsTabbedPage", () => {
	it("leaves a table panel the full page frame", () => {
		search = "";
		const { container } = renderPage();

		expect(container.firstElementChild?.className).toContain("page-frame");
		const activityPanel = screen.getByRole("table", { name: "Activity log" }).parentElement;
		expect(activityPanel?.className).not.toContain("page-measure");
		expect(screen.getByRole("heading", { level: 1, name: "Audit" })).toBeTruthy();
	});

	it("bounds a measured form panel at the settings measure", () => {
		search = "tab=config";
		renderPage();

		const configPanel = screen.getByRole("form", { name: "Audit configuration" }).parentElement;
		expect(configPanel?.className).toContain("page-measure");
	});
});
