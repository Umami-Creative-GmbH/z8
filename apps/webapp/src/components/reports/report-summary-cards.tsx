"use client";

import { IconCalendar, IconClock, IconHome, IconUmbrella, IconWallet } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

	const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
	currencyFormatters.set(currency, formatter);
	return formatter;
}

function formatCurrency(amount: number, currency: string): string {
	return getCurrencyFormatter(currency).format(amount);
}

export function ReportSummaryCards({ reportData }: ReportSummaryCardsProps) {
	const { t } = useTranslate();
	const isHourly = reportData.employee.contractType === "hourly";

	return (
		<div className={`grid gap-4 md:grid-cols-2 ${isHourly ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
			{/* Total Work Hours */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.summary.totalWorkHours", "Total Work Hours")}
					</CardTitle>
					<IconClock className="size-4 text-muted-foreground" aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.workHours.totalHours}h</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.summary.workDays", "{count} work days", {
							count: reportData.workHours.workDays,
						})}
					</p>
					<p className="text-xs text-muted-foreground">
						{t("reports.summary.averagePerDay", "Avg: {hours}h/day", {
							hours: reportData.workHours.averagePerDay,
						})}
					</p>
				</CardContent>
			</Card>

			{/* IconHome Office Days */}
			<Card className="border-amber-500">
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.summary.homeOfficeDays", "Home Office Days")}
					</CardTitle>
					<IconHome className="size-4 text-amber-500" aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.absences.homeOffice.days}</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.summary.workedFromHome", "{hours}h worked from home", {
							hours: reportData.absences.homeOffice.hoursWorked,
						})}
					</p>
					<p className="text-xs font-semibold text-amber-600">
						{t("reports.summary.taxRelevant", "Tax relevant")}
					</p>
				</CardContent>
			</Card>

			{/* Vacation Days */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.summary.vacationDays", "Vacation Days")}
					</CardTitle>
					<IconUmbrella className="size-4 text-muted-foreground" aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.absences.vacation.approved}</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.summary.pending", "{count} pending", {
							count: reportData.absences.vacation.pending,
						})}
					</p>
				</CardContent>
			</Card>

			{/* Total Absences */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.summary.totalAbsences", "Total Absences")}
					</CardTitle>
					<IconCalendar className="size-4 text-muted-foreground" aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.absences.totalDays}</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.summary.sickDays", "Sick: {count} days", {
							count: reportData.absences.sick.approved,
						})}
					</p>
					<p className="text-xs text-muted-foreground">
						{t("reports.summary.otherDays", "Other: {count} days", {
							count: reportData.absences.other.approved,
						})}
					</p>
				</CardContent>
			</Card>

			{/* Earnings - Only for hourly employees */}
			{isHourly && reportData.hourlyEarnings && (
				<Card className="border-green-500">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("reports.summary.totalEarnings", "Total Earnings")}
						</CardTitle>
						<IconWallet className="size-4 text-green-500" aria-hidden="true" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatCurrency(
								reportData.hourlyEarnings.totalEarnings,
								reportData.hourlyEarnings.currency,
							)}
						</div>
						<p className="text-xs text-muted-foreground">
							{t("reports.summary.hourlyAverage", "{hours}h @ avg {rate}/h", {
								hours: reportData.hourlyEarnings.totalHours,
								rate: formatCurrency(
									reportData.hourlyEarnings.totalEarnings / reportData.hourlyEarnings.totalHours ||
										0,
									reportData.hourlyEarnings.currency,
								),
							})}
						</p>
						{reportData.hourlyEarnings.byRatePeriod.length > 1 && (
							<p className="text-xs text-green-600">
								{t("reports.summary.ratePeriods", "{count} rate periods", {
									count: reportData.hourlyEarnings.byRatePeriod.length,
								})}
							</p>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
