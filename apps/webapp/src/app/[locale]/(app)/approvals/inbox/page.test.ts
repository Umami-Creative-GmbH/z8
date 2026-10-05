import { type ComponentProps, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { getInitialApprovalInboxFilters } from "./page";

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: ComponentProps<"a">) =>
		createElement("a", { href, ...props }, children),
}));

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
		const filters = getInitialApprovalInboxFilters(
			new URLSearchParams("types=travel_expense_claim,"),
		);

		expect(filters).toEqual({
			status: "pending",
			types: ["travel_expense_claim"],
		});
	});
});
