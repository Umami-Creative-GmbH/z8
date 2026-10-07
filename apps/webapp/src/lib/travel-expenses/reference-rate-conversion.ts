import type { ItemConversion, ReferenceRateConversion } from "./currency-conversion";
import type { ReferenceRateResolution, ReferenceRateUnavailableReason } from "./reference-rate";

/**
 * How an approved reference rate (#608) becomes an item's conversion. A
 * reference conversion is derived, never entered: drafts resolve it from the
 * stored publications on every read, and only a submission stores the one it
 * froze. A card charge or documented rate recorded for the item's exact pair
 * always takes precedence.
 */

/** The conversion an applied reference rate gives an item. */
export function referenceRateConversion(
	resolution: Extract<ReferenceRateResolution, { status: "applied" }>,
	context: {
		sourceCurrency: string;
		targetCurrency: string;
		expenseDate: string;
		policyApprovedAt: string;
	},
): ReferenceRateConversion {
	const { publication } = resolution;
	return {
		basis: "reference_rate",
		sourceCurrency: context.sourceCurrency,
		targetCurrency: context.targetCurrency,
		rate: { ...resolution.rate },
		rateDate: publication.publicationDate,
		expenseDate: context.expenseDate,
		source: {
			provider: publication.provider,
			publicationId: publication.id,
			publicationVersion: publication.version,
			contentSha256: publication.contentSha256,
			retrievedAt: publication.retrievedAt,
			policyApprovedAt: context.policyApprovedAt,
		},
	};
}

/** Why a foreign item has no reference rate, as shown next to its conversion. */
export type ReferenceRateItemStatus =
	| { status: "applied"; rateDate: string; fallback: boolean }
	| { status: "unavailable"; reason: ReferenceRateUnavailableReason | "expense_date_missing" };

/** Whether a recorded (entered or authorized) conversion covers the item's pair. */
export function recordedConversionApplies(
	conversion: ItemConversion | null | undefined,
	pair: { sourceCurrency: string; targetCurrency: string },
): boolean {
	return (
		!!conversion &&
		conversion.basis !== "reference_rate" &&
		conversion.sourceCurrency === pair.sourceCurrency &&
		conversion.targetCurrency === pair.targetCurrency
	);
}

/**
 * Whether a saved item edit changes which reference rate applies, so the
 * editor reloads the report to show the newly looked-up conversion.
 */
export function referenceRateReloadNeeded(
	provider: string | null | undefined,
	loaded: { expenseDate: string | null; currency: string | null },
	saved: { expenseDate: string | null; currency: string | null },
): boolean {
	return (
		!!provider && (loaded.expenseDate !== saved.expenseDate || loaded.currency !== saved.currency)
	);
}

/**
 * What the employee's submission review saw of an item's reference rate: the
 * exact publication version. A correction or a newly fetched publication
 * between review and submission is a change the employee has not reviewed.
 */
export function referenceRateReviewKey(
	conversion: ItemConversion | null | undefined,
): string | null {
	if (conversion?.basis !== "reference_rate") return null;
	return `${conversion.source.provider}:${conversion.source.publicationId}:${conversion.rate.base}/${conversion.rate.quote}`;
}
