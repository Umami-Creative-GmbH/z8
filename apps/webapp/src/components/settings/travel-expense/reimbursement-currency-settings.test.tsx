/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getReimbursementCurrencySetting: vi.fn(),
	saveReimbursementCurrencySetting: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/conversion-actions", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

import { ReimbursementCurrencySettingsCard } from "./reimbursement-currency-settings";

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function mount(currency: string) {
	actions.getReimbursementCurrencySetting.mockResolvedValue({ success: true, data: { currency } });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ReimbursementCurrencySettingsCard />
		</QueryClientProvider>,
	);
}

describe("ReimbursementCurrencySettingsCard (#688)", () => {
	it("offers only currencies that can be reimbursed, searchable by code and name", async () => {
		actions.saveReimbursementCurrencySetting.mockResolvedValue({
			success: true,
			data: { currency: "CHF" },
		});
		const user = userEvent.setup();
		mount("EUR");
		const select = await screen.findByRole("combobox", { name: "Reimbursement currency" });
		expect(select.textContent).toContain("EUR – Euro");

		await user.click(select);
		await user.keyboard("kwd");
		// Kuwaiti dinars have three decimals, which reimbursement amounts cannot store.
		expect(screen.queryByRole("option", { name: /KWD/ })).toBeNull();
		await user.clear(screen.getByPlaceholderText("Search currencies"));
		await user.keyboard("franc");
		await user.click(screen.getByRole("option", { name: "CHF – Swiss Franc" }));
		await user.click(screen.getByRole("button", { name: "Save currency" }));

		await waitFor(() =>
			expect(actions.saveReimbursementCurrencySetting).toHaveBeenCalledWith({ currency: "CHF" }),
		);
	});

	it("still shows a stored currency that is no longer offered, and refuses to save it", async () => {
		const user = userEvent.setup();
		mount("KWD");
		const select = await screen.findByRole("combobox", { name: "Reimbursement currency" });
		expect(select.textContent).toContain("KWD – Kuwaiti Dinar");

		await user.click(screen.getByRole("button", { name: "Save currency" }));
		expect(
			await screen.findByText(
				"Choose a currency with at most two decimal places, e.g. EUR or CHF.",
			),
		).toBeTruthy();
		expect(actions.saveReimbursementCurrencySetting).not.toHaveBeenCalled();
	});
});
