"use client";

import {
	IconCalendar,
	IconClock,
	IconHome,
	IconUmbrella,
	IconWallet,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReportData } from "@/lib/reports/types";

interface ReportSummaryCardsProps {
	reportData: ReportData;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string) {
	const cachedFormatter = currencyFormatters.get(currency);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.NumberFormat(undefined, {
		style: "currency",
		currency,
	});
	currencyFormatters.set(currency, formatter);
	return formatter;
}

function formatCurrency(amount: number, currency: string): string {
	return getCurrencyFormatter(currency).format(amount);
}

export function ReportSummaryCards({ reportData }: ReportSummaryCardsProps) {
	const { t } = useTranslate();
	// Earnings come from the hourly terms in force during the period, whatever the contract is now.
	const hasEarnings = reportData.hourlyEarnings !== undefined;

	return (
		<div
			className={`grid divide-y rounded-xl border bg-card md:grid-cols-2 md:divide-y-0 ${hasEarnings ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}
		>
			{/* Total Work Hours */}
			<section className="min-w-0 space-y-3 p-4">
				<div className="flex items-start justify-between gap-2">
					<h3 className="text-sm font-medium">
						{t("reports.summary.totalWorkHours", "Total Work Hours")}
					</h3>
					<IconClock
						className="size-4 text-muted-foreground"
						aria-hidden="true"
					/>
				</div>
				<div className="space-y-1 tabular-nums">
					<div className="text-2xl font-bold">
						{reportData.workHours.totalHours}h
					</div>
					<p className="text-sm text-muted-foreground">
						{t("reports.summary.workDays", "{count} work days", {
							count: reportData.workHours.workDays,
						})}
					</p>
					<p className="text-sm text-muted-foreground">
						{t("reports.summary.averagePerDay", "Avg: {hours}h/day", {
							hours: reportData.workHours.averagePerDay,
						})}
					</p>
				</div>
			</section>

			{/* IconHome Office Days */}
			<section className="min-w-0 space-y-3 p-4">
				<div className="flex items-start justify-between gap-2">
					<h3 className="text-sm font-medium">
						{t("reports.summary.homeOfficeDays", "Home Office Days")}
					</h3>
					<IconHome
						className="size-4 text-muted-foreground"
						aria-hidden="true"
					/>
				</div>
				<div className="space-y-1 tabular-nums">
					<div className="text-2xl font-bold">
						{reportData.absences.homeOffice.days}
					</div>
					<p className="text-sm text-muted-foreground">
						{t("reports.summary.workedFromHome", "{hours}h worked from home", {
							hours: reportData.absences.homeOffice.hoursWorked,
						})}
					</p>
					<p className="text-sm font-semibold text-muted-foreground">
						{t("reports.summary.taxRelevant", "Tax relevant")}
					</p>
				</div>
			</section>

			{/* Vacation Days */}
			<section className="min-w-0 space-y-3 p-4">
				<div className="flex items-start justify-between gap-2">
					<h3 className="text-sm font-medium">
						{t("reports.summary.vacationDays", "Vacation Days")}
					</h3>
					<IconUmbrella
						className="size-4 text-muted-foreground"
						aria-hidden="true"
					/>
				</div>
				<div className="space-y-1 tabular-nums">
					<div className="text-2xl font-bold">
						{reportData.absences.vacation.approved}
					</div>
					<p className="text-sm text-muted-foreground">
						{t("reports.summary.pending", "{count} pending", {
							count: reportData.absences.vacation.pending,
						})}
					</p>
				</div>
			</section>

			{/* Total Absences */}
			<section className="min-w-0 space-y-3 p-4">
				<div className="flex items-start justify-between gap-2">
					<h3 className="text-sm font-medium">
						{t("reports.summary.totalAbsences", "Total Absences")}
					</h3>
					<IconCalendar
						className="size-4 text-muted-foreground"
						aria-hidden="true"
					/>
				</div>
				<div className="space-y-1 tabular-nums">
					<div className="text-2xl font-bold">
						{reportData.absences.totalDays}
					</div>
					<p className="text-sm text-muted-foreground">
						{t("reports.summary.sickDays", "Sick: {count} days", {
							count: reportData.absences.sick.approved,
						})}
					</p>
					<p className="text-sm text-muted-foreground">
						{t("reports.summary.otherDays", "Other: {count} days", {
							count: reportData.absences.other.approved,
						})}
					</p>
				</div>
			</section>

			{/* Earnings - only when hourly terms were in force during the period */}
			{reportData.hourlyEarnings && (
				<section className="min-w-0 space-y-3 p-4">
					<div className="flex items-start justify-between gap-2">
						<h3 className="text-sm font-medium">
							{t("reports.summary.totalEarnings", "Total Earnings")}
						</h3>
						<IconWallet
							className="size-4 text-muted-foreground"
							aria-hidden="true"
						/>
					</div>
					<div className="space-y-1 tabular-nums">
						<div className="text-2xl font-bold">
							{formatCurrency(
								reportData.hourlyEarnings.totalEarnings,
								reportData.hourlyEarnings.currency,
							)}
						</div>
						<p className="text-sm text-muted-foreground">
							{t("reports.summary.hourlyAverage", "{hours}h @ avg {rate}/h", {
								hours: reportData.hourlyEarnings.totalHours,
								rate: formatCurrency(
									reportData.hourlyEarnings.totalEarnings /
										reportData.hourlyEarnings.totalHours || 0,
									reportData.hourlyEarnings.currency,
								),
							})}
						</p>
						{reportData.hourlyEarnings.byRatePeriod.length > 1 && (
							<p className="text-sm text-muted-foreground">
								{t("reports.summary.ratePeriods", "{count} rate periods", {
									count: reportData.hourlyEarnings.byRatePeriod.length,
								})}
							</p>
						)}
					</div>
				</section>
			)}
		</div>
	);
}
