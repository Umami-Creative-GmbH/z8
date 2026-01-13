"use client";

import { IconBriefcase } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { AlertCircle, FileBarChart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getProjectDetailedReport,
	getProjectsOverview,
} from "@/app/[locale]/(app)/reports/projects/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type {
	DateRange,
	ProjectDetailedReport,
	ProjectPortfolioData,
} from "@/lib/reports/project-types";
import { ProjectBudgetProgress } from "./project-budget-progress";
import { ProjectFilters } from "./project-filters";
import { ProjectHoursChart } from "./project-hours-chart";
import { ProjectPortfolioTable } from "./project-portfolio-table";
import { ProjectSummaryCards } from "./project-summary-cards";
import { ProjectTeamBreakdown } from "./project-team-breakdown";

export function ProjectReportsContainer() {
	const { t } = useTranslate();
	const [portfolioData, setPortfolioData] = useState<ProjectPortfolioData | null>(null);
	const [detailedReport, setDetailedReport] = useState<ProjectDetailedReport | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dateRange, setDateRange] = useState<DateRange>(getDateRangeForPreset("current_month"));
	const [_selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"portfolio" | "project">("portfolio");

	const handleGeneratePortfolio = async (range: DateRange, statusFilter?: string[]) => {
		setIsLoading(true);
		setError(null);
		setDateRange(range);

		try {
			const result = await getProjectsOverview(range.start, range.end, statusFilter);

			if (!result.success) {
				setError(
					result.error ||
						t("reports.projects.toast.failedPortfolio", "Failed to generate portfolio report"),
				);
				toast.error(t("reports.projects.toast.failedGenerate", "Failed to generate report"), {
					description: result.error,
				});
				return;
			}
			setPortfolioData(result.data);
			setDetailedReport(null);
			setSelectedProjectId(null);
			setActiveTab("portfolio");
			toast.success(t("reports.projects.toast.portfolioGenerated", "Portfolio report generated"));
		} catch (err) {
			const errorMessage =
				err instanceof Error
					? err.message
					: t("reports.projects.toast.unexpectedError", "An unexpected error occurred");
			setError(errorMessage);
			toast.error(t("reports.projects.toast.failedGenerate", "Failed to generate report"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleSelectProject = async (projectId: string) => {
		setIsLoading(true);
		setError(null);
		setSelectedProjectId(projectId);

		try {
			const result = await getProjectDetailedReport(projectId, dateRange.start, dateRange.end);

			if (!result.success) {
				setError(
					result.error ||
						t("reports.projects.toast.failedProject", "Failed to generate project report"),
				);
				toast.error(
					t("reports.projects.toast.failedProjectReport", "Failed to generate project report"),
					{
						description: result.error,
					},
				);
				return;
			}
			setDetailedReport(result.data);
			setActiveTab("project");
			toast.success(
				t("reports.projects.toast.projectGenerated", "Report generated for {name}", {
					name: result.data.project.name,
				}),
			);
		} catch (err) {
			const errorMessage =
				err instanceof Error
					? err.message
					: t("reports.projects.toast.unexpectedError", "An unexpected error occurred");
			setError(errorMessage);
			toast.error(
				t("reports.projects.toast.failedProjectReport", "Failed to generate project report"),
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="space-y-6 px-4 lg:px-6">
			{/* Filters */}
			<ProjectFilters onGenerate={handleGeneratePortfolio} isGenerating={isLoading} />

			{/* Error Alert */}
			{error && (
				<Alert variant="destructive">
					<AlertCircle className="h-4 w-4" />
					<AlertTitle>{t("reports.projects.container.error", "Error")}</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{/* Loading State */}
			{isLoading && (
				<Card>
					<CardContent className="flex items-center justify-center py-12">
						<div className="flex flex-col items-center gap-4">
							<IconBriefcase className="h-12 w-12 animate-pulse text-muted-foreground" />
							<div className="text-center">
								<p className="font-semibold">
									{t("reports.projects.container.generating", "Generating Report...")}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"reports.projects.container.pleaseWait",
										"Please wait while we compile project data",
									)}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Results */}
			{!isLoading && portfolioData && (
				<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "portfolio" | "project")}>
					<TabsList>
						<TabsTrigger value="portfolio">
							{t("reports.projects.container.portfolioOverview", "Portfolio Overview")}
						</TabsTrigger>
						<TabsTrigger value="project" disabled={!detailedReport}>
							{detailedReport
								? detailedReport.project.name
								: t("reports.projects.container.projectDetails", "Project Details")}
						</TabsTrigger>
					</TabsList>

					<TabsContent value="portfolio" className="space-y-6">
						{/* Summary Cards */}
						<ProjectSummaryCards data={portfolioData.totals} />

						{/* Portfolio Table */}
						<ProjectPortfolioTable
							projects={portfolioData.projects}
							onProjectSelect={handleSelectProject}
						/>
					</TabsContent>

					<TabsContent value="project" className="space-y-6">
						{detailedReport && (
							<>
								{/* Project Summary Cards */}
								<ProjectSummaryCards
									data={{
										totalProjects: 1,
										activeProjects: detailedReport.project.status === "active" ? 1 : 0,
										totalHours: detailedReport.summary.totalHours,
										projectsOverBudget:
											detailedReport.summary.percentBudgetUsed &&
											detailedReport.summary.percentBudgetUsed > 100
												? 1
												: 0,
										projectsOverdue: 0,
									}}
									isSingleProject
									project={detailedReport.project}
									summary={detailedReport.summary}
								/>

								{/* Budget Progress */}
								{detailedReport.summary.budgetHours && (
									<ProjectBudgetProgress
										budgetHours={detailedReport.summary.budgetHours}
										usedHours={detailedReport.summary.totalHours}
									/>
								)}

								{/* Hours Chart */}
								<ProjectHoursChart data={detailedReport.timeSeries} />

								{/* Team Breakdown */}
								<ProjectTeamBreakdown
									teamBreakdown={detailedReport.teamBreakdown}
									employeeBreakdown={detailedReport.employeeBreakdown}
								/>
							</>
						)}
					</TabsContent>
				</Tabs>
			)}

			{/* Empty State */}
			{!portfolioData && !isLoading && !error && (
				<Card>
					<CardContent className="flex items-center justify-center py-12">
						<div className="flex flex-col items-center gap-4 text-center">
							<FileBarChart className="h-12 w-12 text-muted-foreground" />
							<div>
								<p className="font-semibold">
									{t("reports.projects.container.noReportYet", "No report generated yet")}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"reports.projects.container.selectPeriod",
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
