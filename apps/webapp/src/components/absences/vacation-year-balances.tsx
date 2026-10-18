"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { AbsencePlanBalancePreview } from "@/lib/absences/absence-plan-preview";
import { formatDays } from "@/lib/absences/date-utils";
import { exceedsYearBalance } from "@/lib/absences/vacation-year-balance";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { cn } from "@/lib/utils";

type TranslateFn = ReturnType<typeof useTranslate>["t"];

/**
 * What a request does to each calendar year's vacation balance (#1340): the days it charges, the
 * recorded balance and the estimate after it, or why the balance is unavailable; and when the
 * balances were read.
 */
export function VacationYearBalances({
	balances,
	evaluatedAt,
}: {
	balances: readonly AbsencePlanBalancePreview[];
	evaluatedAt: string;
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	return (
		<div className="space-y-2">
			<ul className="space-y-2">
				{balances.map((balance) => (
					<VacationYearBalanceRow balance={balance} key={balance.year} t={t} />
				))}
			</ul>
			<p className="text-muted-foreground text-xs">
				{t(
					"absences.planPreview.balancesEvaluatedAt",
					"Recorded balances as of {time}. Estimates, not guaranteed future balances.",
					{ time: formatInstant(parseInstant(evaluatedAt), displayContext, "dateTimeMedium") },
				)}
			</p>
		</div>
	);
}

function VacationYearBalanceRow({
	balance,
	t,
}: {
	balance: AbsencePlanBalancePreview;
	t: TranslateFn;
}) {
	const yearId = useId();
	// A string, so the message format doesn't group the year's digits.
	const year = String(balance.year);
	const exceeded = exceedsYearBalance(balance);
	return (
		<li aria-labelledby={yearId} className="rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
			<div className="flex items-baseline justify-between gap-3">
				<span className="font-medium tabular-nums" id={yearId}>
					{year}
				</span>
				<span className="text-muted-foreground text-xs">
					{t("absences.planPreview.yearCharged", "{days} charged", {
						days: formatDays(balance.chargedAbsenceDays, t),
					})}
				</span>
			</div>
			{balance.status === "available" ? (
				<div className="mt-1 space-y-1">
					<BalanceMetric
						label={t("absences.planPreview.currentRecordedBalance", "Current recorded balance")}
						value={formatDays(balance.remainingDays, t)}
					/>
					<BalanceMetric
						label={t("absences.planPreview.estimatedAfterRequest", "Estimated after request")}
						value={formatDays(balance.remainingAfterRequest, t)}
						valueClassName={exceeded ? "text-destructive" : undefined}
					/>
				</div>
			) : (
				<p className="mt-1 text-muted-foreground">{unavailableBalanceMessage(balance, t)}</p>
			)}
			{exceeded ? (
				<p className="mt-1 flex items-start gap-2 text-destructive">
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>
						{t(
							"absences.planPreview.yearExceeded",
							"This request exceeds your recorded balance for {year}.",
							{ year },
						)}
					</span>
				</p>
			) : null}
			{balance.futureYear && balance.status === "available" ? (
				<p className="mt-1 text-muted-foreground text-xs">
					{t(
						"absences.planPreview.futureYearNotCounted",
						"Carryover and accrual for {year} are not counted yet.",
						{ year },
					)}
				</p>
			) : null}
		</li>
	);
}

function BalanceMetric({
	label,
	value,
	valueClassName,
}: {
	label: string;
	value: string;
	valueClassName?: string;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-muted-foreground">{label}</span>
			<span className={cn("font-medium tabular-nums", valueClassName)}>{value}</span>
		</div>
	);
}

function unavailableBalanceMessage(
	balance: Extract<AbsencePlanBalancePreview, { status: "unavailable" }>,
	t: TranslateFn,
) {
	const year = String(balance.year);
	switch (balance.reason) {
		case "missing_policy":
			return t(
				"absences.planPreview.balanceUnavailableMissingPolicy",
				"Balance unavailable: no vacation policy covers {year} yet. You can still submit.",
				{ year },
			);
		case "conflicting_policy":
			return t(
				"absences.planPreview.balanceUnavailableConflictingPolicy",
				"Balance unavailable: conflicting vacation policies for {year} need review. You can still submit.",
				{ year },
			);
		case "read_failed":
			return t(
				"absences.planPreview.balanceUnavailableReadFailed",
				"Balance unavailable: the {year} balance could not be read. You can still submit.",
				{ year },
			);
	}
}
