/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getAllowanceExceptionItems: vi.fn(),
	authorizeAllowanceOverrideAction: vi.fn(),
	revokeAllowanceOverrideAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions", () => actions);
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/conversion-actions", () => ({
	getForeignDraftExpenses: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import { AllowanceOverridesSettingsCard } from "./allowance-overrides-settings";

const amountError =
	"Enter the amount in the report currency, with at most two decimals. Mileage must be more than zero.";
const reasonError = "Explain why the allowance is set manually.";
const evidenceError =
	"Name the evidence the amount rests on, e.g. an official rate table or a confirmation.";

async function openDialog() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<AllowanceOverridesSettingsCard />
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Set allowance manually" }));
	return screen.findByRole("dialog");
}

beforeEach(() => {
	actions.getAllowanceExceptionItems.mockResolvedValue({
		success: true,
		data: [
			{
				reportId: "6a000000-0000-4000-8000-000000000001",
				itemId: "6a000000-0000-4000-8000-000000000002",
				itemVersion: 2,
				kind: "mileage",
				employeeId: "employee-1",
				employeeName: "Robin",
				reimbursementCurrency: "EUR",
				expenseDate: "2026-09-15",
				route: "Berlin – Potsdam",
				distanceKm: "42",
				vehicle: "car",
				itinerary: null,
				destinations: [],
				situation: { kind: "missing_coverage", reasons: ["policy_missing"] },
				ordinaryAmount: null,
				override: null,
				ownReport: false,
			},
		],
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("manual allowance dialog (#688)", () => {
	it("clears an amount error once the amount is valid", async () => {
		const dialog = await openDialog();
		const amount = within(dialog).getByLabelText("Amount (EUR)");
		fireEvent.change(amount, { target: { value: "0" } });
		expect(within(dialog).getAllByText(amountError)).toHaveLength(1);
		fireEvent.change(amount, { target: { value: "12.60" } });
		expect(within(dialog).queryByText(amountError)).toBeNull();
	});

	it("shows missing texts on submit and clears each once entered", async () => {
		const dialog = await openDialog();
		fireEvent.click(within(dialog).getByRole("button", { name: "Authorize allowance" }));
		expect(await within(dialog).findAllByText(reasonError)).toHaveLength(1);
		expect(actions.authorizeAllowanceOverrideAction).not.toHaveBeenCalled();
		fireEvent.change(within(dialog).getByLabelText("Reason"), {
			target: { value: "No policy for this year yet" },
		});
		expect(within(dialog).queryByText(reasonError)).toBeNull();
		expect(within(dialog).getByText(evidenceError)).toBeTruthy();
	});

	it("keeps a field error the server returned until that field changes", async () => {
		actions.authorizeAllowanceOverrideAction.mockResolvedValue({
			success: true,
			data: { kind: "invalid", errors: ["evidence"] },
		});
		const dialog = await openDialog();
		const values: Record<string, string> = {
			"Amount (EUR)": "12.60",
			Calculation: "42 km × 0.30 EUR",
			Reason: "No policy for this year yet",
			Evidence: "Travel policy 2025",
		};
		for (const [label, value] of Object.entries(values)) {
			fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
		}
		fireEvent.click(within(dialog).getByRole("button", { name: "Authorize allowance" }));
		expect(await within(dialog).findAllByText(evidenceError)).toHaveLength(1);
		fireEvent.change(within(dialog).getByLabelText("Evidence"), {
			target: { value: "Travel policy 2025, section 4" },
		});
		expect(within(dialog).queryByText(evidenceError)).toBeNull();
	});
});
