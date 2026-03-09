export type TravelExpenseClaimType = "receipt" | "mileage" | "per_diem";

export interface MileageAmountInput {
	kilometers: number;
	ratePerKm: number;
}

export interface PerDiemAmountInput {
	dayCount: number;
	dailyRate: number;
}

export interface ReceiptClaimValidationInput {
	amount: number;
	attachmentsCount: number;
}

export interface MileageClaimValidationInput extends MileageAmountInput {}

export interface PerDiemClaimValidationInput extends PerDiemAmountInput {}

export type TravelExpenseClaimValidationInput =
	| ({ type: "receipt" } & ReceiptClaimValidationInput)
	| ({ type: "mileage" } & MileageClaimValidationInput)
	| ({ type: "per_diem" } & PerDiemClaimValidationInput);

export const TRAVEL_EXPENSE_VALIDATION_MESSAGES = {
	UNKNOWN_CLAIM_TYPE: "Unknown travel expense claim type",
	AMOUNT_MUST_BE_POSITIVE: "Amount must be positive",
	RECEIPT_ATTACHMENT_REQUIRED: "Receipt attachment required",
	KILOMETERS_MUST_BE_POSITIVE: "Kilometers must be positive",
	RATE_PER_KM_MUST_BE_POSITIVE: "Rate per kilometer must be positive",
	DAY_COUNT_MUST_BE_POSITIVE: "Day count must be positive",
	DAILY_RATE_MUST_BE_POSITIVE: "Daily rate must be positive",
} as const;

export type TravelExpenseValidationCode = keyof typeof TRAVEL_EXPENSE_VALIDATION_MESSAGES;
