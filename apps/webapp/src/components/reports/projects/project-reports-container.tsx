"use client";

import { IconAlertCircle, IconBriefcase, IconChartBar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	getCustomerBillableReport,
	getProjectDetailedReport,
	getProjectsOverview,
} from "@/app/[locale]/(app)/reports/projects/actions";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { ReportDocumentExportButtons } from "@/components/reports/report-document-export-buttons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganization } from "@/hooks/use-organization";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import { buildProjectReportDocument } from "@/lib/reports/project-report-export";
import type {
	CustomerBillableReport,
	ProjectDetailedReport,
	ProjectPortfolioData,
} from "@/lib/reports/project-types";
import type { ReportDateRange } from "@/lib/reports/types";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { BillableEmployeeTable, BillableFiguresCard } from "./billable-figures";
import { CustomerBillableView } from "./customer-billable-view";
import { ProjectBudgetProgress } from "./project-budget-progress";
import { ProjectBudgetUtilizationSummary } from "./project-budget-utilization-summary";
import { ProjectFilters } from "./project-filters";
import { ProjectHealthAlerts } from "./project-health-alerts";
import { ProjectHoursChart } from "./project-hours-chart";
import { ProjectPortfolioTable } from "./project-portfolio-table";
import { ProjectReportDetails } from "./project-report-details";
import { ProjectSummaryCards } from "./project-summary-cards";
import { ProjectTaskBreakdown } from "./project-task-breakdown";
import { ProjectTeamBreakdown } from "./project-team-breakdown";
import { ReportScopeFailure } from "./report-scope-failure";
import { ReportShareDialog } from "./report-share-dialog";

export function ProjectReportsContainer() {
	const scope = useOrganization();
	const { t } = useTranslate();
	if (scope.isLoading)
		return (
			<p role="status" className="px-4 lg:px-6">
				{t("reports.projects.scopeLoading", "Loading the current report scope\u2026")}
			</p>
		);
	if (scope.error || !scope.userId || !scope.activeOrganizationId)
		return (
			<ReportScopeFailure
				className="mx-4 w-auto lg:mx-6"
				message={t(
					"reports.projects.scopeUnavailable",
					"The current report scope could not be loaded.",
				)}
				onRetry={scope.refetch}
			/>
		);
	return (
		<ProjectReportWorkspace key={JSON.stringify([scope.userId, scope.activeOrganizationId])} />
	);
}

