/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useTranslate } from "@tolgee/react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ScheduledExportForm } from "../scheduled-export-dialog";
import type { FilterOptions } from "./step-filters";

interface StepReviewProps {
	form: ScheduledExportForm;
	filterOptions: FilterOptions | null;
	payrollConfigs: Array<{ id: string; formatId: string; formatName: string }>;
}

/** Reusable component for displaying a label-value pair in the review */
function ReviewField({
	label,
	value,
	code = false,
}: {
	label: string;
	value: React.ReactNode;
	code?: boolean;
}) {
	return (
		<div className="flex justify-between">
			<span className="text-muted-foreground">{label}</span>
			{code ? (
				<code className="bg-muted px-1.5 py-0.5 rounded text-xs">{value}</code>
			) : (
				<span className="font-medium">{value}</span>
			)}
		</div>
	);
}

export function StepReview({ form, filterOptions, payrollConfigs }: StepReviewProps) {
	const { t } = useTranslate();

	const SCHEDULE_TYPE_LABELS: Record<string, string> = {
		daily: t("settings.scheduledExports.scheduleType.dailyLabel", "Daily (midnight)"),
		weekly: t("settings.scheduledExports.scheduleType.weeklyLabel", "Weekly (Monday)"),
		monthly: t("settings.scheduledExports.scheduleType.monthlyLabel", "Monthly (1st)"),
		quarterly: t("settings.scheduledExports.scheduleType.quarterlyLabel", "Quarterly"),
		cron: t("settings.scheduledExports.scheduleType.cronLabel", "Custom (Cron)"),
	};

	const REPORT_TYPE_LABELS: Record<string, string> = {
		payroll_export: t("settings.scheduledExports.reportType.payroll", "Payroll Export"),
		data_export: t("settings.scheduledExports.reportType.data", "Data Export"),
		audit_report: t("settings.scheduledExports.reportType.audit", "Audit Report"),
	};

	const DATE_RANGE_LABELS: Record<string, string> = {
		previous_day: t("settings.scheduledExports.dateRange.previousDay", "Previous Day"),
		previous_week: t("settings.scheduledExports.dateRange.previousWeek", "Previous Week"),
		previous_month: t("settings.scheduledExports.dateRange.previousMonth", "Previous Month"),
		previous_quarter: t("settings.scheduledExports.dateRange.previousQuarter", "Previous Quarter"),
		custom_offset: t("settings.scheduledExports.dateRange.customOffset", "Custom Offset"),
	};

	const DELIVERY_METHOD_LABELS: Record<string, string> = {
		s3_and_email: t("settings.scheduledExports.deliveryMethod.s3AndEmail", "S3 + Email"),
		email_only: t("settings.scheduledExports.deliveryMethod.emailOnly", "Email Only"),
		s3_only: t("settings.scheduledExports.deliveryMethod.s3Only", "S3 Only"),
	};

	return (
		<form.Subscribe
			selector={(state: any) => state.values}
		>
			{(values: any) => {
				const payrollConfig = payrollConfigs.find((c) => c.id === values.payrollConfigId);
				const selectedEmployees = filterOptions?.employees.filter((e) =>
					values.filters?.employeeIds?.includes(e.id),
				);
				const selectedTeams = filterOptions?.teams.filter((t) =>
					values.filters?.teamIds?.includes(t.id),
				);
				const selectedProjects = filterOptions?.projects.filter((p) =>
					values.filters?.projectIds?.includes(p.id),
				);

				return (
					<div className="space-y-4" role="region" aria-label={t("settings.scheduledExports.review.region", "Configuration summary")}>
						<div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
							<Check className="h-4 w-4 text-green-500" aria-hidden="true" />
							<span>{t("settings.scheduledExports.review.instructions", "Review your schedule configuration before creating")}</span>
						</div>

						{/* Schedule */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">{t("settings.scheduledExports.review.schedule", "Schedule")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 text-sm">
								<ReviewField
									label={t("settings.scheduledExports.review.name", "Name")}
									value={values.name || "-"}
								/>
								{values.description && (
									<ReviewField
										label={t("settings.scheduledExports.review.description", "Description")}
										value={values.description}
									/>
								)}
								<ReviewField
									label={t("settings.scheduledExports.review.scheduleType", "Schedule Type")}
									value={SCHEDULE_TYPE_LABELS[values.scheduleType] || values.scheduleType}
								/>
								{values.scheduleType === "cron" && values.cronExpression && (
									<ReviewField
										label={t("settings.scheduledExports.review.cronExpression", "Cron Expression")}
										value={values.cronExpression}
										code
									/>
								)}
								<ReviewField
									label={t("settings.scheduledExports.review.timezone", "Timezone")}
									value={values.timezone}
								/>
							</CardContent>
						</Card>

						{/* Report */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">{t("settings.scheduledExports.review.report", "Report")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 text-sm">
								<div className="flex justify-between">
									<span className="text-muted-foreground">{t("settings.scheduledExports.review.reportType", "Report Type")}</span>
									<Badge variant="secondary">
										{REPORT_TYPE_LABELS[values.reportType] || values.reportType}
									</Badge>
								</div>
								{values.reportType === "payroll_export" && payrollConfig && (
									<ReviewField
										label={t("settings.scheduledExports.review.format", "Format")}
										value={payrollConfig.formatName}
									/>
								)}
								{values.reportType === "data_export" &&
									values.reportConfig?.categories && (
										<ReviewField
											label={t("settings.scheduledExports.review.categories", "Categories")}
											value={(values.reportConfig.categories as string[]).join(", ")}
										/>
									)}
							</CardContent>
						</Card>

						{/* Filters */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">{t("settings.scheduledExports.review.filtersAndDateRange", "Filters & Date Range")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 text-sm">
								<ReviewField
									label={t("settings.scheduledExports.review.dateRange", "Date Range")}
									value={DATE_RANGE_LABELS[values.dateRangeStrategy] || values.dateRangeStrategy}
								/>
								<ReviewField
									label={t("settings.scheduledExports.review.employees", "Employees")}
									value={selectedEmployees && selectedEmployees.length > 0
										? t("settings.scheduledExports.filters.selectedCount", "{count} selected", { count: selectedEmployees.length })
										: t("settings.scheduledExports.review.all", "All")}
								/>
								<ReviewField
									label={t("settings.scheduledExports.review.teams", "Teams")}
									value={selectedTeams && selectedTeams.length > 0
										? t("settings.scheduledExports.filters.selectedCount", "{count} selected", { count: selectedTeams.length })
										: t("settings.scheduledExports.review.all", "All")}
								/>
								<ReviewField
									label={t("settings.scheduledExports.review.projects", "Projects")}
									value={selectedProjects && selectedProjects.length > 0
										? t("settings.scheduledExports.filters.selectedCount", "{count} selected", { count: selectedProjects.length })
										: t("settings.scheduledExports.review.all", "All")}
								/>
							</CardContent>
						</Card>

						{/* Delivery */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">{t("settings.scheduledExports.review.delivery", "Delivery")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 text-sm">
								<ReviewField
									label={t("settings.scheduledExports.review.method", "Method")}
									value={DELIVERY_METHOD_LABELS[values.deliveryMethod] || values.deliveryMethod}
								/>
								{(values.deliveryMethod === "s3_and_email" ||
									values.deliveryMethod === "email_only") && (
									<ReviewField
										label={t("settings.scheduledExports.review.recipients", "Recipients")}
										value={values.emailRecipients.length > 0
											? values.emailRecipients.join(", ")
											: "-"}
									/>
								)}
								{values.customS3Prefix && (
									<ReviewField
										label={t("settings.scheduledExports.review.s3Prefix", "S3 Prefix")}
										value={values.customS3Prefix}
										code
									/>
								)}
							</CardContent>
						</Card>
					</div>
				);
			}}
		</form.Subscribe>
	);
}
