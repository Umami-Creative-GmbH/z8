"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useMemo } from "react";
import { PreviouslyTakenVacationExplanation } from "@/components/absences/previously-taken-vacation-explanation";
import type { EarningYearBalance, VacationBalance } from "@/lib/absences/types";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { cn } from "@/lib/utils";
import { VacationAllowanceExplanation } from "./vacation-allowance-explanation";

interface VacationBalanceCardProps {
	balance: VacationBalance;
	now: string;
	timezone: string;
}

/** Shares of the allowance for the bar; display only, the balance itself is authoritative. */
function allowanceShares(balance: VacationBalance) {
	if (balance.totalDays <= 0) return null;
	const used = Math.min(Math.max(balance.usedDays, 0), balance.totalDays);
	const pending = Math.min(Math.max(balance.pendingDays, 0), balance.totalDays - used);
	return {
		used: (used / balance.totalDays) * 100,
		pending: (pending / balance.totalDays) * 100,
	};
}

/**
 * Carried leave by the year it was earned (#2080): what is left of each year and whether it can
 * lapse. Unclassified and German-protected days stay available; only an established deadline is
 * shown as one.
 */
function EarningYearLeaveList({
	rows,
	locale,
	timezone,
	numberFormat,
}: {
	rows: readonly EarningYearBalance[];
	locale: string;
	timezone: string;
	numberFormat: Intl.NumberFormat;
}) {
	const { t } = useTranslate();
	return (
		<ul className="mt-1 space-y-1 text-muted-foreground">
			{rows.map((row) => {
				const deadline = row.expiryDate
					? formatPlainDate(
							instantFromDate(row.expiryDate).toZonedDateTimeISO(timezone).toPlainDate(),
							locale,
							"dateMedium",
						)
					: null;
				const days = numberFormat.format(row.remainingDays);
				const text = row.expired
					? t("absences.balance.earningYearExpired", "From {year}: expired on {date}", {
							year: row.earningYear,
							date: deadline ?? "",
						})
					: deadline
						? t(
								"absences.balance.earningYearExpiring",
								"From {year}: {count} days left, available until {date}",
								{ year: row.earningYear, count: days, date: deadline },
							)
						: row.protection === "unclassified"
							? t(
									"absences.balance.earningYearOutstanding",
									"From {year}: {count} days left, kept while your employer reviews the leave rules",
									{ year: row.earningYear, count: days },
								)
							: t(
									"absences.balance.earningYearProtected",
									"From {year}: {count} days left, with no set expiry date",
									{ year: row.earningYear, count: days },
								);
				return (
					<li key={`${row.earningYear}-${row.portion}`} className="tabular-nums">
						{text}
					</li>
				);
			})}
		</ul>
	);
}