function ProjectReportWorkspace() {
	const { t } = useTranslate();
	const [portfolioData, setPortfolioData] = useState<ProjectPortfolioData | null>(null);
	const [detailedReport, setDetailedReport] = useState<ProjectDetailedReport | null>(null);
	const [customerReport, setCustomerReport] = useState<CustomerBillableReport | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dateRangeRef = useRef<ReportDateRange | null>(null);
	const [generatedStatus, setGeneratedStatus] = useState<string[] | undefined>();
	const [generatedRange, setGeneratedRange] = useState<ReportDateRange | null>(null);
	const statusFilterRef = useRef<string[] | undefined>(undefined);
	const lifetime = useRef<object | null>(null);
	const pending = useRef<object | null>(null);
	const retry = useRef<null | (() => Promise<void>)>(null);
	const [activeTab, setActiveTab] = useState<"portfolio" | "customers" | "project">("portfolio");
	useLayoutEffect(() => {
		lifetime.current = {};
		pending.current = null;
		setIsLoading(false);
		return () => {
			lifetime.current = null;
			pending.current = null;
		};
	}, []);

	async function readReport(
		read: (current: () => boolean) => Promise<void>,
		again: () => Promise<void>,
	) {
		const arrival = lifetime.current;
		if (!arrival || pending.current) return;
		const operation = {};
		pending.current = operation;
		const current = () => lifetime.current === arrival && pending.current === operation;
		setIsLoading(true);
		setError(null);
		retry.current = again;
		await runWithCleanup(
			async () => {
				try {
					await read(current);
				} catch (err) {
					if (!current()) return;
					setError(
						err instanceof Error
							? err.message
							: t("reports.projects.toast.unexpectedError", "An unexpected error occurred"),
					);
					toast.error(t("reports.projects.toast.failedGenerate", "Failed to generate report"));
				}
			},
			() => {
				if (current()) {
					pending.current = null;
					setIsLoading(false);
				}
			},
		);
	}

	const handleGeneratePortfolio = async (range: ReportDateRange, statusFilter?: string[]) => {
		await readReport(
			async (current) => {
				const result = await getProjectsOverview(range.startDate, range.endDate, statusFilter);
				if (!current()) return;
				if (!result.success)
					throw new Error(
						result.error ||
							t("reports.projects.toast.failedPortfolio", "Failed to generate portfolio report"),
					);
				const customers = result.data.billableTime
					? await getCustomerBillableReport(range.startDate, range.endDate, statusFilter)
					: null;
				if (!current()) return;
				if (customers && !customers.success) throw new Error(customers.error);
				dateRangeRef.current = range;
				setGeneratedRange(range);
				setGeneratedStatus(statusFilter);
				statusFilterRef.current = statusFilter;
				setPortfolioData(result.data);
				setCustomerReport(customers?.success ? customers.data : null);
				setDetailedReport(null);
				setActiveTab("portfolio");
				toast.success(t("reports.projects.toast.portfolioGenerated", "Portfolio report generated"));
			},
			() => handleGeneratePortfolio(range, statusFilter),
		);
	};

	const handleSelectProject = async (projectId: string) => {
		const dateRange = dateRangeRef.current;
		if (!dateRange) return;
		await readReport(
			async (current) => {
				const result = await getProjectDetailedReport(
					projectId,
					dateRange.startDate,
					dateRange.endDate,
				);
				if (!current()) return;
				if (!result.success)
					throw new Error(
						result.error ||
							t("reports.projects.toast.failedProject", "Failed to generate project report"),
					);
				setDetailedReport(result.data);
				setActiveTab("project");
				toast.success(
					t("reports.projects.toast.projectGenerated", "Report generated for {name}", {
						name: result.data.project.name,
					}),
				);
			},
			() => handleSelectProject(projectId),
		);
	};

	const refreshReports = async () => {
		const range = dateRangeRef.current;
		if (!range || !portfolioData || pending.current || !lifetime.current) return;
		const arrival = lifetime.current;
		const operation = {};
		pending.current = operation;
		const current = () => lifetime.current === arrival && pending.current === operation;
		setIsLoading(true);
		retry.current = refreshReports;
		await runWithCleanup(
			async () => {
				const results = await Promise.all([
					getProjectsOverview(range.startDate, range.endDate, statusFilterRef.current),
					portfolioData.billableTime
						? getCustomerBillableReport(range.startDate, range.endDate, statusFilterRef.current)
						: null,
					detailedReport
						? getProjectDetailedReport(detailedReport.project.id, range.startDate, range.endDate)
						: null,
				]).catch((err) => {
					if (!current()) return null;
					setError(t("reports.projects.refreshFailed", "Could not refresh project reports"));
					return Promise.reject(err);
				});
				if (!current() || !results) return;
				const [portfolio, customers, details] = results;
				if (
					!portfolio.success ||
					(customers && !customers.success) ||
					(details && !details.success)
				) {
					const message = t("reports.projects.refreshFailed", "Could not refresh project reports");
					setError(message);
					return Promise.reject(new Error(message));
				}
				setPortfolioData(portfolio.data);
				setCustomerReport(customers?.success ? customers.data : null);
				if (details?.success) setDetailedReport(details.data);
				setError(null);
			},
			() => {
				if (current()) {
					pending.current = null;
					setIsLoading(false);
				}
			},
		);
	};

	useViewRefresh(refreshReports);

	return (
		<div className="min-w-0 space-y-6 px-4 lg:px-6">
			{/* Filters */}
			<ProjectFilters onGenerate={handleGeneratePortfolio} isGenerating={isLoading} />

			{/* Error Alert */}
			{error && (
				<Alert variant="destructive">
					<IconAlertCircle aria-hidden="true" className="size-4" />
					<AlertTitle>{t("reports.projects.container.error", "Error")}</AlertTitle>
					<AlertDescription className="space-y-3">
						<p>{error}</p>
						<Button
							variant="outline"
							disabled={isLoading}
							onClick={() => void retry.current?.().catch(() => {})}
						>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{/* Loading State */}
			{isLoading && (
				<Card>
					<CardContent role="status" className="flex items-center justify-center py-6">
						<div className="flex flex-col items-center gap-4">
							<IconBriefcase
								aria-hidden="true"
								className="size-5 animate-pulse text-muted-foreground motion-reduce:animate-none"
							/>
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

			{portfolioData && (
				<ProjectReportResults
					portfolioData={portfolioData}
					customerReport={customerReport}
					detailedReport={detailedReport}
					isLoading={isLoading}
					generatedRange={generatedRange}
					generatedStatus={generatedStatus}
					activeTab={activeTab}
					onTabChange={setActiveTab}
					onProjectSelect={handleSelectProject}
				/>
			)}

			{/* Empty State */}
			{!portfolioData && !isLoading && !error && (
				<Card>
					<CardContent className="flex items-center justify-center py-12">
						<div className="flex flex-col items-center gap-4 text-center">
							<IconChartBar aria-hidden="true" className="size-12 text-muted-foreground" />
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

function ProjectReportResults({
	portfolioData,
	customerReport,
	detailedReport,
	isLoading,
	generatedRange,
	generatedStatus,
	activeTab,
	onTabChange,
	onProjectSelect,
}: {
	portfolioData: ProjectPortfolioData;
	customerReport: CustomerBillableReport | null;
	detailedReport: ProjectDetailedReport | null;
	isLoading: boolean;
	generatedRange: ReportDateRange | null;
	generatedStatus?: string[];
	activeTab: "portfolio" | "customers" | "project";
	onTabChange: (tab: "portfolio" | "customers" | "project") => void;
	onProjectSelect: (id: string) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const statuses: Record<string, string> = {
		active: t("reports.projects.status.active", "Active"),
		planned: t("reports.projects.status.planned", "Planned"),
		completed: t("reports.projects.status.completed", "Completed"),
		archived: t("reports.projects.status.archived", "Archived"),
	};
	const statusLabel =
		generatedStatus?.map((status) => statuses[status] ?? status).join(", ") ??
		t("reports.projects.filter.allStatuses", "All Statuses");
	return (
		<div inert={isLoading}>
			<p className="mb-4 text-sm text-muted-foreground">
				{generatedRange
					? formatPlainDateRange(
							Temporal.PlainDate.from(generatedRange.startDate),
							Temporal.PlainDate.from(generatedRange.endDate),
							locale,
							"dateMedium",
						)
					: null}{" "}
				· {statusLabel}
			</p>
			<Tabs
				value={activeTab}
				onValueChange={(v) => onTabChange(v as "portfolio" | "customers" | "project")}
			>
				<TabsList className="h-auto w-full flex-wrap">
					<TabsTrigger value="portfolio">
						{t("reports.projects.container.portfolioOverview", "Portfolio Overview")}
					</TabsTrigger>
					{customerReport && (
						<TabsTrigger value="customers">
							{t("reports.projects.container.customers", "Customers")}
						</TabsTrigger>
					)}
					<TabsTrigger
						className="min-w-0 whitespace-normal break-words"
						value="project"
						disabled={!detailedReport}
					>
						{detailedReport
							? detailedReport.project.name
							: t("reports.projects.container.projectDetails", "Project Details")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="portfolio" className="space-y-6">
					{/* Summary Cards */}
					<ProjectSummaryCards data={portfolioData.totals} />

					{portfolioData.totals.billable && portfolioData.billableTime && (
						<BillableFiguresCard
							figures={portfolioData.totals.billable}
							context={portfolioData.billableTime}
						/>
					)}

					{/* Portfolio Table */}
					<ProjectPortfolioTable
						projects={portfolioData.projects}
						onProjectSelect={onProjectSelect}
					/>
					<ProjectHealthAlerts
						projects={portfolioData.projects}
						onProjectSelect={onProjectSelect}
					/>

					<ProjectBudgetUtilizationSummary totals={portfolioData.totals.budgetHealth} />
				</TabsContent>

				{customerReport && (
					<TabsContent value="customers" className="space-y-6">
						<CustomerBillableView report={customerReport} onProjectSelect={onProjectSelect} />
					</TabsContent>
				)}

				<DetailedProjectReport detailedReport={detailedReport} />
			</Tabs>
		</div>
	);
}

function DetailedProjectReport({
	detailedReport,
}: {
	detailedReport: ProjectDetailedReport | null;
}) {
	return (
		<TabsContent value="project" className="space-y-6">
			{detailedReport && (
				<>
					<div className="flex flex-wrap justify-end gap-2">
						<ReportShareDialog
							target={{ kind: "project", projectId: detailedReport.project.id }}
							reportName={detailedReport.project.name}
							period={{
								// The report's days as UTC midnights (`readProjectDetailedReport`).
								fromDay: detailedReport.period.startDate.slice(0, 10),
								toDay: detailedReport.period.endDate.slice(0, 10),
							}}
							canShareRevenue={Boolean(
								detailedReport.summary.billable && detailedReport.billableTime,
							)}
						/>
						<ReportDocumentExportButtons
							source={detailedReport}
							buildDocument={(context) => buildProjectReportDocument(detailedReport, context)}
						/>
					</div>

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

					{/* Customer and custom fields (#820) */}
					<ProjectReportDetails project={detailedReport.project} />

					{/* Budget Progress */}
					{detailedReport.summary.budgetHours && (
						<ProjectBudgetProgress
							budgetHours={detailedReport.summary.budgetHours}
							usedHours={detailedReport.summary.totalHours}
						/>
					)}

					{detailedReport.summary.billable && detailedReport.billableTime && (
						<BillableFiguresCard
							figures={detailedReport.summary.billable}
							context={detailedReport.billableTime}
						/>
					)}

					{/* Hours Chart */}
					<ProjectHoursChart data={detailedReport.timeSeries} />

					{/* Team Breakdown */}
					<ProjectTeamBreakdown
						teamBreakdown={detailedReport.teamBreakdown}
						employeeBreakdown={detailedReport.employeeBreakdown}
					/>

					{/* Task Breakdown */}
					<ProjectTaskBreakdown taskBreakdown={detailedReport.taskBreakdown} />
					<BillableEmployeeTable employees={detailedReport.employeeBreakdown} />
				</>
			)}
		</TabsContent>
	);
}
