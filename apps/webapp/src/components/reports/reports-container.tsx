"use client";

import { AlertCircle, FileBarChart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { generateReport } from "@/app/[locale]/(app)/reports/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { DateRange, ReportData } from "@/lib/reports/types";
import { ExportButtons } from "./export-buttons";
import { ReportFilters } from "./report-filters";
import { ReportPreviewTable } from "./report-preview-table";
import { ReportSummaryCards } from "./report-summary-cards";

interface ReportsContainerProps {
	currentEmployeeId: string;
}

export function ReportsContainer({ currentEmployeeId }: ReportsContainerProps) {
	const [reportData, setReportData] = useState<ReportData | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleGenerateReport = async (employeeId: string, dateRange: DateRange) => {
		setIsGenerating(true);
		setError(null);

		try {
			const result = await generateReport(employeeId, dateRange.start, dateRange.end);

			if (result.success) {
				setReportData(result.data);
				toast.success("Report generated successfully", {
					description: `Generated report for ${result.data.employee.name}`,
				});
			} else {
				setError(result.error || "Failed to generate report");
				toast.error("Failed to generate report", {
					description: result.error || "An unknown error occurred",
				});
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred";
			setError(errorMessage);
			toast.error("Failed to generate report", {
				description: errorMessage,
			});
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<div className="space-y-6 px-4 lg:px-6">
			{/* Filters */}
			<ReportFilters
				currentEmployeeId={currentEmployeeId}
				onGenerate={handleGenerateReport}
				isGenerating={isGenerating}
			/>

			{/* Error Alert */}
			{error && (
				<Alert variant="destructive">
					<AlertCircle className="h-4 w-4" />
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{/* Report Results */}
			{reportData && !isGenerating && (
				<>
					{/* Summary Cards */}
					<ReportSummaryCards reportData={reportData} />

					{/* Export Actions */}
					<Card>
						<CardContent className="pt-6">
							<div className="flex flex-col gap-4">
								<div>
									<h3 className="text-lg font-semibold">Export Report</h3>
									<p className="text-sm text-muted-foreground">
										Download this report in your preferred format
									</p>
								</div>
								<ExportButtons reportData={reportData} />
							</div>
						</CardContent>
					</Card>

					{/* Detailed Tables */}
					<ReportPreviewTable reportData={reportData} />
				</>
			)}

			{/* Loading State */}
			{isGenerating && (
				<Card>
					<CardContent className="flex items-center justify-center py-12">
						<div className="flex flex-col items-center gap-4">
							<FileBarChart className="h-12 w-12 animate-pulse text-muted-foreground" />
							<div className="text-center">
								<p className="font-semibold">Generating Report...</p>
								<p className="text-sm text-muted-foreground">
									Please wait while we compile your data
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Empty State */}
			{!reportData && !isGenerating && !error && (
				<Card>
					<CardContent className="flex items-center justify-center py-12">
						<div className="flex flex-col items-center gap-4 text-center">
							<FileBarChart className="h-12 w-12 text-muted-foreground" />
							<div>
								<p className="font-semibold">No report generated yet</p>
								<p className="text-sm text-muted-foreground">
									Select a period and click "Generate Report" to get started
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
