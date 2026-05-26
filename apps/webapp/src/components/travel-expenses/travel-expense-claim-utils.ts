import {
	TRAVEL_EXPENSE_VALIDATION_MESSAGES,
	type TravelExpenseClaimType,
} from "@/lib/travel-expenses/types";

function getClaimValidationError(
	type: TravelExpenseClaimType,
	attachmentCount: number,
): string | null {
	if (type === "receipt" && attachmentCount < 1) {
		return TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED;
	}

	return null;
}

export { getClaimValidationError };
