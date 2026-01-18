"use client";

import { Calendar, Clock, Home, Umbrella, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "@/lib/reports/types";

interface ReportSummaryCardsProps {
	reportData: ReportData;
}

function formatCurrency(amount: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency,
	}).format(amount);
}

export function ReportSummaryCards({ reportData }: ReportSummaryCardsProps) {
	const isHourly = reportData.employee.contractType === "hourly";

	return (
		<div className={`grid gap-4 md:grid-cols-2 ${isHourly ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
			{/* Total Work Hours */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Total Work Hours</CardTitle>
					<Clock className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.workHours.totalHours}h</div>
					<p className="text-xs text-muted-foreground">{reportData.workHours.workDays} work days</p>
					<p className="text-xs text-muted-foreground">
						Avg: {reportData.workHours.averagePerDay}h/day
					</p>
				</CardContent>
			</Card>

			{/* Home Office Days */}
			<Card className="border-amber-500">
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Home Office Days</CardTitle>
					<Home className="h-4 w-4 text-amber-500" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.absences.homeOffice.days}</div>
					<p className="text-xs text-muted-foreground">
						{reportData.absences.homeOffice.hoursWorked}h worked from home
					</p>
					<p className="text-xs font-semibold text-amber-600">Tax relevant</p>
				</CardContent>
			</Card>

			{/* Vacation Days */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Vacation Days</CardTitle>
					<Umbrella className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.absences.vacation.approved}</div>
					<p className="text-xs text-muted-foreground">
						{reportData.absences.vacation.pending} pending
					</p>
				</CardContent>
			</Card>

			{/* Total Absences */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Total Absences</CardTitle>
					<Calendar className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{reportData.absences.totalDays}</div>
					<p className="text-xs text-muted-foreground">
						Sick: {reportData.absences.sick.approved} days
					</p>
					<p className="text-xs text-muted-foreground">
						Other: {reportData.absences.other.approved} days
					</p>
				</CardContent>
			</Card>

			{/* Earnings - Only for hourly employees */}
			{isHourly && reportData.hourlyEarnings && (
				<Card className="border-green-500">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
						<Wallet className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatCurrency(
								reportData.hourlyEarnings.totalEarnings,
								reportData.hourlyEarnings.currency,
							)}
						</div>
						<p className="text-xs text-muted-foreground">
							{reportData.hourlyEarnings.totalHours}h @ avg{" "}
							{formatCurrency(
								reportData.hourlyEarnings.totalEarnings / reportData.hourlyEarnings.totalHours || 0,
								reportData.hourlyEarnings.currency,
							)}
							/h
						</p>
						{reportData.hourlyEarnings.byRatePeriod.length > 1 && (
							<p className="text-xs text-green-600">
								{reportData.hourlyEarnings.byRatePeriod.length} rate periods
							</p>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
