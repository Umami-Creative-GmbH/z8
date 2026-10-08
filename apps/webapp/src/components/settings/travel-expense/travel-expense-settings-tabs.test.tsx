/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getForeignDraftExpenses: vi.fn(),
	getAllowanceExceptionItems: vi.fn(),
	getProjectAttributionExceptionSettings: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/conversion-actions", () => ({
	getForeignDraftExpenses: actions.getForeignDraftExpenses,
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions", () => ({
	getAllowanceExceptionItems: actions.getAllowanceExceptionItems,
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/project-exception-actions", () => ({
	getProjectAttributionExceptionSettings: actions.getProjectAttributionExceptionSettings,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
// Next.js syncs `useSearchParams` with `history.replaceState`; the mock does the same.
vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
	};
});

import { TravelExpenseSettingsTabs } from "./travel-expense-settings-tabs";

const foreignItem = (itemId: string, converted: boolean) => ({
	reportId: "6a890000-0000-4000-8000-000000000001",
	itemId,
	itemVersion: 1,
	employeeName: "Ada Lovelace",
	expenseDate: "2026-05-04",
	description: "Taxi",
	amount: "20.00",
	currency: "CHF",
	reimbursementCurrency: "EUR",
	conversion: converted ? { basis: "manual_rate" } : null,
});

const allowanceItem = (itemId: string, overridden: boolean) => ({
	reportId: "6a890000-0000-4000-8000-000000000002",
	itemId,
	itemVersion: 1,
	kind: "mileage",
	employeeName: "Grace Hopper",
	situation: { kind: "no_policy" },
	override: overridden ? { id: `override-${itemId}` } : null,
	ownReport: false,
});

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseSettingsTabs
				review={<p>Review cards</p>}
				currencies={<p>Currency cards</p>}
				rates={<p>Rate cards</p>}
				exceptions={<p>Exception cards</p>}
				access={<p>Access cards</p>}
			/>
		</QueryClientProvider>,
	);
	return client;
}

