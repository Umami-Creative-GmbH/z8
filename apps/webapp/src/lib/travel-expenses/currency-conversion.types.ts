/**
 * The recorded conversion of a foreign-currency expense (#607, #608). Kept
 * free of imports: the database schema references these, and every runtime
 * image that loads the schema would otherwise need the conversion logic's
 * dependencies. `currency-conversion.ts` re-exports them and documents the
 * bases.
 */

export const CONVERSION_BASES = ["card_charge", "manual_rate", "reference_rate"] as const;
export type ConversionBasis = (typeof CONVERSION_BASES)[number];

/** `1 base = value quote`; the pair is the item's two currencies, in either order. */
export interface ExchangeRate {
	base: string;
	quote: string;
	/** Positive plain decimal with at most `MAX_RATE_FRACTION_DIGITS` decimals. */
	value: string;
}

interface ConversionPair {
	/** The original (receipt) currency the conversion was recorded for. */
	sourceCurrency: string;
	/** The reimbursement currency of the report. */
	targetCurrency: string;
}

export interface CardChargeConversion extends ConversionPair {
	basis: "card_charge";
	/** What the card was actually charged, in the reimbursement currency ("92.17"). */
	chargedAmount: string;
	/** The item's attachment showing the charge; null once that file was removed. */
	evidenceReceiptId: string | null;
}

export interface ManualRateConversion extends ConversionPair {
	basis: "manual_rate";
	rate: ExchangeRate;
	/** Calendar date the rate applies to; it has no zone. */
	rateDate: string;
	/** Why and from which source the administrator documented this rate. */
	reason: string;
	/** Where the rate can be verified: the document, statement line or reference (0133). */
	evidence: string;
	authorizedBy: { employeeId: string; name: string };
	/** Canonical UTC instant of the authorization. */
	authorizedAt: string;
}

/** Where an applied reference rate came from, kept with it (#608). */
export interface ReferenceRateSource {
	provider: "ecb";
	/** The stored publication version that was applied. */
	publicationId: string;
	/** 1 for the first publication of its date; a correction is a later version. */
	publicationVersion: number;
	/** SHA-256 of the publication's canonical rates. */
	contentSha256: string;
	/** Canonical UTC instant this publication version was fetched. */
	retrievedAt: string;
	/** Canonical UTC instant the organization approved the reference source. */
	policyApprovedAt: string;
}

export interface ReferenceRateConversion extends ConversionPair {
	basis: "reference_rate";
	/** As published: `1 EUR = value X`, in either direction of the item's pair. */
	rate: ExchangeRate;
	/** The publication's own date; before `expenseDate` when it is a fallback. */
	rateDate: string;
	/** The expense date the publication was chosen for. */
	expenseDate: string;
	source: ReferenceRateSource;
}

/** The conversion recorded for one item. */
export type ItemConversion = CardChargeConversion | ManualRateConversion | ReferenceRateConversion;
