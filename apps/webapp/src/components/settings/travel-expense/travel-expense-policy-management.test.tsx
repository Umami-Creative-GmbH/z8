// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ getTravelExpensePolicies: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/actions", () => actions);

import { TravelExpensePolicyManagement } from "./travel-expense-policy-management";

function renderCard() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<TravelExpensePolicyManagement />
		</QueryClientProvider>,
	);
}

const policy = {
	id: "p1",
	effectiveFrom: "2024-01-01",
	effectiveTo: null,
	mileageRatePerKm: "0.30",
	perDiemRatePerDay: null,
	currency: "EUR",
};

beforeEach(() => {
	actions.getTravelExpensePolicies.mockReset();
});
afterEach(cleanup);

describe("TravelExpensePolicyManagement", () => {
	it("stays hidden when the organization has no earlier records", async () => {
		actions.getTravelExpensePolicies.mockResolvedValue({ success: true, data: [] });
		const { container } = renderCard();
		await waitFor(() => expect(actions.getTravelExpensePolicies).toHaveBeenCalled());
		await waitFor(() => expect(container.textContent).toBe(""));
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows a failed read in place of the card and recovers on retry", async () => {
		actions.getTravelExpensePolicies.mockResolvedValueOnce({ success: false, error: "boom" });
		actions.getTravelExpensePolicies.mockResolvedValueOnce({ success: true, data: [policy] });
		const user = userEvent.setup();
		renderCard();

		expect((await screen.findByRole("alert")).textContent).toBe(
			"Earlier policy records could not be loaded",
		);
		await user.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByText("Earlier policy records")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(actions.getTravelExpensePolicies).toHaveBeenCalledTimes(2);
	});
});
