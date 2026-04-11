import { describe, expect, it } from "vitest";
import { getInitialApprovalInboxFilters } from "./page";

describe("getInitialApprovalInboxFilters", () => {
	it("hydrates the types filter from URL search params", () => {
		const filters = getInitialApprovalInboxFilters(
			new URLSearchParams("types=travel_expense_claim,time_entry"),
		);

		expect(filters).toEqual({
			status: "pending",
			types: ["travel_expense_claim", "time_entry"],
		});
	});

	it("ignores empty types values", () => {
		const filters = getInitialApprovalInboxFilters(new URLSearchParams("types=travel_expense_claim,"));

		expect(filters).toEqual({
			status: "pending",
			types: ["travel_expense_claim"],
		});
	});
});
