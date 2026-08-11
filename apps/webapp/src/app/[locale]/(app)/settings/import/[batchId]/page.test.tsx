/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockState = vi.hoisted(() => ({
	connection: vi.fn(async () => undefined),
	findBatch: vi.fn(),
	getImportReviewSummary: vi.fn(),
	listImportReviewRows: vi.fn(),
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
	requireImportAdmin: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("next/navigation", () => ({ notFound: mockState.notFound }));
vi.mock("next/server", () => ({ connection: mockState.connection }));

vi.mock("@/db", () => ({
	db: {
		query: {
			importBatch: { findFirst: mockState.findBatch },
		},
	},
}));

vi.mock("@/db/schema", () => ({
	importBatch: { id: "importBatch.id" },
}));

vi.mock("@/lib/import-review/repository", () => ({
	getImportReviewSummary: mockState.getImportReviewSummary,
	listImportReviewRows: mockState.listImportReviewRows,
}));

vi.mock("../review-actions", () => ({
	requireImportAdmin: mockState.requireImportAdmin,
}));

vi.mock("@/components/settings/import/import-review-page", () => ({
	ImportReviewPage: (props: Record<string, unknown>) => (
		<div data-testid="import-review-page" {...props} />
	),
}));

const { default: ImportReviewRoute } = await import("./page");

function getContentElement(page: ReturnType<typeof ImportReviewRoute>) {
	return page.props.children;
}

describe("ImportReviewRoute", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findBatch.mockResolvedValue({
			id: "batch-1",
			organizationId: "org-1",
		});
		mockState.getImportReviewSummary.mockResolvedValue({ total: 1 });
		mockState.listImportReviewRows.mockResolvedValue([{ id: "row-1" }]);
	});

	it("renders the settings fallback while params remain unresolved", () => {
		const page = ImportReviewRoute({ params: new Promise<never>(() => {}) });

		expect(page).not.toBeInstanceOf(Promise);
		render(page);

		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
		expect(mockState.findBatch).not.toHaveBeenCalled();
	});

	it("authorizes the batch organization and keeps review queries tenant scoped", async () => {
		const page = ImportReviewRoute({
			params: Promise.resolve({ batchId: "batch-1" }),
		});
		const contentElement = getContentElement(page);

		const reviewPage = await contentElement.type(contentElement.props);

		expect(mockState.connection).toHaveBeenCalledOnce();
		expect(mockState.findBatch).toHaveBeenCalledWith({
			where: { eq: ["importBatch.id", "batch-1"] },
		});
		expect(mockState.requireImportAdmin).toHaveBeenCalledWith("org-1");
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

	it("returns not found before authorization when the batch does not exist", async () => {
		mockState.findBatch.mockResolvedValue(undefined);
		const page = ImportReviewRoute({
			params: Promise.resolve({ batchId: "missing" }),
		});
		const contentElement = getContentElement(page);

		await expect(contentElement.type(contentElement.props)).rejects.toThrow(
			"NEXT_NOT_FOUND",
		);
		expect(mockState.requireImportAdmin).not.toHaveBeenCalled();
		expect(mockState.getImportReviewSummary).not.toHaveBeenCalled();
		expect(mockState.listImportReviewRows).not.toHaveBeenCalled();
	});
});