beforeEach(() => {
	window.history.replaceState(null, "", "/settings/travel-expenses");
	actions.getForeignDraftExpenses.mockResolvedValue({ success: true, data: [] });
	actions.getAllowanceExceptionItems.mockResolvedValue({ success: true, data: [] });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("travel expense settings tabs (#689)", () => {
	it("opens Review without a tab in the URL", () => {
		mount();
		expect(screen.getByRole("tab", { name: "Review" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByText("Review cards")).toBeTruthy();
	});

	it("falls back to Review for an unknown tab", () => {
		window.history.replaceState(null, "", "/settings/travel-expenses?tab=payroll");
		mount();
		expect(screen.getByRole("tab", { name: "Review" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.queryByText("Exception cards")).toBeNull();
	});

	it("opens the tab named in the URL", () => {
		window.history.replaceState(null, "", "/settings/travel-expenses?tab=rates");
		mount();
		expect(screen.getByRole("tab", { name: "Rates" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByText("Rate cards")).toBeTruthy();
	});

	it("opens the expense officers on the Access tab (#747)", () => {
		window.history.replaceState(null, "", "/settings/travel-expenses?tab=access");
		mount();
		expect(screen.getByRole("tab", { name: "Access" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByText("Access cards")).toBeTruthy();
	});

	it("writes the chosen tab to the URL and keeps other search params", async () => {
		window.history.replaceState(null, "", "/settings/travel-expenses?from=nav");
		mount();
		fireEvent.click(screen.getByRole("tab", { name: "Currencies" }));
		await waitFor(() => expect(screen.getByText("Currency cards")).toBeTruthy());
		expect(window.location.pathname).toBe("/settings/travel-expenses");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("currencies");
		expect(new URLSearchParams(window.location.search).get("from")).toBe("nav");
	});

	it("counts unconverted foreign items and allowances without an override on Exceptions", async () => {
		actions.getForeignDraftExpenses.mockResolvedValue({
			success: true,
			data: [foreignItem("f1", false), foreignItem("f2", true), foreignItem("f3", false)],
		});
		actions.getAllowanceExceptionItems.mockResolvedValue({
			success: true,
			data: [allowanceItem("a1", false), allowanceItem("a2", true)],
		});
		mount();
		expect(await screen.findByRole("tab", { name: "Exceptions, 3 pending" })).toBeTruthy();
		// Visible while another tab is active.
		expect(screen.getByRole("tab", { name: "Review" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tab", { name: "Review" }).textContent).toBe("Review");
	});

	it("shows no badge when nothing is waiting", async () => {
		actions.getForeignDraftExpenses.mockResolvedValue({
			success: true,
			data: [foreignItem("f1", true)],
		});
		actions.getAllowanceExceptionItems.mockResolvedValue({
			success: true,
			data: [allowanceItem("a1", true)],
		});
		mount();
		await waitFor(() => expect(actions.getAllowanceExceptionItems).toHaveBeenCalled());
		await waitFor(() => expect(actions.getForeignDraftExpenses).toHaveBeenCalled());
		const exceptions = screen.getByRole("tab", { name: "Exceptions" });
		expect(exceptions.textContent).toBe("Exceptions");
	});

	it("ignores project attribution exceptions", async () => {
		actions.getProjectAttributionExceptionSettings.mockResolvedValue({
			success: true,
			data: { exceptions: [{ id: "p1" }, { id: "p2" }] },
		});
		actions.getForeignDraftExpenses.mockResolvedValue({
			success: true,
			data: [foreignItem("f1", false)],
		});
		mount();
		expect(await screen.findByRole("tab", { name: "Exceptions, 1 pending" })).toBeTruthy();
		expect(actions.getProjectAttributionExceptionSettings).not.toHaveBeenCalled();
	});

	it("follows the cards' cache when a conversion is documented or removed", async () => {
		actions.getForeignDraftExpenses.mockResolvedValue({
			success: true,
			data: [foreignItem("f1", false), foreignItem("f2", false)],
		});
		const client = mount();
		expect(await screen.findByRole("tab", { name: "Exceptions, 2 pending" })).toBeTruthy();

		actions.getForeignDraftExpenses.mockResolvedValue({
			success: true,
			data: [foreignItem("f1", true), foreignItem("f2", false)],
		});
		await client.invalidateQueries({ queryKey: ["travel-expenses", "settings"] });
		expect(await screen.findByRole("tab", { name: "Exceptions, 1 pending" })).toBeTruthy();

		actions.getForeignDraftExpenses.mockResolvedValue({
			success: true,
			data: [foreignItem("f1", false), foreignItem("f2", false)],
		});
		await client.invalidateQueries({ queryKey: ["travel-expenses", "settings"] });
		expect(await screen.findByRole("tab", { name: "Exceptions, 2 pending" })).toBeTruthy();
	});

	it("follows the cards' cache when an allowance override is authorized or revoked", async () => {
		actions.getAllowanceExceptionItems.mockResolvedValue({
			success: true,
			data: [allowanceItem("a1", false)],
		});
		const client = mount();
		expect(await screen.findByRole("tab", { name: "Exceptions, 1 pending" })).toBeTruthy();

		actions.getAllowanceExceptionItems.mockResolvedValue({
			success: true,
			data: [allowanceItem("a1", true)],
		});
		await client.invalidateQueries({ queryKey: ["travel-expenses", "settings"] });
		expect(await screen.findByRole("tab", { name: "Exceptions" })).toBeTruthy();

		actions.getAllowanceExceptionItems.mockResolvedValue({
			success: true,
			data: [allowanceItem("a1", false)],
		});
		await client.invalidateQueries({ queryKey: ["travel-expenses", "settings"] });
		expect(await screen.findByRole("tab", { name: "Exceptions, 1 pending" })).toBeTruthy();
	});
});
