/**
 * The legacy draft snapshot and conversion flags (#616). Kept free of imports:
 * the database schema references these, and every runtime image that loads
 * the schema would otherwise need the conversion logic's dependencies.
 * `legacy-draft-conversion.ts` re-exports them.
 */

export const LEGACY_CLAIM_TYPES = ["receipt", "mileage", "per_diem"] as const;
export type LegacyClaimType = (typeof LEGACY_CLAIM_TYPES)[number];

/** The legacy draft's facts as stored; `trip*Date` are null for claims from before date capture. */
export interface LegacyDraftClaim {
	id: string;
	type: LegacyClaimType;
	tripStartDate: string | null;
	tripEndDate: string | null;
	tripDateTimeZone: string | null;
	destinationCity: string | null;
	destinationCountry: string | null;
	projectId: string | null;
	originalAmount: string;
	originalCurrency: string;
	calculatedAmount: string;
	calculatedCurrency: string;
	notes: string | null;
}

/**
 * The legacy draft exactly as it was when it was converted, kept on the
 * conversion record: everything the employee entered, including what the new
 * model could not hold (a typed mileage total, a travel range, free-text
 * country), and which report receipt continues which legacy attachment.
 */
export interface LegacyDraftSnapshot extends Omit<LegacyDraftClaim, "id"> {
	createdAt: string;
	attachments: {
		attachmentId: string;
		receiptId: string;
		fileName: string;
		storageKey: string;
		checksumSha256: string;
	}[];
}

/**
 * What the converted draft lacks because the legacy draft did not record it
 * in a form the new model accepts. The editors' own requirements show the
 * empty fields; these explain why they are empty.
 */
export const LEGACY_CONVERSION_FLAGS = [
	/** A multi-day legacy range: the employee picks the expense's own date. */
	"expense_date_unknown",
	/** Created before logical dates were captured: no date is carried over. */
	"trip_dates_not_recorded",
	/** The legacy country text matches no country code; the employee chooses it. */
	"destination_unmatched",
	/** The legacy receipt amount or currency is not a valid amount in the new model. */
	"amount_not_carried",
	/** A mileage or per diem total was typed in; it is kept for reference only. */
	"manual_total_not_used",
	/** The notes did not fit a field of the new expense; they stay readable on the legacy draft. */
	"notes_not_carried",
	/** The legacy project was carried over; submission still needs proven eligibility or an exception. */
	"project_eligibility_required",
	/** The legacy project no longer exists in the organization. */
	"project_not_carried",
	/**
	 * A foreign-currency legacy receipt (#616): it needs a conversion into the
	 * reimbursement currency, which the legacy draft never recorded.
	 */
	"conversion_required",
] as const;
export type LegacyConversionFlag = (typeof LEGACY_CONVERSION_FLAGS)[number];
