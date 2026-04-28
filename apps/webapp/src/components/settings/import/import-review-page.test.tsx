/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportReviewPage } from "@/components/settings/import/import-review-page";

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/settings/import/review-actions", () => ({
	startImportCommitAction: vi.fn(),
}));

const baseSummary = {
	totalRows: 4,
	acceptedRows: 2,
	rejectedRows: 1,
	blockedRows: 0,
	committedRows: 0,
	issueCount: 3,
};

const acceptedRow = {
	id: "row_1",
	entityType: "work_period",
	providerSourceId: "clockin_1",
	rowStatus: "accepted",
	issueSeverity: "none",
};

describe("ImportReviewPage", () => {
	it("disables commit when blocked rows remain", () => {
		render(
			<ImportReviewPage
				organizationId="org_1"
				batchId="batch_1"
				summary={{ ...baseSummary, blockedRows: 1 }}
				rows={[{ ...acceptedRow, id: "row_blocked", rowStatus: "blocked", issueSeverity: "blocking" }]}
			/>,
		);

		expect(screen.getByRole("button", { name: /commit accepted rows/i })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("enables commit when accepted rows exist and no rows are blocked", () => {
		render(
			<ImportReviewPage
				organizationId="org_1"
				batchId="batch_1"
				summary={baseSummary}
				rows={[acceptedRow]}
			/>,
		);

		expect(screen.getByRole("button", { name: /commit accepted rows/i })).toHaveProperty(
			"disabled",
			false,
		);
	});

	it("renders the title and summary values", () => {
		render(
			<ImportReviewPage
				organizationId="org_1"
				batchId="batch_1"
				summary={{ ...baseSummary, committedRows: 5 }}
				rows={[acceptedRow]}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Import Review" })).toBeTruthy();
		expect(screen.getByText("Total")).toBeTruthy();
		expect(screen.getAllByText("Accepted").length).toBeGreaterThan(0);
		expect(screen.getByText("Rejected")).toBeTruthy();
		expect(screen.getByText("Blocked")).toBeTruthy();
		expect(screen.getByText("Committed")).toBeTruthy();
		expect(screen.getByText("Issues")).toBeTruthy();
		expect(screen.getByText("4")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("5")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
	});
});
