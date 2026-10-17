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

import { WorkPolicySettingsTabs } from "./work-policy-settings-tabs";

const panels = {
	work: <input aria-label="Work policy draft" defaultValue="" />,
	changes: <p>Change policy views</p>,
};
beforeEach(() => {
	window.history.replaceState(null, "", "/en/settings/work-policies");
});
afterEach(cleanup);
describe("combined Work Policies tabs", () => {
	it("opens work policies without mounting change policies", () => {
		render(<WorkPolicySettingsTabs panels={panels} />);
		expect(
			screen
				.getByRole("tab", { name: "Work Policies" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByLabelText("Work policy draft")).toBeTruthy();
		expect(screen.queryByText("Change policy views")).toBeNull();
	});
	it("opens a direct link to Change Policies", () => {
		window.history.replaceState(
			null,
			"",
			"/en/settings/work-policies?tab=changes",
		);
		render(<WorkPolicySettingsTabs panels={panels} />);
		expect(
			screen
				.getByRole("tab", { name: "Change Policies" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByRole("tabpanel").textContent).toBe(
			"Change policy views",
		);
		expect(screen.queryByLabelText("Work policy draft")).toBeNull();
	});
	it("falls back to work policies for an unknown tab", () => {
		window.history.replaceState(
			null,
			"",
			"/en/settings/work-policies?tab=unknown",
		);
		render(<WorkPolicySettingsTabs panels={panels} />);
		expect(screen.getByLabelText("Work policy draft")).toBeTruthy();
	});
	it("preserves unfinished edits, the locale and other URL state while switching views", async () => {
		window.history.replaceState(
			null,
			"",
			"/de/settings/work-policies?from=setup#details",
		);
		render(<WorkPolicySettingsTabs panels={panels} />);
		fireEvent.change(screen.getByLabelText("Work policy draft"), {
			target: { value: "Unsaved rule" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Change Policies" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe(
				"Change policy views",
			),
		);
		expect(window.location.pathname).toBe("/de/settings/work-policies");
		expect(window.location.hash).toBe("#details");
		expect(new URLSearchParams(window.location.search).get("from")).toBe(
			"setup",
		);
		expect(new URLSearchParams(window.location.search).get("tab")).toBe(
			"changes",
		);
		fireEvent.click(screen.getByRole("tab", { name: "Work Policies" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe(
				"Unsaved rule",
			),
		);
	});
});
