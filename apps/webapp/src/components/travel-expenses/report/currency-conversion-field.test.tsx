/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const conversionActions = vi.hoisted(() => ({
	saveCardChargeConversionAction: vi.fn(),
	removeCardChargeConversionAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/conversion-actions", () => conversionActions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import type { ItemConversion } from "@/lib/travel-expenses/currency-conversion";
import { CurrencyConversionField } from "./currency-conversion-field";

const receipts = [
	{
		id: "6a000000-0000-4000-8000-0000000000a1",
		fileName: "taxi.pdf",
		mimeType: "application/pdf",
		sizeBytes: 10,
		createdAt: "2026-10-05T10:00:00.000Z",
	},
	{
		id: "6a000000-0000-4000-8000-0000000000a2",
		fileName: "card-statement.pdf",
		mimeType: "application/pdf",
		sizeBytes: 10,
		createdAt: "2026-10-05T10:00:00.000Z",
	},
];

function renderField(
	options: { currency?: string; conversion?: ItemConversion | null; version?: number } = {},
) {
	const version = {
		flush: vi.fn(async () => {}),
		current: vi.fn(() => options.version ?? 3),
		adopt: vi.fn(),
	};
	const onChanged = vi.fn();
	render(
		<CurrencyConversionField
			reportId="6a000000-0000-4000-8000-000000000001"
			itemId="6a000000-0000-4000-8000-000000000002"
			original={{ amount: "100.00", currency: options.currency ?? "USD" }}
			reimbursementCurrency="EUR"
			conversion={options.conversion ?? null}
			receipts={receipts}
			version={version}
			onChanged={onChanged}
		/>,
	);
	return { version, onChanged };
}

describe("CurrencyConversionField (#607)", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows nothing for a receipt in the reimbursement currency", () => {
		renderField({ currency: "EUR" });
		expect(screen.queryByText(/Conversion into/)).toBeNull();
	});

	it("explains that no rate is guessed until a card charge or documented rate exists", () => {
		renderField();
		expect(screen.getByRole("heading", { name: "Conversion into EUR" })).toBeTruthy();
		expect(screen.getByText(/No exchange rate is guessed/)).toBeTruthy();
	});

	it("saves the card charge on top of the item's saved version and continues from the new one", async () => {
		conversionActions.saveCardChargeConversionAction.mockResolvedValue({
			success: true,
			data: { kind: "saved", itemVersion: 4, conversion: null },
		});
		const { version, onChanged } = renderField();

		fireEvent.change(screen.getByLabelText("Amount charged in EUR"), {
			target: { value: "92.17" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "card-statement.pdf" }));
		fireEvent.click(screen.getByRole("button", { name: "Save card charge" }));

		await waitFor(() => expect(onChanged).toHaveBeenCalled());
		expect(version.flush).toHaveBeenCalled();
		expect(conversionActions.saveCardChargeConversionAction).toHaveBeenCalledWith({
			reportId: "6a000000-0000-4000-8000-000000000001",
			itemId: "6a000000-0000-4000-8000-000000000002",
			expectedVersion: 3,
			chargedAmount: "92.17",
			evidenceReceiptId: "6a000000-0000-4000-8000-0000000000a2",
		});
		expect(version.adopt).toHaveBeenCalledWith(4);
	});

	it("shows the server's refusal of the charged amount", async () => {
		conversionActions.saveCardChargeConversionAction.mockResolvedValue({
			success: true,
			data: { kind: "invalid", errors: { chargedAmount: "invalid" } },
		});
		renderField();
		fireEvent.change(screen.getByLabelText("Amount charged in EUR"), {
			target: { value: "92.171" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "card-statement.pdf" }));
		fireEvent.click(screen.getByRole("button", { name: "Save card charge" }));
		expect(
			await screen.findByText("Enter the positive amount charged in EUR, with at most 2 decimals."),
		).toBeTruthy();
	});

	it("shows an authorized rate distinctly from a card charge, with its documentation", () => {
		renderField({
			conversion: {
				basis: "manual_rate",
				sourceCurrency: "USD",
				targetCurrency: "EUR",
				rate: { base: "EUR", quote: "USD", value: "1.085" },
				rateDate: "2026-09-13",
				reason: "Bank statement rate",
				evidence: "Card statement 2026-09, line 14",
				authorizedBy: { employeeId: "admin", name: "Alex Admin" },
				authorizedAt: "2026-09-20T08:00:00Z",
			},
		});
		expect(screen.getByText("Authorized rate")).toBeTruthy();
		expect(screen.getByText("1 EUR = 1.085 USD")).toBeTruthy();
		expect(screen.getByText("Alex Admin")).toBeTruthy();
		expect(screen.getByText("Bank statement rate")).toBeTruthy();
		expect(screen.getByText("Rate evidence")).toBeTruthy();
		expect(screen.getByText("Card statement 2026-09, line 14")).toBeTruthy();
		expect(screen.getByText(/counts as €92.17/)).toBeTruthy();
		// The employee may replace it with their own card charge, never edit the rate.
		expect(screen.getByRole("button", { name: "Use my card charge instead" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Remove card charge" })).toBeNull();
	});
});

const easterReference: ItemConversion = {
	basis: "reference_rate",
	sourceCurrency: "USD",
	targetCurrency: "EUR",
	rate: { base: "EUR", quote: "USD", value: "1.1525" },
	rateDate: "2026-04-02",
	expenseDate: "2026-04-05",
	source: {
		provider: "ecb",
		publicationId: "pub-1",
		publicationVersion: 1,
		contentSha256: "f".repeat(64),
		retrievedAt: "2026-04-02T15:05:00Z",
		policyApprovedAt: "2026-03-01T09:00:00Z",
	},
};

describe("CurrencyConversionField reference rates (#608)", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	function renderReference(props: Partial<Parameters<typeof CurrencyConversionField>[0]> = {}) {
		render(
			<CurrencyConversionField
				reportId="6a000000-0000-4000-8000-000000000001"
				itemId="6a000000-0000-4000-8000-000000000002"
				original={{ amount: "100.00", currency: "USD" }}
				expenseDate="2026-04-05"
				reimbursementCurrency="EUR"
				conversion={easterReference}
				referenceRate={{ status: "applied", rateDate: "2026-04-02", fallback: true }}
				receipts={receipts}
				version={{ flush: vi.fn(async () => {}), current: () => 3, adopt: vi.fn() }}
				onChanged={vi.fn()}
				{...props}
			/>,
		);
	}

	it("shows the source, the pair as published and the real publication date of a fallback", () => {
		renderReference();
		expect(screen.getByText("ECB reference rate")).toBeTruthy();
		expect(screen.getByText(/European Central Bank euro reference rate/)).toBeTruthy();
		expect(screen.getByText("1 EUR = 1.1525 USD")).toBeTruthy();
		expect(screen.getByText(/counts as €86.77/)).toBeTruthy();
		expect(
			screen.getByText(
				/No rate was published on .*2026.*, so the latest earlier publication applies/,
			),
		).toBeTruthy();
		// An evidenced card charge still takes precedence.
		expect(screen.getByRole("button", { name: "Use my card charge instead" })).toBeTruthy();
	});

	it("does not show a rate looked up for another expense date until the change is saved", () => {
		renderReference({ expenseDate: "2026-04-07" });
		expect(screen.queryByText("1 EUR = 1.1525 USD")).toBeNull();
		expect(screen.getByText(/looked up again for the new date/)).toBeTruthy();
	});

	it.each([
		["currency_unavailable", /does not publish a rate for USD on this date/],
		["not_yet_published", /not been published yet/],
		["provider_unavailable", /could not be retrieved/],
		["history_unavailable", /no reference rate for this date/],
	] as const)("guides the employee to a card charge or documented rate when %s", (reason, text) => {
		renderReference({ conversion: null, referenceRate: { status: "unavailable", reason } });
		expect(screen.getByText(text)).toBeTruthy();
		expect(
			screen.getByText(/card charge|documented rate/, { selector: "p[role=status]" }),
		).toBeTruthy();
	});
});
