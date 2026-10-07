"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";
import { parseUnits } from "@/lib/travel-expenses/money";
import { formatMoney, formatPlainDate } from "./format";
import { formatPrecise, formatRatePerKm, policySourceLabel } from "./mileage-labels";

/** The facts of a priced mileage item, live (calculated) or frozen (submitted). */
export interface MileageBreakdownFacts {
	distanceKm: string;
	ratePerKm: string;
	currency: string;
	exactAmount: string;
	amount: string;
	policy: { effectiveFrom: string; source: AllowancePolicySource };
}

/** Whether the exact product was rounded to the amount: compared as exact decimals. */
function isRounded(exactAmount: string, amount: string): boolean {
	const scale = Math.max(exactAmount.split(".")[1]?.length ?? 0, amount.split(".")[1]?.length ?? 0);
	const exact = parseUnits(exactAmount, scale);
	const rounded = parseUnits(amount, scale);
	return exact === null || rounded === null ? exactAmount !== amount : exact !== rounded;
}

function formatDistance(locale: string, distanceKm: string) {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
		distanceKm as Intl.StringNumericLiteral,
	);
}

/**
 * How a mileage amount was calculated: distance × the applied dated rate,
 * rounded once to cents, and which policy version supplied the rate.
 */
export function MileageBreakdown({ facts }: { facts: MileageBreakdownFacts }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const rounded = isRounded(facts.exactAmount, facts.amount);
	return (
		<div className="space-y-1 text-sm">
			<p className="tabular-nums">
				{t(
					"travelExpenses.report.mileage.calculation",
					"{distance} km × {rate} per km = {amount}",
					{
						distance: formatDistance(locale, facts.distanceKm),
						rate: formatRatePerKm(locale, facts.ratePerKm, facts.currency),
						amount: formatMoney(locale, facts.amount, facts.currency),
					},
				)}
				{rounded && (
					<span className="text-muted-foreground">
						{" "}
						{t("travelExpenses.report.mileage.rounded", "(exactly {exact}, rounded to the cent)", {
							exact: formatPrecise(locale, facts.exactAmount, facts.currency, 6),
						})}
					</span>
				)}
			</p>
			<p className="text-muted-foreground">
				{t("travelExpenses.report.mileage.appliedPolicy", "Rate valid from {date} · {source}", {
					date: formatPlainDate(locale, facts.policy.effectiveFrom),
					source: policySourceLabel(t, facts.policy.source),
				})}
			</p>
		</div>
	);
}
