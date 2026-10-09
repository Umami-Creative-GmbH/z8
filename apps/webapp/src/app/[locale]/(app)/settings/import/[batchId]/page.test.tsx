/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

const mockState = vi.hoisted(() => ({
	callOrder: [] as string[],
	findBatch: vi.fn(),
	getBillableTimeSettings: vi.fn(),
	getImportReviewSummary: vi.fn(),
	listCustomerAccounting: vi.fn(),
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

vi.mock("@/lib/billable-time/accounting/customer-accounting", () => ({
	listCustomerAccounting: mockState.listCustomerAccounting,
}));

vi.mock("@/lib/billable-time/settings", () => ({
	getBillableTimeSettings: mockState.getBillableTimeSettings,
}));

vi.mock("@/lib/import-review/repository", () => ({
	getImportReviewSummary: mockState.getImportReviewSummary,
	listImportReviewRows: mockState.listImportReviewRows,
}));

const { default: ImportReviewRoute } = await import("./page");

async function renderRequestContent(batchId: string, searchParams: Record<string, string> = {}) {
	const route = ImportReviewRoute({
		params: Promise.resolve({ batchId }),
		searchParams: Promise.resolve(searchParams),
	});
	if (!isValidElement(route) || !isValidElement(route.props.children)) {
		throw new Error("Expected a focused import review boundary");
	}

	type ContentProps = {
		params: Promise<{ batchId: string }>;
		searchParams: Promise<Record<string, string>>;
	};
	const content = route.props.children as React.ReactElement<
		ContentProps,
		(props: ContentProps) => Promise<React.ReactNode>
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
		mockState.getBillableTimeSettings.mockResolvedValue({ enabled: false, currency: null });
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
			rows: [{ id: "row-1", billability: null }],
			showBillability: false,
			customerImport: undefined,
		});
		expect(mockState.getBillableTimeSettings).toHaveBeenCalledWith("org-1");
		expect(mockState.listCustomerAccounting).not.toHaveBeenCalled();
	});

	it("shows a customer import's contacts with the customers they can link to (#906)", async () => {
		mockState.findBatch.mockResolvedValue({
			id: "batch-1",
			organizationId: "org-1",
			provider: "accounting",
			status: "needs_review",
		});
		mockState.listImportReviewRows.mockResolvedValue([
			{
				id: "row-1",
				entityType: "customer",
				rowStatus: "accepted",
				issueSeverity: "info",
				commitChoice: { kind: "link", targetId: "cust-1" },
				commitHold: null,
				normalizedPayload: { contactId: "c-1", name: "Acme GmbH" },
				matchTarget: {
					suggestion: { customerId: "cust-1", customerName: "Acme", reason: "name" },
				},
			},
		]);
		mockState.listCustomerAccounting.mockResolvedValue([
			{ customerId: "cust-1", name: "Acme", isActive: true, contactLink: null },
			{ customerId: "cust-2", name: "Linked", isActive: true, contactLink: { contactId: "x" } },
			{ customerId: "cust-3", name: "Inactive", isActive: false, contactLink: null },
		]);

		const reviewPage = await renderRequestContent("batch-1");

		expect(mockState.listImportReviewRows).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 100, offset: 0 }),
		);
		expect(mockState.listCustomerAccounting).toHaveBeenCalledWith(expect.anything(), "org-1");
		expect(reviewPage.props.children.props.children.props.customerImport).toMatchObject({
			editable: true,
			linkTargets: [{ customerId: "cust-1", name: "Acme" }],
			rows: [
				{
					id: "row-1",
					rowStatus: "accepted",
					commitChoice: { kind: "link", targetId: "cust-1" },
					customer: {
						contactId: "c-1",
						name: "Acme GmbH",
						suggestion: { customerId: "cust-1", reason: "name" },
					},
				},
			],
		});
	});

	it.each([
		["2", 2, 100],
		["3", 3, 200],
		// Past the end: the last page.
		["9", 3, 200],
		["0", 1, 0],
		["abc", 1, 0],
	])("pages a customer import: ?page=%s shows page %i", async (page, shown, offset) => {
		mockState.findBatch.mockResolvedValue({
			id: "batch-1",
			organizationId: "org-1",
			provider: "accounting",
			status: "needs_review",
		});
		mockState.getImportReviewSummary.mockResolvedValue({ totalRows: 250 });
		mockState.listImportReviewRows.mockResolvedValue([]);
		mockState.listCustomerAccounting.mockResolvedValue([]);

		const reviewPage = await renderRequestContent("batch-1", { page });

		expect(mockState.listImportReviewRows).toHaveBeenCalledWith({
			batchId: "batch-1",
			organizationId: "org-1",
			limit: 100,
			offset,
		});
		expect(reviewPage.props.children.props.children.props.customerImport.paging).toEqual({
			page: shown,
			pageCount: 3,
		});
	});

	it("shows staged work rows' billability while Billable Time is on (#907)", async () => {
		mockState.getBillableTimeSettings.mockResolvedValue({ enabled: true, currency: "EUR" });
		mockState.listImportReviewRows.mockResolvedValue([
			{
				id: "row-1",
				entityType: "work_period",
				normalizedPayload: {
					billability: { providerValue: 1, billable: false, note: "no_customer" },
				},
			},
			{ id: "row-2", entityType: "work_period", normalizedPayload: {} },
			{ id: "row-3", entityType: "team", normalizedPayload: {} },
		]);

		const reviewPage = await renderRequestContent("batch-1");

		const props = reviewPage.props.children.props.children.props;
		expect(props.showBillability).toBe(true);
		expect(props.rows.map((row: { billability: unknown }) => row.billability)).toEqual([
			{ providerValue: 1, billable: false, note: "no_customer" },
			{ providerValue: null, billable: false, note: "no_billable_value" },
			null,
		]);
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
