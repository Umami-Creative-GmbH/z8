import { describe, expect, it, vi } from "vitest";
import { TRAVEL_EXPENSE_VALIDATION_MESSAGES } from "@/lib/travel-expenses/types";

vi.mock("@/app/[locale]/(app)/travel-expenses/actions", () => ({
	createTravelExpenseDraft: vi.fn(),
}));

const { getClaimValidationError } = await import("./travel-expense-claim-dialog");

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
