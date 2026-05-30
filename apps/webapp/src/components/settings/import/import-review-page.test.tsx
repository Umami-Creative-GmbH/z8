/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startImportCommitAction } from "@/app/[locale]/(app)/settings/import/review-actions";
import { ImportReviewPage } from "@/components/settings/import/import-review-page";

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
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
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(startImportCommitAction).mockResolvedValue({
			success: true,
			data: { queuedCount: 2 },
		});
	});

	it("disables commit when blocked rows remain", () => {
		render(
			<ImportReviewPage
				organizationId="org_1"
				batchId="batch_1"
				summary={{ ...baseSummary, blockedRows: 1 }}
				rows={[
					{ ...acceptedRow, id: "row_blocked", rowStatus: "blocked", issueSeverity: "blocking" },
				]}
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

	it("starts commit for the current organization and batch", async () => {
		render(
			<ImportReviewPage
				organizationId="org_1"
				batchId="batch_1"
				summary={baseSummary}
				rows={[acceptedRow]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /commit accepted rows/i }));

		await waitFor(() => {
			expect(startImportCommitAction).toHaveBeenCalledWith({
				organizationId: "org_1",
				batchId: "batch_1",
			});
		});
	});

	it("does not start commit when blocked rows keep the button disabled", async () => {
		render(
			<ImportReviewPage
				organizationId="org_1"
				batchId="batch_1"
				summary={{ ...baseSummary, blockedRows: 1 }}
				rows={[
					{ ...acceptedRow, id: "row_blocked", rowStatus: "blocked", issueSeverity: "blocking" },
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /commit accepted rows/i }));

		expect(startImportCommitAction).not.toHaveBeenCalled();
	});

	it("does not start commit when there are no accepted rows", async () => {
		render(
			<ImportReviewPage
				organizationId="org_1"
				batchId="batch_1"
				summary={{ ...baseSummary, acceptedRows: 0 }}
				rows={[]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /commit accepted rows/i }));

		expect(startImportCommitAction).not.toHaveBeenCalled();
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
