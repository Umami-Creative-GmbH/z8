"use client";

import {
	IconAlertCircle,
	IconChartBar,
	IconLoader2,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { generateReport } from "@/app/[locale]/(app)/reports/actions";
import { MonthClosureStrip } from "@/components/closed-months/month-closure-strip";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { authClient, useSession } from "@/lib/auth-client";
import type { ReportData, ReportDateRange } from "@/lib/reports/types";
import { monthsOfDateRange } from "@/lib/time-tracking/closed-months/month-label";
import { ExportButtons } from "./export-buttons";
import { ReportCustomFieldsCard } from "./report-custom-fields";
import { ReportFilters } from "./report-filters";
import { ReportPreviewTable } from "./report-preview-table";
import { ReportSummaryCards } from "./report-summary-cards";

interface ReportsContainerProps {
	currentEmployeeId: string;
	organizationId: string;
	userId: string;
}

export function ReportsContainer(props: ReportsContainerProps) {
	const { t } = useTranslate();
	const { data: session, isPending } = useSession();
	const scope = JSON.stringify([
		session?.user.id,
		session?.session.activeOrganizationId,
	]);
	const epoch = useRef(0);
	const [arrival, setArrival] = useState(0);
	useEffect(() => {
		let previous = scope;
		return authClient.$store.atoms.session.subscribe((value) => {
			const next = JSON.stringify([
				value.data?.user.id,
				value.data?.session.activeOrganizationId,
			]);
			if (next !== previous) {
				previous = next;
				epoch.current += 1;
				setArrival(epoch.current);
			}
		});
	}, [scope]);
	const isCurrent = () => epoch.current === arrival;
	// The server employee snapshot and the live account must describe the same arrival.
	// Unmounting here also invalidates A → B → A and held exports.
	if (
		isPending ||
		session?.user.id !== props.userId ||
		session.session.activeOrganizationId !== props.organizationId
	) {
		return (
			<p role="status" className="px-4 text-sm text-muted-foreground lg:px-6">
				{t("common.loading", "Loading...")}
			</p>
		);
	}
	return (
		<ReportWorkspace
			key={`${props.userId}:${props.organizationId}:${props.currentEmployeeId}:${arrival}`}
			isCurrent={isCurrent}
			{...props}
		/>
	);
}

function ReportWorkspace({
	currentEmployeeId,
	organizationId,
	userId,
	isCurrent,
}: ReportsContainerProps & { isCurrent: () => boolean }) {
	const { t } = useTranslate();
	const [reportData, setReportData] = useState<ReportData | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const lastCommand = useRef<{
		employeeId: string;
		dateRange: ReportDateRange;
	} | null>(null);
	const appliedCommand = useRef<{
		employeeId: string;
		dateRange: ReportDateRange;
	} | null>(null);
	const arrival = useRef<symbol | null>(null);
	const running = useRef<symbol | null>(null);
	// Activity disconnects effects without discarding state. Invalidate pending work
	// and release its controls when the workspace reconnects.
	useLayoutEffect(() => {
		arrival.current = Symbol("employee report arrival");
		running.current = null;
		// react-doctor-disable-next-line react-hooks-js/set-state-in-effect -- Activity reconnection releases a retired command's pending UI; public hide/return regression covers it.
		setIsGenerating(false);
		return () => {
			arrival.current = null;
		};
	}, []);

	const handleGenerateReport = async (
		employeeId: string,
		dateRange: ReportDateRange,
	) => {
		if (!arrival.current || running.current || !isCurrent()) return;
		const owner = arrival.current;
		running.current = owner;
		lastCommand.current = { employeeId, dateRange };
		setIsGenerating(true);
		setError(null);

		const result = await generateReport(
			employeeId,
			dateRange.startDate,
			dateRange.endDate,
		).catch((error) => ({
			success: false,
			error:
				error instanceof Error
					? error.message
					: t("reports.toast.unexpectedError", "An unexpected error occurred"),
			data: null,
		}));
		if (arrival.current !== owner || !isCurrent()) return;
		running.current = null;

		if (result.success && result.data) {
			appliedCommand.current = { employeeId, dateRange };
			setReportData(result.data);
			toast.success(
				t("reports.toast.reportGenerated", "Report generated successfully"),
				{
					description: t(
						"reports.toast.generatedFor",
						"Generated report for {name}",
						{
							name: result.data.employee.name,
						},
					),
				},
			);
			setIsGenerating(false);
			return;
		}

		setError(
			result.error ||
				t("reports.toast.failedGenerate", "Failed to generate report"),
		);
		// An authoritative refusal invalidates the earlier visible report; transient
		// source failures retain its clearly labeled snapshot for recovery.
		if (
			"code" in result &&
			(result.code === "AuthorizationError" ||
				result.code === "AuthenticationError" ||
				result.code === "NotFoundError")
		)
			setReportData(null);
		toast.error(
			t("reports.toast.failedGenerate", "Failed to generate report"),
			{
				description:
					result.error ||
					t("reports.toast.unknownError", "An unknown error occurred"),
			},
		);
		setIsGenerating(false);
	};
	useViewRefresh(async () => {
		if (!reportData || !appliedCommand.current) return;
		const command = appliedCommand.current;
		await handleGenerateReport(command.employeeId, command.dateRange);
	});

	return (
		<div className="space-y-6 px-4 lg:px-6">
			{/* Filters */}
			<ReportFilters
				currentEmployeeId={currentEmployeeId}
				onGenerate={handleGenerateReport}
				isGenerating={isGenerating}
			/>

			{/* Loading State */}
			{isGenerating && (
				<Card role="status">
					<CardContent className="flex items-center justify-center py-12">
						<div className="flex flex-col items-center gap-4">
							<IconLoader2
								aria-hidden="true"
								className="size-5 motion-safe:animate-spin text-muted-foreground"
							/>
							<div className="text-center">
								<p className="font-semibold">
									{t("reports.container.generating", "Generating Report...")}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"reports.container.pleaseWait",
										"Please wait while we compile your data",
									)}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Error Alert */}
			{error && (
				<Alert variant="destructive">
					<IconAlertCircle className="size-4" />
					<AlertTitle>{t("reports.container.error", "Error")}</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
					<Button
						variant="outline"
						disabled={isGenerating}
						onClick={() => {
							const command = lastCommand.current;
							if (command)
								void handleGenerateReport(
									command.employeeId,
									command.dateRange,
								);
						}}
					>
						{t("common.retry", "Retry")}
					</Button>
				</Alert>
			)}

			{/* Report Results */}
			{reportData && (
				<section
					aria-label={t("reports.preview.title", "Report preview")}
					className="min-w-0 space-y-5"
					aria-busy={isGenerating}
				>
					<div className="space-y-1 border-b pb-4">
						<h2 className="text-xl font-semibold break-words">
							{reportData.employee.name}
						</h2>
						<p className="font-medium tabular-nums">
							{reportData.period.label}
						</p>
						<p className="text-sm text-muted-foreground tabular-nums">
							{reportData.period.startDate} – {reportData.period.endDate}
						</p>
						{reportData.employee.employeeNumber && (
							<p className="text-sm text-muted-foreground">
								{t("reports.employeeNumber", "Employee number")}:{" "}
								{reportData.employee.employeeNumber}
							</p>
						)}
						{reportData.employee.position && (
							<p className="text-sm text-muted-foreground break-words">
								{reportData.employee.position}
							</p>
						)}
					</div>
					{/* Whether the report's months are closed for this employee (#762) */}
					<MonthClosureStrip
						months={monthsOfDateRange(
							reportData.period.startDate,
							reportData.period.endDate,
						)}
						employeeIds={[reportData.employee.id]}
					/>

					{/* Summary Cards */}
					<ReportSummaryCards reportData={reportData} />

					<div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
						<ReportPreviewTable reportData={reportData} />
						<aside className="min-w-0 space-y-5">
							<ReportCustomFieldsCard
								fields={reportData.employee.customFields}
							/>
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
										<ExportButtons
											reportData={reportData}
											isCurrent={isCurrent}
											disabled={isGenerating}
											exportScope={`${userId}:${organizationId}`}
										/>
									</div>
								</CardContent>
							</Card>
						</aside>
					</div>
				</section>
			)}

			{/* Empty State */}
			{!reportData && !isGenerating && !error && (
				<Card>
					<CardContent className="flex items-center justify-center py-12">
						<div className="flex flex-col items-center gap-4 text-center">
							<IconChartBar className="size-12 text-muted-foreground" />
							<div>
								<p className="font-semibold">
									{t(
										"reports.container.noReportYet",
										"No report generated yet",
									)}
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
