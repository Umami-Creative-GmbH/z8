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

import { DrivingLicenceRoleTabs } from "./role-tabs";

const panels = {
	myLicence: <p>Own licence content</p>,
	checks: <p>Checks content</p>,
	planning: <p>Planning content</p>,
};
const none = { myLicence: false, checks: false, planning: false };

beforeEach(() => {
	window.history.replaceState(null, "", "/en/driving-licence");
});
afterEach(cleanup);

describe("driving licence role tabs", () => {
	it("shows one tab per role the user holds, starting with the first", () => {
		render(
			<DrivingLicenceRoleTabs
				roles={{ myLicence: true, checks: true, planning: true }}
				panels={panels}
			/>,
		);
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"My licence",
			"Checks",
			"Planning",
		]);
		expect(screen.getByRole("tabpanel").textContent).toBe("Own licence content");
		expect(screen.queryByText("Checks content")).toBeNull();
	});

	it("offers only the tabs of the roles held", () => {
		render(
			<DrivingLicenceRoleTabs
				roles={{ myLicence: false, checks: true, planning: true }}
				panels={panels}
			/>,
		);
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Checks",
			"Planning",
		]);
		expect(screen.queryByText("Own licence content")).toBeNull();
	});

	it.each([
		["myLicence", "Own licence content"],
		["checks", "Checks content"],
		["planning", "Planning content"],
	] as const)("shows a single %s role without a tab bar", (role, content) => {
		render(<DrivingLicenceRoleTabs roles={{ ...none, [role]: true }} panels={panels} />);
		expect(screen.queryByRole("tablist")).toBeNull();
		expect(screen.getByText(content)).toBeTruthy();
		expect(screen.getByRole("heading", { level: 1, name: "Driving licence" })).toBeTruthy();
	});

	it("opens a linked tab and keeps the selection in the address", () => {
		window.history.replaceState(null, "", "/en/driving-licence?tab=planning");
		render(
			<DrivingLicenceRoleTabs
				roles={{ myLicence: true, checks: true, planning: true }}
				panels={panels}
			/>,
		);
		expect(screen.getByRole("tabpanel").textContent).toBe("Planning content");
		fireEvent.click(screen.getByRole("tab", { name: "Checks" }));
		expect(window.location.search).toBe("?tab=checks");
		expect(screen.getByText("Checks content")).toBeTruthy();
	});

	it("ignores a link to a tab the user doesn't hold", () => {
		window.history.replaceState(null, "", "/en/driving-licence?tab=checks");
		render(
			<DrivingLicenceRoleTabs
				roles={{ myLicence: true, checks: false, planning: true }}
				panels={panels}
			/>,
		);
		expect(screen.getByRole("tabpanel").textContent).toBe("Own licence content");
		expect(screen.queryByText("Checks content")).toBeNull();
	});
});
