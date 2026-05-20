"use client";

import { IconAlertCircle, IconChartBar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
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
	const { t } = useTranslate();
	const [reportData, setReportData] = useState<ReportData | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleGenerateReport = async (employeeId: string, dateRange: DateRange) => {
		setIsGenerating(true);
		setError(null);

		const result = await generateReport(employeeId, dateRange.start, dateRange.end).catch(
			(error) => ({
				success: false,
				error:
					error instanceof Error
						? error.message
						: t("reports.toast.unexpectedError", "An unexpected error occurred"),
				data: null,
			}),
		);

		if (result.success && result.data) {
			setReportData(result.data);
			toast.success(t("reports.toast.reportGenerated", "Report generated successfully"), {
				description: t("reports.toast.generatedFor", "Generated report for {name}", {
					name: result.data.employee.name,
				}),
			});
			setIsGenerating(false);
			return;
		}

		setError(result.error || t("reports.toast.failedGenerate", "Failed to generate report"));
		toast.error(t("reports.toast.failedGenerate", "Failed to generate report"), {
			description: result.error || t("reports.toast.unknownError", "An unknown error occurred"),
		});
		setIsGenerating(false);
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
					<IconAlertCircle className="size-4" />
					<AlertTitle>{t("reports.container.error", "Error")}</AlertTitle>
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
									<h3 className="text-lg font-semibold">
										{t("reports.export.title", "Export Report")}
									</h3>
									<p className="text-sm text-muted-foreground">
										{t(
											"reports.export.description",
											"Download this report in your preferred format",
										)}
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
							<IconChartBar className="size-12 animate-pulse text-muted-foreground" />
							<div className="text-center">
								<p className="font-semibold">
									{t("reports.container.generating", "Generating Report...")}
								</p>
								<p className="text-sm text-muted-foreground">
									{t("reports.container.pleaseWait", "Please wait while we compile your data")}
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
							<IconChartBar className="size-12 text-muted-foreground" />
							<div>
								<p className="font-semibold">
									{t("reports.container.noReportYet", "No report generated yet")}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"reports.container.selectPeriod",
										'Select a period and click "Generate Report" to get started',
									)}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
