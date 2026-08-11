/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	callOrder: [] as string[],
	findBatch: vi.fn(),
	getImportReviewSummary: vi.fn(),
	listImportReviewRows: vi.fn(),
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
	requireOrgAdminSettingsAccess: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ["and", ...conditions],
	eq: (column: unknown, value: unknown) => ["eq", column, value],
}));

vi.mock("next/navigation", () => ({
	notFound: mockState.notFound,
}));

vi.mock("@/components/settings/import/import-review-page", () => ({
	ImportReviewPage: (props: Record<string, unknown>) => (
		<div data-testid="import-review-page" {...props} />
	),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			importBatch: {
				findFirst: mockState.findBatch,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	importBatch: {
		id: "importBatch.id",
		organizationId: "importBatch.organizationId",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mockState.requireOrgAdminSettingsAccess,
}));

vi.mock("@/lib/import-review/repository", () => ({
	getImportReviewSummary: mockState.getImportReviewSummary,
	listImportReviewRows: mockState.listImportReviewRows,
}));

const { default: ImportReviewRoute } = await import("./page");

async function renderRequestContent(batchId: string) {
	const route = ImportReviewRoute({ params: Promise.resolve({ batchId }) });
	if (!isValidElement(route) || !isValidElement(route.props.children)) {
		throw new Error("Expected a focused import review boundary");
	}

	const content = route.props.children as React.ReactElement<
		{ params: Promise<{ batchId: string }> },
		(props: {
			params: Promise<{ batchId: string }>;
		}) => Promise<React.ReactNode>
	>;
	return content.type(content.props);
}

describe("ImportReviewRoute", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.callOrder.length = 0;
		mockState.requireOrgAdminSettingsAccess.mockImplementation(async () => {
			mockState.callOrder.push("authorize");
			return { organizationId: "org-1" };
		});
		mockState.findBatch.mockImplementation(async () => {
			mockState.callOrder.push("query");
			return { id: "batch-1", organizationId: "org-1" };
		});
		mockState.getImportReviewSummary.mockResolvedValue({ total: 1 });
		mockState.listImportReviewRows.mockResolvedValue([{ id: "row-1" }]);
	});

	it("renders the import review shell while params remain unresolved", () => {
		const page = ImportReviewRoute({ params: new Promise<never>(() => {}) });

		expect(page).not.toBeInstanceOf(Promise);
		render(page);

		expect(screen.getByLabelText("Loading import review")).toBeTruthy();
		expect(mockState.findBatch).not.toHaveBeenCalled();
	});

	it("authorizes before a tenant-scoped lookup and scopes review queries", async () => {
		const reviewPage = await renderRequestContent("batch-1");

		expect(mockState.callOrder).toEqual(["authorize", "query"]);
		expect(mockState.findBatch).toHaveBeenCalledWith({
			where: [
				"and",
				["eq", "importBatch.id", "batch-1"],
				["eq", "importBatch.organizationId", "org-1"],
			],
		});
		expect(mockState.getImportReviewSummary).toHaveBeenCalledWith({
			batchId: "batch-1",
			organizationId: "org-1",
		});
		expect(mockState.listImportReviewRows).toHaveBeenCalledWith({
			batchId: "batch-1",
			organizationId: "org-1",
			limit: 100,
			offset: 0,
		});
		expect(reviewPage.props.children.props.children.props).toMatchObject({
			batchId: "batch-1",
			organizationId: "org-1",
			summary: { total: 1 },
			rows: [{ id: "row-1" }],
		});
	});

	it("hides another organization's batch", async () => {
		mockState.findBatch.mockResolvedValue(undefined);

		await expect(renderRequestContent("batch-foreign")).rejects.toThrow(
			"NEXT_NOT_FOUND",
		);
		expect(mockState.getImportReviewSummary).not.toHaveBeenCalled();
		expect(mockState.listImportReviewRows).not.toHaveBeenCalled();
	});
});
