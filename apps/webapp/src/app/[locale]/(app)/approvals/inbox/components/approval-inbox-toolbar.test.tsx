// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalInboxFilters } from "@/lib/query/use-approval-inbox";
import { ApprovalInboxToolbar } from "./approval-inbox-toolbar";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function renderToolbar(filters: ApprovalInboxFilters = { status: "pending" }) {
	const onFiltersChange = vi.fn();

	render(
		<ApprovalInboxToolbar
			filters={filters}
			onFiltersChange={onFiltersChange}
			selectedCount={0}
			totalCount={3}
			allSelected={false}
			onSelectAll={vi.fn()}
			supportedTypes={["absence_entry", "time_entry", "travel_expense_claim"]}
		/>,
	);

	return { onFiltersChange };
}

describe("ApprovalInboxToolbar", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("debounces search filter changes while keeping input responsive", () => {
		const { onFiltersChange } = renderToolbar();
		const searchInput = screen.getByLabelText("Search approvals") as HTMLInputElement;

		fireEvent.change(searchInput, { target: { value: "a" } });
		fireEvent.change(searchInput, { target: { value: "av" } });
		fireEvent.change(searchInput, { target: { value: "ave" } });

		expect(searchInput.value).toBe("ave");
		expect(onFiltersChange).not.toHaveBeenCalled();

		vi.advanceTimersByTime(299);
		expect(onFiltersChange).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onFiltersChange).toHaveBeenCalledTimes(1);
		expect(onFiltersChange).toHaveBeenCalledWith({ status: "pending", search: "ave" });
	});
});
