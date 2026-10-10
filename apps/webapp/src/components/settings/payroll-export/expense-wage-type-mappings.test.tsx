/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EXPENSE_WAGE_TYPE_CODES } from "@/lib/payroll-export/expense-wage-type.types";
import { PAYROLL_LINE_KINDS } from "@/lib/travel-expenses/payroll-line-kind";

const mocks = vi.hoisted(() => ({
	getExpenseWageTypeSetting: vi.fn(),
	saveExpenseWageTypeSetting: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/payroll-export/expense-wage-type-actions", () => ({
	getExpenseWageTypeSetting: mocks.getExpenseWageTypeSetting,
	saveExpenseWageTypeSetting: mocks.saveExpenseWageTypeSetting,
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import { ExpenseWageTypeMappings } from "./expense-wage-type-mappings";

function mappings(
	overrides: Partial<Record<string, Partial<typeof EMPTY_EXPENSE_WAGE_TYPE_CODES>>>,
) {
	return PAYROLL_LINE_KINDS.map((kind) => ({
		kind,
		codes: { ...EMPTY_EXPENSE_WAGE_TYPE_CODES, ...overrides[kind] },
	}));
}

function renderSection() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<ExpenseWageTypeMappings />
		</QueryClientProvider>,
	);
}

describe("ExpenseWageTypeMappings (#851)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("is hidden while the organization pays by bank transfer", async () => {
		mocks.getExpenseWageTypeSetting.mockResolvedValue({
			success: true,
			data: { channel: "bank_transfer", mappings: mappings({}) },
		});

		const { container } = renderSection();

		await waitFor(() => expect(mocks.getExpenseWageTypeSetting).toHaveBeenCalled());
		await waitFor(() => expect(container.textContent).toBe(""));
		expect(screen.queryByText("Expense reimbursements")).toBeNull();
	});

	it("lists every payroll line kind per file format with neutral labels and empty unmapped rows", async () => {
		mocks.getExpenseWageTypeSetting.mockResolvedValue({
			success: true,
			data: {
				channel: "payroll_run",
				mappings: mappings({ per_diem_excess: { datev_lohn: "2210" } }),
			},
		});

		renderSection();

		expect(await screen.findByText("Expense reimbursements")).toBeTruthy();
		for (const label of [
			"Per diem: statutory share",
			"Per diem: taxable excess",
			"Mileage: statutory share",
			"Mileage: taxable excess",
			"Receipts: transport",
			"Receipts: accommodation",
			"Receipts: meals",
			"Receipts: parking",
			"Receipts: other",
		]) {
			expect(screen.getByText(label)).toBeTruthy();
		}
		expect(screen.queryByText(/tax-free/i)).toBeNull();
		for (const format of ["DATEV Lohn", "Lexware", "Sage", "SuccessFactors file"]) {
			expect(screen.getByRole("columnheader", { name: format })).toBeTruthy();
		}
		expect(screen.queryByRole("columnheader", { name: /Personio|Workday|API/ })).toBeNull();
		expect(
			screen.getByText(/without a wage type .* leaves the affected reports out of the payroll run/),
		).toBeTruthy();

		const excessDatev = screen.getByLabelText(
			"Per diem: taxable excess, DATEV Lohn wage type",
		) as HTMLInputElement;
		expect(excessDatev.value).toBe("2210");
		const statutoryDatev = screen.getByLabelText(
			"Per diem: statutory share, DATEV Lohn wage type",
		) as HTMLInputElement;
		expect(statutoryDatev.value).toBe("");
	});

	it("saves only the changed rows, including a cleared code", async () => {
		mocks.getExpenseWageTypeSetting.mockResolvedValue({
			success: true,
			data: {
				channel: "payroll_run",
				mappings: mappings({ per_diem_excess: { datev_lohn: "2210", sage_lohn: "4000" } }),
			},
		});
		mocks.saveExpenseWageTypeSetting.mockImplementation(async (input) => ({
			success: true,
			data: input,
		}));

		renderSection();

		fireEvent.change(
			await screen.findByLabelText("Per diem: taxable excess, DATEV Lohn wage type"),
			{ target: { value: "" } },
		);
		fireEvent.change(screen.getByLabelText("Receipts: meals, SuccessFactors file wage type"), {
			target: { value: "MEALS" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save wage types" }));

		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Wage types saved"));
		expect(mocks.saveExpenseWageTypeSetting.mock.calls.map(([input]) => input)).toEqual([
			{
				kind: "per_diem_excess",
				codes: { ...EMPTY_EXPENSE_WAGE_TYPE_CODES, sage_lohn: "4000" },
			},
			{
				kind: "receipt_meals",
				codes: { ...EMPTY_EXPENSE_WAGE_TYPE_CODES, successfactors_csv: "MEALS" },
			},
		]);
	});

	it("reports rows that could not be saved", async () => {
		mocks.getExpenseWageTypeSetting.mockResolvedValue({
			success: true,
			data: { channel: "payroll_run", mappings: mappings({}) },
		});
		mocks.saveExpenseWageTypeSetting.mockResolvedValue({
			success: false,
			error: "Invalid wage type mapping",
		});

		renderSection();

		fireEvent.change(await screen.findByLabelText("Mileage: statutory share, Lexware wage type"), {
			target: { value: "300" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save wage types" }));

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith("Some wage types could not be saved."),
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
	});
});
