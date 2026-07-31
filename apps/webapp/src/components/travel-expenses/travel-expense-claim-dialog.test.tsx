/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { TRAVEL_EXPENSE_VALIDATION_MESSAGES } from "@/lib/travel-expenses/types";

const { createTravelExpenseDraft } = vi.hoisted(() => ({
	createTravelExpenseDraft: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/travel-expenses/actions", () => ({
	createTravelExpenseDraft,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: forwardRef<
		HTMLButtonElement,
		{ name: string; onChange: (value: string) => void; value: string }
	>(function DatePicker({ name, onChange, value }, ref) {
		return (
			<input
				aria-label={name === "tripStart" ? "Trip Start" : "Trip End"}
				onChange={(event) => onChange(event.target.value)}
				ref={ref as React.Ref<HTMLInputElement>}
				value={value}
			/>
		);
	}),
}));

const { getClaimValidationError } = await import(
	"./travel-expense-claim-utils"
);
const { TravelExpenseClaimDialog } = await import(
	"./travel-expense-claim-dialog"
);

function getAmountInput(): HTMLInputElement {
	const input = document.querySelector<HTMLInputElement>(
		'input[name="amount"]',
	);
	if (!input) throw new Error("Amount input not found");
	return input;
}

describe("getClaimValidationError", () => {
	it("returns receipt-required message for receipt with 0 attachments", () => {
		expect(getClaimValidationError("receipt", 0)).toBe(
			TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED,
		);
	});

	it("returns null for mileage with 0 attachments", () => {
		expect(getClaimValidationError("mileage", 0)).toBeNull();
	});
});

describe("TravelExpenseClaimDialog", () => {
	it("focuses invalid trip dates and does not invoke the draft mutation", async () => {
		createTravelExpenseDraft.mockReset();
		render(<TravelExpenseClaimDialog open onOpenChange={vi.fn()} />);

		const submitButton = screen.getByRole("button", { name: "Create Draft" });
		fireEvent.submit(submitButton.closest("form") as HTMLFormElement);

		expect(
			await screen.findByText("Please provide a valid trip start date"),
		).toBeTruthy();
		expect(
			screen.getByText("Please provide a valid trip end date"),
		).toBeTruthy();
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByLabelText("Trip Start")),
		);
		expect(createTravelExpenseDraft).not.toHaveBeenCalled();
	});

	it("creates a receipt draft before attachments can be uploaded", async () => {
		createTravelExpenseDraft.mockReset();
		createTravelExpenseDraft.mockResolvedValue({
			success: true,
			data: { id: "claim-1" },
		});
		render(<TravelExpenseClaimDialog open onOpenChange={vi.fn()} />);

		fireEvent.change(screen.getByLabelText("Trip Start"), {
			target: { value: "2026-05-12" },
		});
		fireEvent.change(screen.getByLabelText("Trip End"), {
			target: { value: "2026-05-14" },
		});
		fireEvent.change(getAmountInput(), {
			target: { value: "42" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));

		await waitFor(() =>
			expect(createTravelExpenseDraft).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "receipt",
					tripStart: "2026-05-12",
					tripEnd: "2026-05-14",
				}),
			),
		);
	});

	it("resets entered values through the canonical close path when Cancel is clicked", () => {
		const onOpenChange = vi.fn();
		render(<TravelExpenseClaimDialog open onOpenChange={onOpenChange} />);

		fireEvent.change(getAmountInput(), {
			target: { value: "42" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(getAmountInput().value).toBe("");
	});
});
