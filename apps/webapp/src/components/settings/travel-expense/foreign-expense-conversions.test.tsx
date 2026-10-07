/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getForeignDraftExpenses: vi.fn(),
	authorizeManualConversionRateAction: vi.fn(),
	clearItemConversionAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/conversion-actions", () => actions);
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions", () => ({
	getAllowanceExceptionItems: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		id,
		name,
		value,
		onChange,
	}: {
		id?: string;
		name: string;
		value: string;
		onChange: (value: string) => void;
	}) => <input id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { ForeignExpenseConversionsCard } from "./foreign-expense-conversions";

const rateError = "Enter a positive rate with at most 10 decimals, e.g. 0.9215.";
const afterExpense = "The rate cannot be dated after the expense.";
const reasonRequired = "Document where the rate comes from.";
const evidenceRequired = "Name the document or statement line that shows the rate.";

async function openDialog() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ForeignExpenseConversionsCard />
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Document rate" }));
	return screen.findByRole("dialog");
}

beforeEach(() => {
	actions.getForeignDraftExpenses.mockResolvedValue({
		success: true,
		data: [
			{
				reportId: "6a000000-0000-4000-8000-000000000001",
				itemId: "6a000000-0000-4000-8000-000000000002",
				itemVersion: 3,
				employeeName: "Robin",
				expenseDate: "2026-09-15",
				description: "Taxi",
				amount: "100.00",
				currency: "USD",
				reimbursementCurrency: "EUR",
				conversion: null,
			},
		],
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("documented rate dialog (#688)", () => {
	it("checks the rate and its date like the server and clears each error once valid", async () => {
		const dialog = await openDialog();
		const rate = within(dialog).getByLabelText("Rate (x)");
		fireEvent.change(rate, { target: { value: "abc" } });
		expect(within(dialog).getAllByText(rateError)).toHaveLength(1);
		fireEvent.change(rate, { target: { value: "0.92" } });
		expect(within(dialog).queryByText(rateError)).toBeNull();

		const rateDate = within(dialog).getByLabelText("Rate date");
		fireEvent.change(rateDate, { target: { value: "2026-09-20" } });
		expect(within(dialog).getAllByText(afterExpense)).toHaveLength(1);
		fireEvent.change(rateDate, { target: { value: "2026-09-14" } });
		expect(within(dialog).queryByText(afterExpense)).toBeNull();
	});

	it("shows missing documentation on submit and clears it once entered", async () => {
		const dialog = await openDialog();
		fireEvent.change(within(dialog).getByLabelText("Rate (x)"), { target: { value: "0.92" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Authorize rate" }));
		expect(await within(dialog).findAllByText(reasonRequired)).toHaveLength(1);
		expect(within(dialog).getAllByText(evidenceRequired)).toHaveLength(1);
		expect(actions.authorizeManualConversionRateAction).not.toHaveBeenCalled();

		fireEvent.change(within(dialog).getByLabelText("Documentation"), {
			target: { value: "Bank statement rate" },
		});
		expect(within(dialog).queryByText(reasonRequired)).toBeNull();
		expect(within(dialog).getByText(evidenceRequired)).toBeTruthy();
	});

	it("keeps a field error the server returned until that field changes", async () => {
		actions.authorizeManualConversionRateAction.mockResolvedValue({
			success: true,
			data: { kind: "invalid", errors: { evidence: "too_long" } },
		});
		const dialog = await openDialog();
		fireEvent.change(within(dialog).getByLabelText("Rate (x)"), { target: { value: "0.92" } });
		fireEvent.change(within(dialog).getByLabelText("Documentation"), {
			target: { value: "Bank statement rate" },
		});
		const evidence = within(dialog).getByLabelText("Rate evidence");
		fireEvent.change(evidence, { target: { value: "Statement 2026-09, line 4" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Authorize rate" }));
		expect(await within(dialog).findAllByText("This text is too long.")).toHaveLength(1);
		fireEvent.change(evidence, { target: { value: "Statement 2026-09" } });
		expect(within(dialog).queryByText("This text is too long.")).toBeNull();
	});
});
