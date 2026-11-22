/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTabbedPage } from "./settings-tabbed-page";

vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(
				useSyncExternalStore(
					(listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					() => window.location.search,
				),
			),
	};
});

function renderAuditPage() {
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

beforeEach(() => {
	window.history.replaceState(null, "", "/en/settings/audit");
});

afterEach(() => {
	cleanup();
});

describe("SettingsTabbedPage", () => {
	it("leaves a table panel the full page frame", () => {
		const { container } = renderAuditPage();

		expect(container.firstElementChild?.className).toContain("page-frame");
		const activityPanel = screen.getByRole("table", { name: "Activity log" }).parentElement;
		expect(activityPanel?.className).not.toContain("page-measure");
		expect(screen.getByRole("heading", { level: 1, name: "Audit" })).toBeTruthy();
		expect(screen.getByText("Every action in the organization")).toBeTruthy();
	});

	it("bounds a measured form panel at the settings measure", () => {
		window.history.replaceState(null, "", "/en/settings/audit?tab=config");
		renderAuditPage();

		const configPanel = screen.getByRole("form", { name: "Audit configuration" }).parentElement;
		expect(configPanel?.className).toContain("page-measure");
		expect(screen.getByText("Export hardening")).toBeTruthy();
	});

	it("supports page-level measure framing and shared description with per-tab overrides", async () => {
		const { container } = render(
			<SettingsTabbedPage
				title="Approval"
				description="Shared approval settings description"
				measure
				defaultTab="policies"
				tabs={[
					{
						value: "policies",
						label: "Policies",
						panel: <p>Policies body</p>,
					},
					{
						value: "triage",
						label: "Triage",
						description: "Custom triage description",
						panel: <p>Triage body</p>,
					},
				]}
			/>,
		);

		expect(container.querySelector(".page-frame .page-measure")).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.getByText("Shared approval settings description")).toBeTruthy();

		fireEvent.click(screen.getByRole("tab", { name: "Triage" }));
		await waitFor(() => expect(screen.getByText("Custom triage description")).toBeTruthy());
	});

	it("syncs ?tab= via replaceState, preserves other URL state, lazily mounts panels, and keeps visited state", async () => {
		window.history.replaceState(null, "", "/de/settings/vehicles?from=setup#details");
		const replaceStateSpy = vi.spyOn(window.history, "replaceState");

		render(
			<SettingsTabbedPage
				title="Vehicles"
				defaultTab="vehicles"
				tabs={[
					{
						value: "vehicles",
						label: "Vehicles",
						panel: <input aria-label="Vehicle draft" defaultValue="" />,
					},
					{
						value: "use",
						label: "Vehicle use",
						panel: <p>Recording controls</p>,
					},
					{
						value: "assignments",
						label: "Assignments",
						panel: <p>Assignment controls</p>,
					},
				]}
			/>,
		);

		expect(screen.getByLabelText("Vehicle draft")).toBeTruthy();
		expect(screen.queryByText("Recording controls")).toBeNull();
		expect(screen.queryByText("Assignment controls")).toBeNull();

		fireEvent.change(screen.getByLabelText("Vehicle draft"), {
			target: { value: "Fleet van" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Vehicle use" }));

		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe("Recording controls"),
		);
		expect(replaceStateSpy).toHaveBeenCalledWith(
			null,
			"",
			"/de/settings/vehicles?from=setup&tab=use#details",
		);
		expect(screen.queryByText("Assignment controls")).toBeNull();

		fireEvent.click(screen.getByRole("tab", { name: "Vehicles" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe("Fleet van"),
		);
	});

	it("falls back to defaultTab or first visible tab for unknown or hidden tabs", () => {
		window.history.replaceState(null, "", "/en/settings/approval?tab=policies");

		render(
			<SettingsTabbedPage
				title="Approval"
				defaultTab="policies"
				tabs={[
					{
						value: "policies",
						label: "Policies",
						hidden: true,
						panel: <p>Policies body</p>,
					},
					{
						value: "escalation",
						label: "Escalation",
						panel: <p>Escalation body</p>,
					},
					{
						value: "history",
						label: "History",
						panel: <p>History body</p>,
					},
				]}
			/>,
		);

		expect(screen.queryByRole("tab", { name: "Policies" })).toBeNull();
		expect(screen.getByRole("tab", { name: "Escalation" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByRole("tabpanel").textContent).toBe("Escalation body");
	});

	it("falls back to defaultTab when ?tab= does not match any tab", () => {
		window.history.replaceState(null, "", "/en/settings/payroll-export?tab=unknown");

		render(
			<SettingsTabbedPage
				title="Payroll Export"
				defaultTab="datev"
				tabs={[
					{ value: "export", label: "Export", panel: <p>Export form</p> },
					{ value: "datev", label: "DATEV", panel: <p>DATEV form</p> },
				]}
			/>,
		);

		expect(screen.getByRole("tab", { name: "DATEV" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tabpanel").textContent).toBe("DATEV form");
		expect(screen.queryByText("Export form")).toBeNull();
	});

	it("renders numeric and custom tab badges while preserving accessible labels", () => {
		render(
			<SettingsTabbedPage
				title="Travel Expense Policies"
				defaultTab="review"
				tabs={[
					{
						value: "review",
						label: "Review",
						badge: 0,
						panel: <p>Review body</p>,
					},
					{
						value: "exceptions",
						label: "Exceptions",
						badge: 3,
						ariaLabel: "Exceptions, 3 pending",
						panel: <p>Exceptions body</p>,
					},
					{
						value: "access",
						label: "Access",
						badge: 2,
						panel: <p>Access body</p>,
					},
					{
						value: "custom",
						label: "Custom",
						badge: (
							<span data-testid="custom-badge" aria-hidden="true">
								Beta
							</span>
						),
						ariaLabel: "Custom, beta",
						panel: <p>Custom body</p>,
					},
				]}
			/>,
		);

		const reviewTab = screen.getByRole("tab", { name: "Review" });
		expect(reviewTab.textContent).toBe("Review");

		const exceptionsTab = screen.getByRole("tab", { name: "Exceptions, 3 pending" });
		const exceptionsBadge = exceptionsTab.querySelector('[data-slot="badge"]');
		expect(exceptionsBadge?.textContent).toBe("3");
		expect(exceptionsBadge?.getAttribute("aria-hidden")).toBe("true");
		expect(exceptionsBadge?.className).toContain("tabular-nums");

		const accessTab = screen.getByRole("tab", { name: "Access 2" });
		const accessBadge = accessTab.querySelector('[data-slot="badge"]');
		expect(accessBadge?.getAttribute("aria-hidden")).toBeNull();

		const customTab = screen.getByRole("tab", { name: "Custom, beta" });
		expect(customTab.querySelector('[data-testid="custom-badge"]')?.textContent).toBe("Beta");
	});

	it("wraps the tab list in a horizontally scrollable container for narrow screens", () => {
		render(
			<SettingsTabbedPage
				title="Payroll Export"
				defaultTab="export"
				tabs={[
					{ value: "export", label: "Export", panel: <p>Export</p> },
					{ value: "datev", label: "DATEV", panel: <p>DATEV</p> },
					{ value: "history", label: "History", panel: <p>History</p> },
				]}
			/>,
		);

		const tablist = screen.getByRole("tablist", { name: "Payroll Export" });
		expect(tablist.className).toContain("overflow-x-auto");
		expect(tablist.parentElement?.className).toContain("max-w-full");
		expect(tablist.parentElement?.className).toContain("overflow-x-auto");
	});
});
