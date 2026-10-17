/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let refreshHandler: (() => unknown) | undefined;
vi.mock("@/components/providers/view-refresh-provider", () => ({
	useViewRefresh: (handler: () => unknown) => {
		refreshHandler = handler;
	},
}));

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
		t: (key: string, fallback?: string) =>
			key === "settings.payrollExport.mappings.description"
				? "Description"
				: (fallback ?? key),
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
				{
					id: "mapping-holiday",
					specialCategory: "holiday_compensation",
					datevWageTypeCode: "3000",
					datevWageTypeName: "Holiday compensation",
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
		render(<WageTypeMappings organizationId="org_123" hasMappingFormat />);

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

	it("asks for a payroll format before loading mappings when none is configured", () => {
		render(
			<WageTypeMappings organizationId="org_123" hasMappingFormat={false} />,
		);

		expect(
			screen.getByText(/configure at least one payroll export format/),
		).toBeTruthy();
		expect(getMappingsActionMock).not.toHaveBeenCalled();
	});
	it("reports unsuccessful header refresh actions and keeps current mappings", async () => {
		render(<WageTypeMappings organizationId="org_123" hasMappingFormat />);
		await screen.findByText("First category");
		getMappingsActionMock.mockResolvedValue({
			success: false,
			error: "Unavailable",
		});
		await act(async () => {
			await expect(refreshHandler?.()).rejects.toThrow(
				"Failed to refresh wage type mappings",
			);
		});
		expect(screen.getByText("First category")).toBeTruthy();
	});

	it("offers only supported special categories while retaining saved unsupported mappings", async () => {
		render(<WageTypeMappings organizationId="org_123" hasMappingFormat />);
		await screen.findByRole("cell", { name: "Overtime Reduction" });
		expect(
			screen.getByRole("cell", { name: "Holiday Compensation" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Add Mapping" }));
		const panel = within(screen.getByRole("dialog"));
		fireEvent.click(panel.getAllByRole("combobox")[0]);
		fireEvent.click(
			await screen.findByRole("option", { name: "Special Category" }),
		);
		fireEvent.click(panel.getAllByRole("combobox")[1]);
		expect(
			await screen.findByRole("option", { name: "Overtime", exact: true }),
		).toBeTruthy();
		expect(
			screen.queryByRole("option", { name: "Overtime Reduction" }),
		).toBeNull();
		expect(
			screen.queryByRole("option", { name: "Holiday Compensation" }),
		).toBeNull();
		expect(saveMappingActionMock).not.toHaveBeenCalled();
		expect(deleteMappingActionMock).not.toHaveBeenCalled();
	});

	it("saves and displays a SuccessFactors-only mapping without changing saved unsupported rows", async () => {
		getWorkCategoriesActionMock.mockResolvedValue({
			success: true,
			data: [{ id: "work-2", name: "New category" }],
		});
		const initial = await getMappingsActionMock();
		saveMappingActionMock.mockImplementation(async (input) => {
			const mapping = {
				...input,
				id: "mapping-3",
				workCategoryName: "New category",
			};
			getMappingsActionMock.mockResolvedValue({
				success: true,
				data: [...initial.data, mapping],
			});
			return { success: true, data: mapping };
		});
		render(<WageTypeMappings organizationId="org_123" hasMappingFormat />);
		await screen.findByText("First category");
		fireEvent.click(screen.getByRole("button", { name: "Add Mapping" }));
		const panel = within(screen.getByRole("dialog"));
		fireEvent.click(panel.getAllByRole("combobox")[1]);
		fireEvent.click(
			await screen.findByRole("option", { name: "New category" }),
		);
		const fields = within(
			panel.getByRole("group", { name: "SAP SuccessFactors" }),
		);
		fireEvent.change(fields.getByLabelText("Code"), {
			target: { value: "SF-WORK" },
		});
		fireEvent.change(fields.getByLabelText("Description"), {
			target: { value: "Attendance" },
		});
		fireEvent.click(panel.getByRole("button", { name: "Save", exact: true }));
		await screen.findByRole("cell", { name: "SF-WORK" });
		expect(saveMappingActionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org_123",
				workCategoryId: "work-2",
				datevWageTypeCode: null,
				lexwareWageTypeCode: null,
				sageWageTypeCode: null,
				successFactorsTimeTypeCode: "SF-WORK",
				successFactorsTimeTypeName: "Attendance",
			}),
		);
		expect(
			screen.getByRole("cell", { name: "Overtime Reduction" }),
		).toBeTruthy();
		expect(
			screen.getByRole("cell", { name: "Holiday Compensation" }),
		).toBeTruthy();
		expect(deleteMappingActionMock).not.toHaveBeenCalled();
	});

	it("prefills an existing source so clearing SuccessFactors preserves the other format codes", async () => {
		const initial = await getMappingsActionMock();
		initial.data[0].successFactorsTimeTypeCode = "SF-WORK";
		initial.data[0].successFactorsTimeTypeName = "Attendance";
		getMappingsActionMock.mockResolvedValue(initial);
		getWorkCategoriesActionMock.mockResolvedValue({
			success: true,
			data: [{ id: "work-1", name: "First category" }],
		});
		saveMappingActionMock.mockResolvedValue({ success: true, data: {} });
		render(<WageTypeMappings organizationId="org_123" hasMappingFormat />);
		await screen.findByText("First category");
		fireEvent.click(screen.getByRole("button", { name: "Add Mapping" }));
		const panel = within(screen.getByRole("dialog"));
		fireEvent.click(panel.getAllByRole("combobox")[1]);
		fireEvent.click(
			await screen.findByRole("option", { name: "First category" }),
		);
		const fields = within(
			panel.getByRole("group", { name: "SAP SuccessFactors" }),
		);
		expect(fields.getByDisplayValue("SF-WORK")).toBeTruthy();
		expect(panel.getByDisplayValue("1000")).toBeTruthy();
		fireEvent.change(fields.getByLabelText("Code"), { target: { value: "" } });
		fireEvent.change(fields.getByLabelText("Description"), {
			target: { value: "" },
		});
		fireEvent.click(panel.getByRole("button", { name: "Save", exact: true }));
		await waitFor(() =>
			expect(saveMappingActionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					workCategoryId: "work-1",
					datevWageTypeCode: "1000",
					datevWageTypeName: "First wage type",
					successFactorsTimeTypeCode: null,
					successFactorsTimeTypeName: null,
				}),
			),
		);
	});

	it("uses distinct translated text for the subtitle and format description labels", async () => {
		render(<WageTypeMappings organizationId="org_123" hasMappingFormat />);
		await screen.findByText("First category");
		expect(
			screen.getByText(
				"Map your work categories and absence types to payroll wage type codes",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Add Mapping" }));
		const panel = within(screen.getByRole("dialog"));
		for (const format of ["DATEV", "Lexware", "Sage", "SAP SuccessFactors"]) {
			expect(
				within(panel.getByRole("group", { name: format })).getByLabelText(
					"Description",
				),
			).toBeTruthy();
		}
	});
});
