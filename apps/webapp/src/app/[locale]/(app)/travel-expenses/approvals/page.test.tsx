import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn();

vi.mock("next/navigation", () => ({
	redirect,
}));

const { default: TravelExpenseApprovalsPage } = await import("./page");

describe("TravelExpenseApprovalsPage", () => {
	beforeEach(() => {
		redirect.mockReset();
	});

	it("redirects to the locale-specific approval inbox filter", async () => {
		await TravelExpenseApprovalsPage({
			params: Promise.resolve({ locale: "de" }),
		});

		expect(redirect).toHaveBeenCalledWith("/de/approvals/inbox?types=travel_expense_claim");
	});
});
