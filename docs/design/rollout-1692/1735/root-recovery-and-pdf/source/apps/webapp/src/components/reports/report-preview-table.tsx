"use client";

import { IconHome } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { ReportData } from "@/lib/reports/types";

interface ReportPreviewTableProps {
	reportData: ReportData;
}

export function ReportPreviewTable({ reportData }: ReportPreviewTableProps) {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	return (
		<div className="min-w-0 space-y-5">
			{/* Work Hours by Month */}
			{reportData.workHours.byMonth.size > 0 && (
				<Card>
					<CardHeader>
						<h3 className="font-semibold">
							{t("reports.preview.workHoursByMonth", "Work Hours by Month")}
						</h3>
					</CardHeader>
					<CardContent>
						<Table className="tabular-nums">
							<TableHeader>
								<TableRow>
									<TableHead>{t("reports.preview.month", "Month")}</TableHead>
									<TableHead className="text-right">
										{t("reports.preview.hours", "Hours")}
									</TableHead>
									<TableHead className="text-right">
										{t("reports.preview.days", "Days")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{Array.from(reportData.workHours.byMonth).map(
									([month, data]) => (
										<TableRow key={month}>
											<TableCell className="font-medium">{month}</TableCell>
											<TableCell className="text-right">
												{data.hours}h
											</TableCell>
											<TableCell className="text-right">{data.days}</TableCell>
										</TableRow>
									),
								)}
								<TableRow className="bg-muted/50 font-bold">
									<TableCell>{t("reports.preview.total", "Total")}</TableCell>
									<TableCell className="text-right">
										{reportData.workHours.totalHours}h
									</TableCell>
									<TableCell className="text-right">
										{reportData.workHours.workDays}
									</TableCell>
								</TableRow>
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			{/* Absences by Category */}
			{reportData.absences.byCategory.size > 0 && (
				<Card>
					<CardHeader>
						<h3 className="font-semibold">
							{t("reports.preview.absencesByCategory", "Absences by Category")}
						</h3>
					</CardHeader>
					<CardContent>
						<Table className="tabular-nums">
							<TableHeader>
								<TableRow>
									<TableHead>
										{t("reports.preview.category", "Category")}
									</TableHead>
									<TableHead className="text-right">
										{t("reports.preview.days", "Days")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{Array.from(reportData.absences.byCategory).map(
									([category, data]) => (
										<TableRow key={category}>
											<TableCell className="font-medium">{category}</TableCell>
											<TableCell className="text-right">{data.days}</TableCell>
										</TableRow>
									),
								)}
								<TableRow className="bg-muted/50 font-bold">
									<TableCell>{t("reports.preview.total", "Total")}</TableCell>
									<TableCell className="text-right">
										{reportData.absences.totalDays}
									</TableCell>
								</TableRow>
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			{/* HOME OFFICE SUMMARY - TAX RELEVANT */}
			<Card className="border-border">
				<CardHeader className="bg-muted/50">
					<h3 className="flex items-center gap-2 text-foreground">
						<IconHome className="size-5" />
						{t(
							"reports.preview.homeOfficeSummary",
							"Home Office Summary (Tax Relevant)",
						)}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t(
							"reports.preview.homeOfficeDescription",
							"Important for German tax purposes - shows home office days and hours worked",
						)}
					</p>
				</CardHeader>
				<CardContent className="pt-6">
					<div className="mb-6 grid gap-4 md:grid-cols-2">
						<div className="space-y-1">
							<p className="text-sm text-muted-foreground">
								{t(
									"reports.preview.totalHomeOfficeDays",
									"Total Home Office Days",
								)}
							</p>
							<p className="text-2xl font-bold">
								{reportData.absences.homeOffice.days}
							</p>
						</div>
						<div className="space-y-1">
							<p className="text-sm text-muted-foreground">
								{t(
									"reports.preview.totalHomeOfficeHours",
									"Total Hours Worked from Home",
								)}
							</p>
							<p className="text-2xl font-bold">
								{reportData.absences.homeOffice.hoursWorked}h
							</p>
						</div>
					</div>

					{reportData.absences.homeOffice.dateDetails.length > 0 && (
						<div>
							<h4 className="mb-3 font-semibold">
								{t("reports.preview.dateBreakdown", "Date-by-Date Breakdown")}
							</h4>
							<Table className="tabular-nums">
								<TableHeader>
									<TableRow>
										<TableHead>{t("reports.preview.date", "Date")}</TableHead>
										<TableHead className="text-right">
											{t("reports.preview.hoursWorked", "Hours Worked")}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{reportData.absences.homeOffice.dateDetails.map((detail) => (
										<TableRow key={detail.date}>
											<TableCell className="font-medium">
												{formatPlainDate(
													parsePlainDate(detail.date),
													locale,
													"dateMedium",
												)}
											</TableCell>
											<TableCell className="text-right">
												{detail.hours}h
											</TableCell>
										</TableRow>
									))}
									<TableRow className="bg-muted/50 font-bold">
										<TableCell>{t("reports.preview.total", "Total")}</TableCell>
										<TableCell className="text-right">
											{reportData.absences.homeOffice.hoursWorked}h
										</TableCell>
									</TableRow>
								</TableBody>
							</Table>
						</div>
					)}

					{reportData.absences.homeOffice.dateDetails.length === 0 && (
						<p className="text-sm text-muted-foreground">
							{t(
								"reports.preview.noHomeOfficeDays",
								"No home office days recorded in this period.",
							)}
						</p>
					)}
				</CardContent>
			</Card>

			{/* Compliance Metrics */}
			<Card>
				<CardHeader>
					<h3 className="font-semibold">
						{t("reports.preview.complianceMetrics", "Compliance Metrics")}
					</h3>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="text-sm font-medium">
								{t(
									"reports.preview.attendancePercentage",
									"Attendance Percentage",
								)}
							</span>
							<span className="text-lg font-bold">
								{reportData.complianceMetrics.attendancePercentage}%
							</span>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="text-sm font-medium">
								{t("reports.preview.overtime", "Overtime")}
							</span>
							<span className="text-lg font-bold">
								{Math.round(
									(reportData.complianceMetrics.overtimeMinutes / 60) * 100,
								) / 100}
								h
							</span>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="text-sm font-medium">
								{t("reports.preview.undertime", "Undertime")}
							</span>
							<span className="text-lg font-bold">
								{Math.round(
									(reportData.complianceMetrics.underTimeMinutes / 60) * 100,
								) / 100}
								h
							</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
