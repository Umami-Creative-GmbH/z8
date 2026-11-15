"use client";

import {
	IconAlertTriangle,
	IconBeach,
	IconCalendarCheck,
	IconClock,
} from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useMemo } from "react";
import { PreviouslyTakenVacationExplanation } from "@/components/absences/previously-taken-vacation-explanation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@/components/ui/card";
import type { VacationBalance } from "@/lib/absences/types";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { VacationAllowanceExplanation } from "./vacation-allowance-explanation";

interface VacationBalanceCardProps {
	balance: VacationBalance;
	now: string;
	timezone: string;
}

export function VacationBalanceCard({
	balance,
	now,
	timezone,
}: VacationBalanceCardProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
	const hasCarryover = balance.carryoverDays && balance.carryoverDays > 0;
	const nowInstant = parseInstant(now);
	const carryoverExpiryInstant = balance.carryoverExpiryDate
		? instantFromDate(balance.carryoverExpiryDate)
		: null;
	const carryoverExpiringSoon =
		hasCarryover &&
		carryoverExpiryInstant &&
		carryoverExpiryInstant.epochNanoseconds <
			nowInstant.add({ hours: 30 * 24 }).epochNanoseconds;

	return (
		<Card>
			<CardHeader>
				<h2 className="font-semibold">
					{t("absences.balance.title", "Vacation Balance {year}", {
						year: balance.year,
					})}
				</h2>
				<CardDescription>
					{t(
						"absences.balance.description",
						"Your vacation days for the current year",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
					{/* Remaining Days - Most Important */}
					<div className="min-w-0 col-span-2 lg:border-r lg:pr-6">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<IconBeach className="size-4" aria-hidden="true" />
							{t("absences.balance.daysRemaining", "Days Remaining")}
						</div>
						<div className="mt-2">
							<div className="flex flex-wrap items-baseline gap-2">
								<span className="text-3xl font-semibold tabular-nums">
									{numberFormat.format(balance.remainingDays)}
								</span>
								<span className="text-sm text-muted-foreground">
									{t("common.days.label", "days")}
								</span>
							</div>
							<div className="mt-1 text-sm text-muted-foreground">
								{t(
									"absences.balance.outOfTotalDays",
									"out of {totalDays} total days",
									{
										totalDays: balance.totalDays,
									},
								)}
							</div>
							<VacationAllowanceExplanation
								allowance={balance.allowance}
								year={balance.year}
								className="mt-2"
							/>
						</div>
					</div>

					{/* Used Days */}
					<div className="min-w-0">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<IconCalendarCheck className="size-4" aria-hidden="true" />
							{t("absences.balance.used", "Used")}
						</div>
						<div className="mt-2">
							<div className="text-2xl font-semibold tabular-nums">
								{numberFormat.format(balance.usedDays)}
							</div>
							<PreviouslyTakenVacationExplanation
								days={balance.previouslyTakenDays}
							/>
							<div className="text-sm text-muted-foreground">
								{t("common.days.label", "days")}
							</div>
						</div>
					</div>

					{/* Pending Days */}
					<div className="min-w-0">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<IconClock className="size-4" aria-hidden="true" />
							{t("absences.balance.pending", "Pending")}
						</div>
						<div className="mt-2">
							<div className="text-2xl font-semibold tabular-nums">
								{numberFormat.format(balance.pendingDays)}
							</div>
							<div className="text-sm text-muted-foreground">
								{t("common.days.label", "days")}
							</div>
						</div>
					</div>

					{/* Carryover Warning (if applicable) */}
					{hasCarryover ? (
						<div className="sm:col-span-2 lg:col-span-4 border-t pt-4">
							<div className="flex items-start gap-3">
								<IconAlertTriangle
									className={`size-5 mt-0.5 ${carryoverExpiringSoon ? "text-destructive" : "text-muted-foreground"}`}
									aria-hidden="true"
								/>
								<div className="flex-1">
									<div className="text-sm font-medium">
										{t(
											"absences.balance.carryoverFrom",
											"Carryover from {year}",
											{
												year: balance.year - 1,
											},
										)}
									</div>
									<div className="mt-1 text-sm text-muted-foreground">
										{t(
											"absences.balance.carryoverDays",
											"You have {count} days carried over",
											{
												count: balance.carryoverDays,
											},
										)}
										{carryoverExpiryInstant && (
											<>
												{" "}
												{t(
													"absences.balance.carryoverExpiry",
													"that will expire on",
												)}{" "}
												<span
													className={
														carryoverExpiringSoon ? "text-destructive" : ""
													}
												>
													{formatPlainDate(
														carryoverExpiryInstant
															.toZonedDateTimeISO(timezone)
															.toPlainDate(),
														locale,
														"dateMedium",
													)}
												</span>
											</>
										)}
									</div>
								</div>
							</div>
						</div>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
