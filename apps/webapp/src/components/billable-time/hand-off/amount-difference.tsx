"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useDisplayContext } from "@/hooks/use-display-context";
import { formatBillableAmount } from "@/lib/billable-time/format";
import type {
	AmountDifferenceView,
	ItemAmountDifferenceView,
} from "@/lib/billable-time/hand-off/views";

/** Amount differences in the viewer's language (#1502). */
export function useAmountDifferenceLabels() {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();

	/** A signed amount in the draft's currency: "+€25.00", "-€150.00". */
	const amount = (value: string, currency: string): string =>
		formatBillableAmount(locale, value, currency, { signDisplay: "exceptZero" });

	/** The difference's amount, or "Unknown" (never zero). */
	const value = (difference: AmountDifferenceView, currency: string): string =>
		difference.kind === "unknown"
			? t("settings.billableTime.handOff.amount.unknown", "Unknown")
			: amount(difference.amount, currency);

	const reason = (difference: AmountDifferenceView): string => {
		switch (difference.reason) {
			case "frozen_rate":
				return t(
					"settings.billableTime.handOff.amount.reason.frozenRate",
					"The change in hours at the rate frozen at hand-off.",
				);
			case "removed":
				return t(
					"settings.billableTime.handOff.amount.reason.removed",
					"The work was deleted, so its whole handed-off amount reverses.",
				);
			case "non_billable":
				return t(
					"settings.billableTime.handOff.amount.reason.nonBillable",
					"The work is no longer billable, so its whole handed-off amount reverses.",
				);
			case "customer":
				return t(
					"settings.billableTime.handOff.amount.reason.customer",
					"The project now belongs to another customer or to none, so the whole handed-off amount reverses.",
				);
			case "several_rates":
				return t(
					"settings.billableTime.handOff.amount.reason.severalRates",
					"The hand-off priced this work at several rates; that split can't be repeated without today's rates.",
				);
			case "other_project":
				return t(
					"settings.billableTime.handOff.amount.reason.otherProject",
					"The work moved to another project of the same customer, which has no rate frozen at hand-off.",
				);
			case "running":
				return t(
					"settings.billableTime.handOff.amount.reason.running",
					"Part of the work is still running.",
				);
			case "no_frozen_rate":
				return t(
					"settings.billableTime.handOff.amount.reason.noFrozenRate",
					"No rate was frozen for this work at hand-off.",
				);
		}
	};

	return { amount, value, reason };
}

/**
 * A comparison item's amount difference (#1502): from the hand-off and, once
 * resolved, since the last resolution. Reconciliation information, priced at
 * the rate frozen at hand-off; unknown differences give their reason.
 */
export function AmountDifference({ difference }: { difference: ItemAmountDifferenceView }) {
	const { t } = useTranslate();
	const labels = useAmountDifferenceLabels();
	const { currency, fromHandOff, sinceResolution } = difference;
	const shown = [fromHandOff, ...(sinceResolution ? [sinceResolution] : [])];
	const estimated = shown.some((entry) => entry.kind === "estimated");
	const roundingCaveat = shown.some((entry) => entry.kind !== "unknown" && entry.roundingCaveat);
	const unknownSince =
		sinceResolution?.kind === "unknown" && sinceResolution.reason !== fromHandOff.reason
			? sinceResolution
			: null;

	return (
		<div className="space-y-1 text-sm">
			<p className="flex flex-wrap items-baseline gap-x-2">
				<span className="text-muted-foreground">
					{t("settings.billableTime.handOff.amount.title", "Amount difference")}
				</span>
				<span className="font-medium tabular-nums">{labels.value(fromHandOff, currency)}</span>
				{sinceResolution && (
					<span className="text-muted-foreground">
						{t(
							"settings.billableTime.handOff.amount.sinceResolution",
							"Since the last resolution: {amount}",
							{ amount: labels.value(sinceResolution, currency) },
						)}
					</span>
				)}
			</p>
			<p className="text-muted-foreground text-xs">
				{labels.reason(fromHandOff)}
				{unknownSince && <> {labels.reason(unknownSince)}</>}
				{estimated && (
					<>
						{" "}
						{t(
							"settings.billableTime.handOff.amount.estimated",
							"Estimated: this hand-off stored no amount per work period, so rate × duration stands in.",
						)}
					</>
				)}
				{roundingCaveat && (
					<>
						{" "}
						{t(
							"settings.billableTime.handOff.amount.roundingCaveat",
							"It may be a few cents off the draft line's rounding.",
						)}
					</>
				)}
			</p>
			{difference.notOnHandOffForNewCustomer && (
				<p
					role="status"
					className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
				>
					<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					<span>
						{t(
							"settings.billableTime.handOff.amount.notOnHandOff",
							"Its project now belongs to another customer. This work is not on any hand-off for that customer and stays invoiced in this draft, so invoice it to the new customer in the accounting tool.",
						)}
					</span>
				</p>
			)}
		</div>
	);
}
