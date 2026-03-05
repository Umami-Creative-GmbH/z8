import {
	TRAVEL_EXPENSE_VALIDATION_MESSAGES,
	type MileageClaimValidationInput,
	type PerDiemClaimValidationInput,
	type ReceiptClaimValidationInput,
	type TravelExpenseClaimValidationInput,
	type TravelExpenseValidationCode,
} from "./types";

export class TravelExpenseValidationError extends Error {
	readonly code: TravelExpenseValidationCode;

	constructor(code: TravelExpenseValidationCode) {
		super(TRAVEL_EXPENSE_VALIDATION_MESSAGES[code]);
		this.name = "TravelExpenseValidationError";
		this.code = code;
	}
}

function throwValidationError(code: TravelExpenseValidationCode): never {
	throw new TravelExpenseValidationError(code);
}

function ensurePositive(value: number, errorCode: TravelExpenseValidationCode): void {
	if (value <= 0) {
		throwValidationError(errorCode);
	}
}

export function validateReceiptClaim(input: ReceiptClaimValidationInput): void {
	ensurePositive(input.amount, "AMOUNT_MUST_BE_POSITIVE");

	if (input.attachmentsCount < 1) {
		throwValidationError("RECEIPT_ATTACHMENT_REQUIRED");
	}
}

export function validateMileageClaim(input: MileageClaimValidationInput): void {
	ensurePositive(input.kilometers, "KILOMETERS_MUST_BE_POSITIVE");
	ensurePositive(input.ratePerKm, "RATE_PER_KM_MUST_BE_POSITIVE");
}

export function validatePerDiemClaim(input: PerDiemClaimValidationInput): void {
	ensurePositive(input.dayCount, "DAY_COUNT_MUST_BE_POSITIVE");
	ensurePositive(input.dailyRate, "DAILY_RATE_MUST_BE_POSITIVE");
}

export function validateTravelExpenseClaim(input: TravelExpenseClaimValidationInput): void {
	switch (input.type) {
		case "receipt":
			validateReceiptClaim(input);
			return;
		case "mileage":
			validateMileageClaim(input);
			return;
		case "per_diem":
			validatePerDiemClaim(input);
			return;
		default:
			throwValidationError("UNKNOWN_CLAIM_TYPE");
	}
}