/** The employee's vacation balance for the year: what is left first, then what is used or pending. */
export function VacationBalanceCard({ balance, now, timezone }: VacationBalanceCardProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
	const hasCarryover = Boolean(balance.carryoverDays && balance.carryoverDays > 0);
	const nowInstant = parseInstant(now);
	const carryoverExpiryInstant = balance.carryoverExpiryDate
		? instantFromDate(balance.carryoverExpiryDate)
		: null;
	const carryoverExpiringSoon = Boolean(
		hasCarryover &&
		carryoverExpiryInstant &&
		carryoverExpiryInstant.epochNanoseconds < nowInstant.add({ hours: 30 * 24 }).epochNanoseconds,
	);
	const carryoverExpiry = carryoverExpiryInstant
		? formatPlainDate(
				carryoverExpiryInstant.toZonedDateTimeISO(timezone).toPlainDate(),
				locale,
				"dateMedium",
			)
		: null;
	const shares = allowanceShares(balance);
	const daysUnit = t("common.days.label", "days");

	return (
		<section aria-labelledby="vacation-balance-title" className="rounded-xl border bg-card p-5">
			<h2 id="vacation-balance-title" className="font-semibold">
				{t("absences.balance.title", "Vacation Balance {year}", {
					year: balance.year,
				})}
			</h2>

			<div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 @3xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
				<div className="col-span-2 min-w-0 @3xl/main:col-span-1">
					<div className="font-medium text-muted-foreground text-sm">
						{t("absences.balance.daysRemaining", "Days Remaining")}
					</div>
					<div className="mt-1 flex flex-wrap items-baseline gap-x-2">
						<span className="font-semibold text-3xl tabular-nums">
							{numberFormat.format(balance.remainingDays)}
						</span>
						<span className="text-muted-foreground text-sm">{daysUnit}</span>
					</div>
					<div className="mt-1 text-muted-foreground text-sm">
						{t("absences.balance.outOfTotalDays", "out of {totalDays} total days", {
							totalDays: numberFormat.format(balance.totalDays),
						})}
					</div>
					<VacationAllowanceExplanation
						allowance={balance.allowance}
						year={balance.year}
						className="mt-1"
					/>
				</div>

				<div className="min-w-0 @3xl/main:border-l @3xl/main:pl-6">
					<div className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
						<span aria-hidden="true" className="size-2.5 rounded-sm bg-primary" />
						{t("absences.balance.used", "Used")}
					</div>
					<div className="mt-1 flex flex-wrap items-baseline gap-x-2">
						<span className="font-semibold text-2xl tabular-nums">
							{numberFormat.format(balance.usedDays)}
						</span>
						<span className="text-muted-foreground text-sm">{daysUnit}</span>
					</div>
					<PreviouslyTakenVacationExplanation
						days={balance.previouslyTakenDays}
						className="mt-1 text-muted-foreground text-xs"
					/>
				</div>

				<div className="min-w-0 border-l pl-6">
					<div className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
						<span aria-hidden="true" className="size-2.5 rounded-sm bg-amber-500/70" />
						{t("absences.balance.pending", "Pending")}
					</div>
					<div className="mt-1 flex flex-wrap items-baseline gap-x-2">
						<span className="font-semibold text-2xl tabular-nums">
							{numberFormat.format(balance.pendingDays)}
						</span>
						<span className="text-muted-foreground text-sm">{daysUnit}</span>
					</div>
				</div>
			</div>

			{shares ? (
				// The figures above carry the meaning; the bar only shows their proportions.
				<div
					aria-hidden="true"
					className="mt-5 flex h-2 w-full overflow-hidden rounded-full bg-muted"
				>
					<div className="h-full bg-primary" style={{ width: `${shares.used}%` }} />
					<div className="h-full bg-amber-500/70" style={{ width: `${shares.pending}%` }} />
				</div>
			) : null}

			{hasCarryover ? (
				<div className="mt-5 flex items-start gap-3 border-t pt-4">
					{carryoverExpiringSoon ? (
						<IconAlertTriangle
							className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
							aria-hidden="true"
						/>
					) : null}
					<div className="min-w-0 text-sm">
						<div className="font-medium">
							{t("absences.balance.carryoverFrom", "Carryover from {year}", {
								year: balance.year - 1,
							})}
						</div>
						{balance.earningYears?.length ? (
							<EarningYearLeaveList
								rows={balance.earningYears}
								locale={locale}
								timezone={timezone}
								numberFormat={numberFormat}
							/>
						) : null}
						<div
							hidden={Boolean(balance.earningYears?.length)}
							className={cn(
								"mt-0.5",
								carryoverExpiringSoon
									? "text-amber-700 dark:text-amber-400"
									: "text-muted-foreground",
							)}
						>
							{carryoverExpiry
								? t(
										"absences.balance.carryoverDaysExpiring",
										"You have {count} days carried over. They expire on {date}.",
										{
											count: numberFormat.format(balance.carryoverDays ?? 0),
											date: carryoverExpiry,
										},
									)
								: t("absences.balance.carryoverDays", "You have {count} days carried over", {
										count: balance.carryoverDays,
									})}
						</div>
					</div>
				</div>
			) : null}
		</section>
	);
}
