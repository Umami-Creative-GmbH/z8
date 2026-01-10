"use client";

import { Home } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { format } from "@/lib/datetime/luxon-utils";
import type { ReportData } from "@/lib/reports/types";

interface ReportPreviewTableProps {
	reportData: ReportData;
}

export function ReportPreviewTable({ reportData }: ReportPreviewTableProps) {
	return (
		<div className="space-y-6">
			{/* Work Hours by Month */}
			{reportData.workHours.byMonth.size > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Work Hours by Month</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Month</TableHead>
									<TableHead className="text-right">Hours</TableHead>
									<TableHead className="text-right">Days</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{Array.from(reportData.workHours.byMonth).map(([month, data]) => (
									<TableRow key={month}>
										<TableCell className="font-medium">{month}</TableCell>
										<TableCell className="text-right">{data.hours}h</TableCell>
										<TableCell className="text-right">{data.days}</TableCell>
									</TableRow>
								))}
								<TableRow className="bg-muted/50 font-bold">
									<TableCell>Total</TableCell>
									<TableCell className="text-right">{reportData.workHours.totalHours}h</TableCell>
									<TableCell className="text-right">{reportData.workHours.workDays}</TableCell>
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
						<CardTitle>Absences by Category</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Category</TableHead>
									<TableHead className="text-right">Days</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{Array.from(reportData.absences.byCategory).map(([category, data]) => (
									<TableRow key={category}>
										<TableCell className="font-medium">{category}</TableCell>
										<TableCell className="text-right">{data.days}</TableCell>
									</TableRow>
								))}
								<TableRow className="bg-muted/50 font-bold">
									<TableCell>Total</TableCell>
									<TableCell className="text-right">{reportData.absences.totalDays}</TableCell>
								</TableRow>
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			{/* HOME OFFICE SUMMARY - TAX RELEVANT */}
			<Card className="border-2 border-amber-500">
				<CardHeader className="bg-amber-50">
					<CardTitle className="flex items-center gap-2 text-amber-900">
						<Home className="h-5 w-5" />
						Home Office Summary (Tax Relevant)
					</CardTitle>
					<p className="text-sm text-amber-700">
						Important for German tax purposes - shows home office days and hours worked
					</p>
				</CardHeader>
				<CardContent className="pt-6">
					<div className="mb-6 grid gap-4 md:grid-cols-2">
						<div className="space-y-1">
							<p className="text-sm text-muted-foreground">Total Home Office Days</p>
							<p className="text-2xl font-bold">{reportData.absences.homeOffice.days}</p>
						</div>
						<div className="space-y-1">
							<p className="text-sm text-muted-foreground">Total Hours Worked from Home</p>
							<p className="text-2xl font-bold">{reportData.absences.homeOffice.hoursWorked}h</p>
						</div>
					</div>

					{reportData.absences.homeOffice.dateDetails.length > 0 && (
						<div>
							<h4 className="mb-3 font-semibold">Date-by-Date Breakdown</h4>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead className="text-right">Hours Worked</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{reportData.absences.homeOffice.dateDetails.map((detail) => (
										<TableRow key={detail.date.toISOString()}>
											<TableCell className="font-medium">
												{format(detail.date, "MMMM d, yyyy")}
											</TableCell>
											<TableCell className="text-right">{detail.hours}h</TableCell>
										</TableRow>
									))}
									<TableRow className="bg-amber-50 font-bold">
										<TableCell>Total</TableCell>
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
							No home office days recorded in this period.
						</p>
					)}
				</CardContent>
			</Card>

			{/* Compliance Metrics */}
			<Card>
				<CardHeader>
					<CardTitle>Compliance Metrics</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">Attendance Percentage</span>
							<span className="text-lg font-bold">
								{reportData.complianceMetrics.attendancePercentage}%
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">Overtime</span>
							<span className="text-lg font-bold">
								{Math.round((reportData.complianceMetrics.overtimeMinutes / 60) * 100) / 100}h
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">Undertime</span>
							<span className="text-lg font-bold">
								{Math.round((reportData.complianceMetrics.underTimeMinutes / 60) * 100) / 100}h
							</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
