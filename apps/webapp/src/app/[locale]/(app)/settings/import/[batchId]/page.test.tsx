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
	requireImportAdmin: vi.fn(),
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
	ImportReviewPage: () => null,
}));

vi.mock("@/components/ui/skeleton", () => ({
	Skeleton: () => null,
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

vi.mock("../review-actions", () => ({
	requireImportAdmin: mockState.requireImportAdmin,
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

describe("ImportReviewRoute tenant access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.callOrder.length = 0;
		mockState.requireOrgAdminSettingsAccess.mockImplementation(async () => {
			mockState.callOrder.push("authorize");
			return { organizationId: "org_active" };
		});
		mockState.requireImportAdmin.mockResolvedValue({});
		mockState.findBatch.mockImplementation(async (query: unknown) => {
			mockState.callOrder.push("query");
			if (JSON.stringify(query).includes("org_active")) return undefined;
			return { id: "batch_foreign", organizationId: "org_other" };
		});
		mockState.getImportReviewSummary.mockResolvedValue({});
		mockState.listImportReviewRows.mockResolvedValue([]);
	});

	it("authorizes before a tenant-scoped lookup and hides another organization's batch", async () => {
		await expect(renderRequestContent("batch_foreign")).rejects.toThrow(
			"NEXT_NOT_FOUND",
		);

		expect(mockState.callOrder).toEqual(["authorize", "query"]);
		expect(mockState.findBatch).toHaveBeenCalledWith({
			where: [
				"and",
				["eq", "importBatch.id", "batch_foreign"],
				["eq", "importBatch.organizationId", "org_active"],
			],
		});
		expect(mockState.requireImportAdmin).not.toHaveBeenCalled();
		expect(mockState.getImportReviewSummary).not.toHaveBeenCalled();
		expect(mockState.listImportReviewRows).not.toHaveBeenCalled();
	});
});
