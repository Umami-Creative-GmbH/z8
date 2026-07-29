/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	deleteMappingActionMock,
	getAbsenceCategoriesActionMock,
	getMappingsActionMock,
	getWorkCategoriesActionMock,
	saveMappingActionMock,
} = vi.hoisted(() => ({
	deleteMappingActionMock: vi.fn(),
	getAbsenceCategoriesActionMock: vi.fn(),
	getMappingsActionMock: vi.fn(),
	getWorkCategoriesActionMock: vi.fn(),
	saveMappingActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	deleteMappingAction: deleteMappingActionMock,
	getAbsenceCategoriesAction: getAbsenceCategoriesActionMock,
	getMappingsAction: getMappingsActionMock,
	getWorkCategoriesAction: getWorkCategoriesActionMock,
	saveMappingAction: saveMappingActionMock,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { WageTypeMappings } from "./wage-type-mappings";

describe("WageTypeMappings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getMappingsActionMock.mockResolvedValue({
			success: true,
			data: [
				{
					id: "mapping-1",
					workCategoryId: "work-1",
					workCategoryName: "First category",
					absenceCategoryId: null,
					absenceCategoryName: null,
					specialCategory: null,
					datevWageTypeCode: "1000",
					datevWageTypeName: "First wage type",
					lexwareWageTypeCode: null,
					lexwareWageTypeName: null,
					sageWageTypeCode: null,
					sageWageTypeName: null,
				},
				{
					id: "mapping-2",
					workCategoryId: null,
					workCategoryName: null,
					absenceCategoryId: null,
					absenceCategoryName: null,
					specialCategory: "overtime_reduction",
					datevWageTypeCode: null,
					datevWageTypeName: null,
					lexwareWageTypeCode: "200",
					lexwareWageTypeName: "Second wage type",
					sageWageTypeCode: null,
					sageWageTypeName: null,
				},
			],
		});
		getWorkCategoriesActionMock.mockResolvedValue({ success: true, data: [] });
		getAbsenceCategoriesActionMock.mockResolvedValue({
			success: true,
			data: [],
		});
	});

	it("loads every mapping input with the organization and preserves returned order", async () => {
		render(
			<WageTypeMappings
				organizationId="org_123"
				config={{
					id: "cfg_123",
					formatId: "datev_lohn",
					isActive: true,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					updatedAt: new Date("2026-01-01T00:00:00.000Z"),
					config: {} as never,
				}}
			/>,
		);

		await waitFor(() =>
			expect(screen.getByText("First category")).toBeTruthy(),
		);
		expect(getMappingsActionMock).toHaveBeenCalledWith("org_123");
		expect(getWorkCategoriesActionMock).toHaveBeenCalledWith("org_123");
		expect(getAbsenceCategoriesActionMock).toHaveBeenCalledWith("org_123");

		const categories = screen.getAllByRole("cell", {
			name: /First category|Overtime Reduction/,
		});
		expect(categories.map((cell) => cell.textContent)).toEqual([
			"First category",
			"Overtime Reduction",
		]);
	});
});
