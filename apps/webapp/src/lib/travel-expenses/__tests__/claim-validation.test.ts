import { describe, expect, it } from "vitest";
import {
	TravelExpenseValidationError,
	validateMileageClaim,
	validatePerDiemClaim,
	validateReceiptClaim,
	validateTravelExpenseClaim,
} from "@/lib/travel-expenses/claim-validation";
import { TRAVEL_EXPENSE_VALIDATION_MESSAGES } from "@/lib/travel-expenses/types";

describe("travel-expense claim validation", () => {
	it("accepts valid receipt claim input", () => {
		expect(() => validateReceiptClaim({ amount: 99.9, attachmentsCount: 1 })).not.toThrow();
	});

	it("rejects receipt claim when amount is not positive", () => {
		expect(() => validateReceiptClaim({ amount: 0, attachmentsCount: 1 })).toThrowError(
			TRAVEL_EXPENSE_VALIDATION_MESSAGES.AMOUNT_MUST_BE_POSITIVE,
		);
	});

	it("rejects receipt claim when no attachment is provided", () => {
		expect(() => validateReceiptClaim({ amount: 10, attachmentsCount: 0 })).toThrowError(
			TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED,
		);
	});

	it("rejects mileage claim when kilometers are not positive", () => {
		expect(() => validateMileageClaim({ kilometers: 0, ratePerKm: 0.42 })).toThrowError(
			TRAVEL_EXPENSE_VALIDATION_MESSAGES.KILOMETERS_MUST_BE_POSITIVE,
		);
	});

	it("rejects per diem claim when day count is not positive", () => {
		expect(() => validatePerDiemClaim({ dayCount: 0, dailyRate: 28 })).toThrowError(
			TRAVEL_EXPENSE_VALIDATION_MESSAGES.DAY_COUNT_MUST_BE_POSITIVE,
		);
	});

	it("validates claim by type", () => {
		expect(() =>
			validateTravelExpenseClaim({ type: "receipt", amount: 12, attachmentsCount: 1 }),
		).not.toThrow();
		expect(() =>
			validateTravelExpenseClaim({ type: "mileage", kilometers: 15, ratePerKm: 0.42 }),
		).not.toThrow();
		expect(() =>
			validateTravelExpenseClaim({ type: "per_diem", dayCount: 2, dailyRate: 28 }),
		).not.toThrow();
	});

	it("throws typed validation error for unknown claim type", () => {
		try {
			validateTravelExpenseClaim({
				type: "unknown",
			} as unknown as Parameters<typeof validateTravelExpenseClaim>[0]);
			throw new Error("Expected validateTravelExpenseClaim to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(TravelExpenseValidationError);
			expect((error as TravelExpenseValidationError).code).toBe("UNKNOWN_CLAIM_TYPE");
			expect((error as Error).message).toBe(
				TRAVEL_EXPENSE_VALIDATION_MESSAGES.UNKNOWN_CLAIM_TYPE,
			);
		}
	});
});
