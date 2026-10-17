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

import { AbsenceSettingsTabs } from "./absence-settings-tabs";

const panels = {
	vacation: <input aria-label="Absence draft" defaultValue="" />,
	holidays: <p>Holiday views</p>,
};
beforeEach(() => {
	window.history.replaceState(null, "", "/en/settings/vacation");
});
afterEach(cleanup);
describe("combined Absences tabs", () => {
	it("opens vacation without mounting holidays", () => {
		render(<AbsenceSettingsTabs panels={panels} />);
		expect(
			screen
				.getByRole("tab", { name: "Vacation" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByLabelText("Absence draft")).toBeTruthy();
		expect(screen.queryByText("Holiday views")).toBeNull();
	});
	it("opens a direct link to Holidays", () => {
		window.history.replaceState(null, "", "/en/settings/vacation?tab=holidays");
		render(<AbsenceSettingsTabs panels={panels} />);
		expect(
			screen
				.getByRole("tab", { name: "Holidays" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByRole("tabpanel").textContent).toBe("Holiday views");
		expect(screen.queryByLabelText("Absence draft")).toBeNull();
	});
	it("falls back to vacation for an unknown tab", () => {
		window.history.replaceState(null, "", "/en/settings/vacation?tab=unknown");
		render(<AbsenceSettingsTabs panels={panels} />);
		expect(screen.getByLabelText("Absence draft")).toBeTruthy();
	});
	it("preserves unfinished edits, the locale and other URL state while switching views", async () => {
		window.history.replaceState(
			null,
			"",
			"/de/settings/vacation?from=setup#details",
		);
		render(<AbsenceSettingsTabs panels={panels} />);
		fireEvent.change(screen.getByLabelText("Absence draft"), {
			target: { value: "Unsaved absence rule" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Holidays" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe("Holiday views"),
		);
		expect(window.location.pathname).toBe("/de/settings/vacation");
		expect(window.location.hash).toBe("#details");
		expect(new URLSearchParams(window.location.search).get("from")).toBe(
			"setup",
		);
		expect(new URLSearchParams(window.location.search).get("tab")).toBe(
			"holidays",
		);
		fireEvent.click(screen.getByRole("tab", { name: "Vacation" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe(
				"Unsaved absence rule",
			),
		);
	});
});
