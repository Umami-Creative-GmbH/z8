// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { travelExpenseReportDisplay } from "@/lib/approvals/presentation/travel-expense-report-display";
import { inboxRowFromDisplay } from "@/test/german-approval-summaries";
import { render } from "@/test/render-with-translations";
import { ApprovalSprintCard } from "./approval-sprint-card";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

describe("ApprovalSprintCard", () => {
	it("says once that an expense report's submitted facts are unavailable (#1978)", () => {
		const item = inboxRowFromDisplay(
			"report-1",
			"travel_expense_report",
			travelExpenseReportDisplay(null),
		);

		render(
			<ApprovalSprintCard
				item={item}
				isBusy={false}
				onApprove={vi.fn()}
				onReject={vi.fn()}
				onSkip={vi.fn()}
				onOpenDetails={vi.fn()}
			/>,
		);

		expect(screen.getAllByText("Submitted facts unavailable")).toHaveLength(1);
	});
});
