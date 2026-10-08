/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCount: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, _fallback: string, params?: Record<string, unknown>) =>
			`${String(params?.count)} awaiting reimbursement`,
	}),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getTravelExpenseFinanceAwaitingCount: mocks.getCount,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { FinanceNavBadge } from "./finance-nav-badge";

function mount() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<FinanceNavBadge />
		</QueryClientProvider>,
	);
}

describe("finance navigation badge (#753)", () => {
	beforeEach(() => mocks.getCount.mockReset());
	afterEach(cleanup);

	it("shows the count of expenses awaiting reimbursement, with a spoken label", async () => {
		mocks.getCount.mockResolvedValue({ success: true, data: { count: 7 } });
		mount();
		expect(await screen.findByText("7")).toBeTruthy();
		expect(screen.getByText("7 awaiting reimbursement").className).toContain("sr-only");
	});

	it("caps a large count", async () => {
		mocks.getCount.mockResolvedValue({ success: true, data: { count: 1234 } });
		mount();
		expect(await screen.findByText("99+")).toBeTruthy();
	});

	it.each([
		["nothing is awaiting reimbursement", { success: true, data: { count: 0 } }],
		["the count is refused", { success: false, error: "Unauthorized" }],
	])("shows nothing when %s", async (_case, result) => {
		mocks.getCount.mockResolvedValue(result);
		const { container } = mount();
		await waitFor(() => expect(mocks.getCount).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});
});
