"use client";

import { IconAlertTriangle, IconBeach, IconCalendarCheck, IconClock } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VacationBalance } from "@/lib/absences/types";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";

interface VacationBalanceCardProps {
	balance: VacationBalance;
	now: string;
	timezone: string;
}

export function VacationBalanceCard({ balance, now, timezone }: VacationBalanceCardProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const hasCarryover = balance.carryoverDays && balance.carryoverDays > 0;
	const nowInstant = parseInstant(now);
	const carryoverExpiryInstant = balance.carryoverExpiryDate
		? instantFromDate(balance.carryoverExpiryDate)
		: null;
	const carryoverExpiringSoon =
		hasCarryover &&
		carryoverExpiryInstant &&
		carryoverExpiryInstant.epochNanoseconds < nowInstant.add({ hours: 30 * 24 }).epochNanoseconds;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("absences.balance.title", "Vacation Balance {year}", {
						year: balance.year,
					})}
				</CardTitle>
				<CardDescription>
					{t("absences.balance.description", "Your vacation days for the current year")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="@container/card grid grid-cols-1 gap-4 sm:grid-cols-2 @xl/card:grid-cols-4">
					{/* Remaining Days - Most Important */}
					<div className="sm:col-span-2 @xl/card:col-span-2 rounded-lg border bg-card p-6">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<IconBeach className="size-4" aria-hidden="true" />
							{t("absences.balance.daysRemaining", "Days Remaining")}
						</div>
						<div className="mt-2">
							<div className="text-4xl font-bold tabular-nums">{balance.remainingDays}</div>
							<div className="mt-1 text-sm text-muted-foreground">
								{t("absences.balance.outOfTotalDays", "out of {totalDays} total days", {
									totalDays: balance.totalDays,
								})}
							</div>
						</div>
					</div>

					{/* Used Days */}
					<div className="rounded-lg border bg-card p-4">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<IconCalendarCheck className="size-4" aria-hidden="true" />
							{t("absences.balance.used", "Used")}
						</div>
						<div className="mt-2">
							<div className="text-2xl font-bold tabular-nums">{balance.usedDays}</div>
							<div className="text-xs text-muted-foreground">{t("common.days.label", "days")}</div>
						</div>
					</div>

					{/* Pending Days */}
					<div className="rounded-lg border bg-card p-4">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<IconClock className="size-4" aria-hidden="true" />
							{t("absences.balance.pending", "Pending")}
						</div>
						<div className="mt-2">
							<div className="text-2xl font-bold tabular-nums">{balance.pendingDays}</div>
							<div className="text-xs text-muted-foreground">{t("common.days.label", "days")}</div>
						</div>
					</div>

					{/* Carryover Warning (if applicable) */}
					{hasCarryover && (
						<div className="sm:col-span-2 @xl/card:col-span-4 rounded-lg border bg-muted/50 p-4">
							<div className="flex items-start gap-3">
								<IconAlertTriangle
									className={`size-5 mt-0.5 ${carryoverExpiringSoon ? "text-destructive" : "text-muted-foreground"}`}
									aria-hidden="true"
								/>
								<div className="flex-1">
									<div className="text-sm font-medium">
										{t("absences.balance.carryoverFrom", "Carryover from {year}", {
											year: balance.year - 1,
										})}
									</div>
									<div className="mt-1 text-sm text-muted-foreground">
										{t("absences.balance.carryoverDays", "You have {count} days carried over", {
											count: balance.carryoverDays,
										})}
										{carryoverExpiryInstant && (
											<>
												{" "}
												{t("absences.balance.carryoverExpiry", "that will expire on")}{" "}
												<span className={carryoverExpiringSoon ? "text-destructive" : ""}>
													{formatPlainDate(
														carryoverExpiryInstant.toZonedDateTimeISO(timezone).toPlainDate(),
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
					)}
				</div>
			</CardContent>
		</Card>
	);
}
