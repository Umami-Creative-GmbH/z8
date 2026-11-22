/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
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

import { DrivingLicenceTeamTabs } from "./role-tabs";

const panels = {
	checks: <p>Checks content</p>,
	planning: <p>Planning content</p>,
};
const none = { checks: false, planning: false };

beforeEach(() => {
	window.history.replaceState(null, "", "/en/team/driving-licence");
});
afterEach(cleanup);

describe("driving licence team tabs (#1937)", () => {
	it("shows Checks then Planning for a verifier who also plans, opening Checks", () => {
		render(<DrivingLicenceTeamTabs roles={{ checks: true, planning: true }} panels={panels} />);
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Checks",
			"Planning",
		]);
		expect(screen.getByRole("tabpanel").textContent).toBe("Checks content");
		expect(screen.queryByText("Planning content")).toBeNull();
		expect(screen.getByRole("heading", { level: 1, name: "Driving licences" })).toBeTruthy();
	});

	it.each([
		["checks", "Checks content"],
		["planning", "Planning content"],
	] as const)("shows a single %s role without a tab bar", (role, content) => {
		render(<DrivingLicenceTeamTabs roles={{ ...none, [role]: true }} panels={panels} />);
		expect(screen.queryByRole("tablist")).toBeNull();
		expect(screen.getByText(content)).toBeTruthy();
	});

	it("opens a linked tab and keeps the selection in the address", () => {
		window.history.replaceState(null, "", "/en/team/driving-licence?tab=planning");
		render(<DrivingLicenceTeamTabs roles={{ checks: true, planning: true }} panels={panels} />);
		expect(screen.getByRole("tabpanel").textContent).toBe("Planning content");
		fireEvent.click(screen.getByRole("tab", { name: "Checks" }));
		expect(window.location.search).toBe("?tab=checks");
		expect(screen.getByText("Checks content")).toBeTruthy();
	});
});
