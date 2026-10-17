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

import { ApprovalSettingsTabs } from "./approval-settings-tabs";

const panels = {
	policies: <input aria-label="Policy draft" defaultValue="" />,
	groups: <p>Employee groups panel</p>,
	escalation: <p>Escalation panel</p>,
	attention: <p>Attention panel</p>,
	channels: <p>Channels panel</p>,
	history: <p>History panel</p>,
};

beforeEach(() => {
	window.history.replaceState(null, "", "/en/settings/approval-policies");
});
afterEach(cleanup);

describe("Approval settings tabs", () => {
	it("opens approval policies and defers the other panels", () => {
		render(<ApprovalSettingsTabs panels={panels} />);
		expect(
			screen
				.getByRole("tab", { name: "Approval Policies" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByLabelText("Policy draft")).toBeTruthy();
		expect(screen.queryByText("Escalation panel")).toBeNull();
		expect(screen.queryByText("Employee groups panel")).toBeNull();
	});
	it.each([
		"groups",
		"escalation",
		"attention",
		"channels",
		"history",
	] as const)("opens a direct link to %s", (tab) => {
		window.history.replaceState(
			null,
			"",
			`/en/settings/approval-policies?tab=${tab}`,
		);
		render(<ApprovalSettingsTabs panels={panels} />);
		expect(screen.getByRole("tabpanel").textContent).toBe(
			panels[tab].props.children,
		);
		expect(screen.queryByLabelText("Policy draft")).toBeNull();
	});
	it("falls back to the first authorized tab for unknown or unavailable tabs", () => {
		window.history.replaceState(
			null,
			"",
			"/en/settings/approval-policies?tab=policies",
		);
		render(
			<ApprovalSettingsTabs
				panels={{ escalation: panels.escalation, attention: panels.attention }}
			/>,
		);
		expect(screen.getByRole("tabpanel").textContent).toBe("Escalation panel");
		expect(screen.queryByRole("tab", { name: "Approval Policies" })).toBeNull();
	});
	it("retains unsaved edits, the locale, unrelated search params and hash on tab changes", async () => {
		window.history.replaceState(
			null,
			"",
			"/de/settings/approval-policies?from=setup#details",
		);
		render(<ApprovalSettingsTabs panels={panels} />);
		fireEvent.change(screen.getByLabelText("Policy draft"), {
			target: { value: "Unsaved policy" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Employee Groups" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe(
				"Employee groups panel",
			),
		);
		expect(window.location.pathname).toBe("/de/settings/approval-policies");
		expect(window.location.hash).toBe("#details");
		expect(new URLSearchParams(window.location.search).get("from")).toBe(
			"setup",
		);
		expect(new URLSearchParams(window.location.search).get("tab")).toBe(
			"groups",
		);
		fireEvent.click(screen.getByRole("tab", { name: "Approval Policies" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe(
				"Unsaved policy",
			),
		);
	});
});
