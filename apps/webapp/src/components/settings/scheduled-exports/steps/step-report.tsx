/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useTranslate } from "@tolgee/react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { ScheduledExportForm } from "../scheduled-export-dialog";
import type { ReportType } from "@/lib/scheduled-exports/domain/types";

interface StepReportProps {
	form: ScheduledExportForm;
	payrollConfigs: Array<{ id: string; formatId: string; formatName: string }>;
}

export function StepReport({ form, payrollConfigs }: StepReportProps) {
	const { t } = useTranslate();

	const REPORT_TYPES: { value: ReportType; label: string; description: string }[] = [
		{
			value: "payroll_export",
			label: t("settings.scheduledExports.reportType.payroll", "Payroll Export"),
			description: t("settings.scheduledExports.reportType.payrollDesc", "Export time data for payroll processing (DATEV, Sage, Lexware, etc.)"),
		},
		{
			value: "data_export",
			label: t("settings.scheduledExports.reportType.data", "Data Export"),
			description: t("settings.scheduledExports.reportType.dataDesc", "Export raw data (employees, time entries, absences)"),
		},
		{
			value: "audit_report",
			label: t("settings.scheduledExports.reportType.audit", "Audit Report"),
			description: t("settings.scheduledExports.reportType.auditDesc", "GoBD-compliant audit export with cryptographic proofs"),
		},
	];

	const DATA_CATEGORIES = [
		{ id: "employees", label: t("settings.scheduledExports.dataCategories.employees", "Employees") },
		{ id: "time_entries", label: t("settings.scheduledExports.dataCategories.timeEntries", "Time Entries") },
		{ id: "absences", label: t("settings.scheduledExports.dataCategories.absences", "Absences") },
		{ id: "projects", label: t("settings.scheduledExports.dataCategories.projects", "Projects") },
	];

	return (
		<div className="space-y-6">
			<form.Field name="reportType">
				{(field: any) => (
					<div className="space-y-2">
						<Label id="report-type-label">
							{t("settings.scheduledExports.report.reportType", "Report Type")} *
						</Label>
						<Select
							value={field.state.value}
							onValueChange={(v) => {
								field.handleChange(v as ReportType);
								// Reset report-specific config when type changes
								form.setFieldValue("reportConfig", {});
								form.setFieldValue("payrollConfigId", undefined);
							}}
							aria-labelledby="report-type-label"
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{REPORT_TYPES.map((type) => (
									<SelectItem key={type.value} value={type.value}>
										<div>
											<div>{type.label}</div>
											<div className="text-xs text-muted-foreground">
												{type.description}
											</div>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</form.Field>

			<form.Subscribe selector={(state: any) => state.values.reportType}>
				{(reportType: any) => (
					<>
						{reportType === "payroll_export" && (
							<PayrollReportConfig form={form} payrollConfigs={payrollConfigs} />
						)}

						{reportType === "data_export" && <DataReportConfig form={form} categories={DATA_CATEGORIES} />}

						{reportType === "audit_report" && <AuditReportConfig form={form} />}
					</>
				)}
			</form.Subscribe>
		</div>
	);
}

function PayrollReportConfig({
	form,
	payrollConfigs,
}: {
	form: ScheduledExportForm;
	payrollConfigs: Array<{ id: string; formatId: string; formatName: string }>;
}) {
	const { t } = useTranslate();
	const hasConfigs = payrollConfigs.length > 0;

	if (!hasConfigs) {
		return (
			<Alert role="alert">
				<AlertCircle className="h-4 w-4" aria-hidden="true" />
				<AlertTitle>{t("settings.scheduledExports.report.noPayrollConfig", "No Payroll Configuration")}</AlertTitle>
				<AlertDescription>
					{t("settings.scheduledExports.report.noPayrollConfigDesc", "You need to configure at least one payroll export format (DATEV, Sage, etc.) before creating a scheduled payroll export. Go to Settings → Payroll Export to set up your configuration.")}
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="space-y-4">
			<form.Field name="payrollConfigId">
				{(field: any) => (
					<div className="space-y-2">
						<Label id="payroll-config-label">
							{t("settings.scheduledExports.report.payrollConfig", "Payroll Configuration")} *
						</Label>
						<Select
							value={field.state.value || ""}
							onValueChange={(v) => {
								field.handleChange(v);
								// Set formatId in reportConfig from selected config
								const config = payrollConfigs.find((c) => c.id === v);
								if (config) {
									form.setFieldValue("reportConfig", { formatId: config.formatId });
								}
							}}
							aria-labelledby="payroll-config-label"
						>
							<SelectTrigger aria-describedby="payroll-config-hint">
								<SelectValue placeholder={t("settings.scheduledExports.report.selectPayrollConfig", "Select payroll configuration")} />
							</SelectTrigger>
							<SelectContent>
								{payrollConfigs.map((config) => (
									<SelectItem key={config.id} value={config.id}>
										{config.formatName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p id="payroll-config-hint" className="text-xs text-muted-foreground">
							{t("settings.scheduledExports.report.payrollConfigHint", "Select the payroll format configuration to use for this export")}
						</p>
					</div>
				)}
			</form.Field>
		</div>
	);
}

function DataReportConfig({
	form,
	categories,
}: {
	form: ScheduledExportForm;
	categories: Array<{ id: string; label: string }>;
}) {
	const { t } = useTranslate();

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label>{t("settings.scheduledExports.report.dataCategories", "Data Categories")}</Label>
				<p className="text-sm text-muted-foreground">
					{t("settings.scheduledExports.report.dataCategoriesHint", "Select which data to include in the export")}
				</p>
			</div>

			<form.Field name="reportConfig">
				{(field: any) => {
					const selectedCategories = (field.state.value?.categories as string[]) || [];

					const toggleCategory = (categoryId: string) => {
						const newCategories = selectedCategories.includes(categoryId)
							? selectedCategories.filter((c: string) => c !== categoryId)
							: [...selectedCategories, categoryId];
						field.handleChange({ ...field.state.value, categories: newCategories });
					};

					return (
						<div className="space-y-3" role="group" aria-label={t("settings.scheduledExports.report.dataCategoriesGroup", "Data categories selection")}>
							{categories.map((category) => (
								<div key={category.id} className="flex items-center space-x-2">
									<Checkbox
										id={`category-${category.id}`}
										checked={selectedCategories.includes(category.id)}
										onCheckedChange={() => toggleCategory(category.id)}
									/>
									<label
										htmlFor={`category-${category.id}`}
										className="text-sm cursor-pointer"
									>
										{category.label}
									</label>
								</div>
							))}
						</div>
					);
				}}
			</form.Field>
		</div>
	);
}

function AuditReportConfig({
	form,
}: {
	form: ScheduledExportForm;
}) {
	const { t } = useTranslate();

	return (
		<div className="space-y-4">
			<Alert>
				<AlertCircle className="h-4 w-4" aria-hidden="true" />
				<AlertTitle>{t("settings.scheduledExports.report.auditReport", "Audit Report")}</AlertTitle>
				<AlertDescription>
					{t("settings.scheduledExports.report.auditReportDesc", "Audit reports include all time tracking data with cryptographic signatures and timestamps for GoBD compliance. The export will be stored with WORM (Write Once Read Many) protection.")}
				</AlertDescription>
			</Alert>

			<form.Field name="reportConfig">
				{(field: any) => (
					<div className="flex items-center space-x-2">
						<Checkbox
							id="include-metadata"
							checked={field.state.value?.includeMetadata ?? true}
							onCheckedChange={(checked) =>
								field.handleChange({
									...field.state.value,
									includeMetadata: checked === true,
								})
							}
						/>
						<label htmlFor="include-metadata" className="text-sm cursor-pointer">
							{t("settings.scheduledExports.report.includeMetadata", "Include audit metadata (signatures, timestamps, checksums)")}
						</label>
					</div>
				)}
			</form.Field>
		</div>
	);
}
