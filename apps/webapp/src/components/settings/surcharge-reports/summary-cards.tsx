"use client";

import { useTranslate } from "@tolgee/react";
import { Card } from "@/components/ui/card";
import { formatMinutes } from "./helpers";

type SummaryTotals = {
	baseMinutes: number;
	qualifyingMinutes: number;
	surchargeMinutes: number;
};

type SurchargeSummaryCardsProps = {
	calculationCount: number;
	totals: SummaryTotals;
};

/** The filtered period's totals as one summary strip, separated by dividers. */
export function SurchargeSummaryCards({ calculationCount, totals }: SurchargeSummaryCardsProps) {
	const { t } = useTranslate();

	return (
		<Card className="gap-0 py-0">
			<dl className="grid divide-y sm:grid-cols-2 sm:divide-y-0 md:grid-cols-4 md:divide-x">
				<SummaryValue
					label={t("settings.surcharges.reports.summary.calculations", "Calculations")}
					value={t(
						"settings.surcharges.reports.summary.calculationCount",
						"{count, plural, one {# calculation} other {# calculations}}",
						{ count: calculationCount },
					)}
				/>
				<SummaryValue
					label={t("settings.surcharges.reports.summary.baseHours", "Base hours")}
					value={formatMinutes(totals.baseMinutes)}
				/>
				<SummaryValue
					label={t(
						"settings.surcharges.reports.summary.qualifyingHours",
						"Qualifying surcharge hours",
					)}
					value={formatMinutes(totals.qualifyingMinutes)}
				/>
				<SummaryValue
					label={t("settings.surcharges.reports.summary.creditedHours", "Credited surcharge hours")}
					value={formatMinutes(totals.surchargeMinutes)}
				/>
			</dl>
		</Card>
	);
}

function SummaryValue({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 space-y-1 px-6 py-4">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="font-semibold text-2xl tabular-nums">{value}</dd>
		</div>
	);
}
