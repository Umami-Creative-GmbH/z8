/* @vitest-environment jsdom */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (
		...args: Parameters<History["replaceState"]>
	) => {
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

import { VehicleSettingsTabs } from "./vehicle-settings-tabs";

const panels = {
	vehicles: <input aria-label="Vehicle draft" defaultValue="" />,
	use: <p>Recording controls</p>,
	assignments: <p>Assignment controls</p>,
};
beforeEach(() => {
	window.history.replaceState(null, "", "/en/settings/vehicles");
});
afterEach(cleanup);
describe("combined Vehicles settings tabs", () => {
	it("opens vehicle management without mounting the other panels", () => {
		render(<VehicleSettingsTabs panels={panels} />);
		expect(
			screen
				.getByRole("tab", { name: "Vehicles" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.queryByText("Recording controls")).toBeNull();
		expect(screen.queryByText("Assignment controls")).toBeNull();
	});
	it.each(["use", "assignments"] as const)(
		"opens a direct link to %s",
		(tab) => {
			window.history.replaceState(null, "", `/en/settings/vehicles?tab=${tab}`);
			render(<VehicleSettingsTabs panels={panels} />);
			expect(screen.getByRole("tabpanel").textContent).toBe(
				panels[tab].props.children,
			);
			expect(screen.queryByLabelText("Vehicle draft")).toBeNull();
		},
	);
	it("falls back to Vehicles for an unknown tab", () => {
		window.history.replaceState(null, "", "/en/settings/vehicles?tab=unknown");
		render(<VehicleSettingsTabs panels={panels} />);
		expect(screen.getByLabelText("Vehicle draft")).toBeTruthy();
	});
	it("keeps unfinished edits and other URL state when tabs change", async () => {
		window.history.replaceState(
			null,
			"",
			"/de/settings/vehicles?from=setup#details",
		);
		render(<VehicleSettingsTabs panels={panels} />);
		fireEvent.change(screen.getByLabelText("Vehicle draft"), {
			target: { value: "Unsaved vehicle" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Vehicle use" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe(
				"Recording controls",
			),
		);
		expect(window.location.pathname).toBe("/de/settings/vehicles");
		expect(window.location.hash).toBe("#details");
		expect(new URLSearchParams(window.location.search).get("from")).toBe(
			"setup",
		);
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("use");
		fireEvent.click(screen.getByRole("tab", { name: "Vehicles" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe(
				"Unsaved vehicle",
			),
		);
	});
});
