"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardContent } from "@/components/ui/card";
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

export function SurchargeSummaryCards({
	calculationCount,
	totals,
}: SurchargeSummaryCardsProps) {
	const { t } = useTranslate();

	return (
		<div className="grid gap-4 md:grid-cols-4">
			<SummaryCard
				label={t(
					"settings.surcharges.reports.summary.calculations",
					"Calculations",
				)}
				value={`${calculationCount} calculation${calculationCount === 1 ? "" : "s"}`}
			/>
			<SummaryCard
				label={t("settings.surcharges.reports.summary.baseHours", "Base hours")}
				value={formatMinutes(totals.baseMinutes)}
			/>
			<SummaryCard
				label={t(
					"settings.surcharges.reports.summary.qualifyingHours",
					"Qualifying surcharge hours",
				)}
				value={formatMinutes(totals.qualifyingMinutes)}
			/>
			<SummaryCard
				label={t(
					"settings.surcharges.reports.summary.creditedHours",
					"Credited surcharge hours",
				)}
				value={formatMinutes(totals.surchargeMinutes)}
			/>
		</div>
	);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardContent className="space-y-1">
				<div className="text-muted-foreground text-sm">{label}</div>
				<div className="font-semibold text-2xl">{value}</div>
			</CardContent>
		</Card>
	);
}
