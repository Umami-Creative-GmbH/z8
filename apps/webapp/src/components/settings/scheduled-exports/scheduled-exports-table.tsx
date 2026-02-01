"use client";

import dynamic from "next/dynamic";
import { DateTime } from "luxon";
import { useCallback, useState } from "react";
import { useTranslate } from "@tolgee/react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Calendar, Clock, AlertCircle, CheckCircle2, Loader2, Play, History, Pencil, Trash2 } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	getScheduledExportsAction,
	toggleScheduledExportAction,
	deleteScheduledExportAction,
	getFilterOptionsAction,
	getPayrollConfigsAction,
	getScheduledExportAction,
	type ScheduledExportSummary,
	type FilterOptions,
	type PayrollConfigSummary,
} from "@/app/[locale]/(app)/settings/scheduled-exports/actions";

// Dynamic imports for heavy dialog components (bundle-dynamic-imports)
const ScheduledExportDialog = dynamic(
	() => import("./scheduled-export-dialog").then((m) => m.ScheduledExportDialog),
	{ ssr: false },
);
const ExecutionHistoryDialog = dynamic(
	() => import("./execution-history-dialog").then((m) => m.ExecutionHistoryDialog),
	{ ssr: false },
);
const RunNowDialog = dynamic(
	() => import("./run-now-dialog").then((m) => m.RunNowDialog),
	{ ssr: false },
);

interface ScheduledExportsTableProps {
	organizationId: string;
	initialSchedules: ScheduledExportSummary[];
	initialFilterOptions: FilterOptions | null;
	initialPayrollConfigs: PayrollConfigSummary[];
}

export function ScheduledExportsTable({
	organizationId,
	initialSchedules,
	initialFilterOptions,
	initialPayrollConfigs,
}: ScheduledExportsTableProps) {
	const { t } = useTranslate();

	// Dialog states
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [editScheduleId, setEditScheduleId] = useState<string | null>(null);
	const [historySchedule, setHistorySchedule] = useState<ScheduledExportSummary | null>(null);
	const [runNowSchedule, setRunNowSchedule] = useState<ScheduledExportSummary | null>(null);
	const [deleteSchedule, setDeleteSchedule] = useState<ScheduledExportSummary | null>(null);

	// Filter options and payroll configs for the dialog
	const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(initialFilterOptions);
	const [payrollConfigs, setPayrollConfigs] = useState<PayrollConfigSummary[]>(initialPayrollConfigs);
	const [editInitialValues, setEditInitialValues] = useState<Record<string, unknown> | null>(null);

	// Fetch schedules with SWR for automatic deduplication and caching
	const {
		data: schedules,
		error,
		isLoading: loading,
		mutate,
	} = useSWR(
		["scheduled-exports", organizationId],
		async () => {
			const result = await getScheduledExportsAction(organizationId);
			if (result.success) {
				return result.data;
			}
			throw new Error(result.error || t("settings.scheduledExports.error.loadFailed", "Failed to load scheduled exports"));
		},
		{
			fallbackData: initialSchedules,
			revalidateOnFocus: false,
		},
	);

	// Load filter options and payroll configs when dialog opens
	const loadDialogData = useCallback(async () => {
		const [filterResult, configResult] = await Promise.all([
			getFilterOptionsAction(organizationId),
			getPayrollConfigsAction(organizationId),
		]);

		if (filterResult.success) {
			setFilterOptions(filterResult.data);
		}
		if (configResult.success) {
			setPayrollConfigs(configResult.data);
		}
	}, [organizationId]);

	// Load schedule for editing
	const loadScheduleForEdit = useCallback(async (scheduleId: string) => {
		const result = await getScheduledExportAction(organizationId, scheduleId);
		if (result.success && result.data) {
			const schedule = result.data;
			setEditInitialValues({
				name: schedule.name,
				description: schedule.description,
				scheduleType: schedule.scheduleType,
				cronExpression: schedule.cronExpression,
				timezone: schedule.timezone,
				reportType: schedule.reportType,
				reportConfig: schedule.reportConfig,
				payrollConfigId: schedule.payrollConfigId,
				filters: schedule.filters,
				dateRangeStrategy: schedule.dateRangeStrategy,
				customOffset: schedule.customOffset,
				deliveryMethod: schedule.deliveryMethod,
				emailRecipients: schedule.emailRecipients,
				emailSubjectTemplate: schedule.emailSubjectTemplate,
				useOrgS3Config: schedule.useOrgS3Config,
				customS3Prefix: schedule.customS3Prefix,
			});
			setEditScheduleId(scheduleId);
		}
	}, [organizationId]);

	// Open create dialog
	const handleOpenCreate = async () => {
		await loadDialogData();
		setEditScheduleId(null);
		setEditInitialValues(null);
		setIsCreateDialogOpen(true);
	};

	// Open edit dialog (async-parallel: fetch data in parallel)
	const handleOpenEdit = async (scheduleId: string) => {
		await Promise.all([
			loadDialogData(),
			loadScheduleForEdit(scheduleId),
		]);
		setIsCreateDialogOpen(true);
	};

	// Toggle schedule active status with optimistic update
	const handleToggle = async (scheduleId: string, isActive: boolean) => {
		if (!schedules) return;

		// Optimistic update
		const optimisticData = schedules.map((s) =>
			s.id === scheduleId ? { ...s, isActive } : s,
		);

		await mutate(
			async () => {
				const result = await toggleScheduledExportAction(organizationId, scheduleId, isActive);
				if (result.success) {
					return optimisticData;
				}
				throw new Error(t("settings.scheduledExports.error.toggleFailed", "Toggle failed"));
			},
			{
				optimisticData,
				rollbackOnError: true,
				revalidate: false,
			},
		);
	};

	// Delete schedule with optimistic update
	const handleConfirmDelete = async () => {
		if (!schedules || !deleteSchedule) return;

		const scheduleId = deleteSchedule.id;
		setDeleteSchedule(null);

		// Optimistic update
		const optimisticData = schedules.filter((s) => s.id !== scheduleId);

		await mutate(
			async () => {
				const result = await deleteScheduledExportAction(organizationId, scheduleId);
				if (result.success) {
					return optimisticData;
				}
				throw new Error(t("settings.scheduledExports.error.deleteFailed", "Delete failed"));
			},
			{
				optimisticData,
				rollbackOnError: true,
				revalidate: false,
			},
		);
	};

	// Format schedule description
	const getScheduleLabel = (schedule: ScheduledExportSummary): string => {
		switch (schedule.scheduleType) {
			case "daily":
				return t("settings.scheduledExports.scheduleType.daily", "Daily");
			case "weekly":
				return t("settings.scheduledExports.scheduleType.weekly", "Weekly");
			case "monthly":
				return t("settings.scheduledExports.scheduleType.monthly", "Monthly");
			case "quarterly":
				return t("settings.scheduledExports.scheduleType.quarterly", "Quarterly");
			case "cron":
				return schedule.cronExpression || t("settings.scheduledExports.scheduleType.custom", "Custom");
			default:
				return t("settings.scheduledExports.scheduleType.unknown", "Unknown");
		}
	};

	// Format report type
	const getReportTypeLabel = (type: string): string => {
		switch (type) {
			case "payroll_export":
				return t("settings.scheduledExports.reportType.payrollShort", "Payroll");
			case "data_export":
				return t("settings.scheduledExports.reportType.dataShort", "Data");
			case "audit_report":
				return t("settings.scheduledExports.reportType.auditShort", "Audit");
			default:
				return type;
		}
	};

	// Format date
	const formatDate = (date: Date | null): string => {
		if (!date) return t("settings.scheduledExports.table.never", "Never");
		return DateTime.fromJSDate(date).toLocaleString(DateTime.DATETIME_SHORT);
	};

	if (loading && !schedules) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label={t("common.loading", "Loading")} />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.scheduledExports.title", "Scheduled Exports")}</h1>
					<p className="text-muted-foreground">
						{t("settings.scheduledExports.description", "Configure recurring exports for payroll, data, and audit reports.")}
					</p>
				</div>
				<Button onClick={handleOpenCreate}>
					<Plus className="h-4 w-4 mr-2" aria-hidden="true" />
					{t("settings.scheduledExports.newSchedule", "New Schedule")}
				</Button>
			</div>

			{/* Error state */}
			{error && (
				<Card className="border-destructive">
					<CardContent className="pt-6">
						<div className="flex items-center gap-2 text-destructive" role="alert">
							<AlertCircle className="h-5 w-5" aria-hidden="true" />
							<p>{error instanceof Error ? error.message : t("settings.scheduledExports.error.loadFailed", "Failed to load scheduled exports")}</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Empty state */}
			{!error && schedules?.length === 0 && (
				<Card>
					<CardContent className="py-12">
						<div className="text-center">
							<Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
							<h3 className="text-lg font-medium mb-2">{t("settings.scheduledExports.empty.title", "No scheduled exports")}</h3>
							<p className="text-muted-foreground mb-6">
								{t("settings.scheduledExports.empty.description", "Create your first scheduled export to automate recurring reports.")}
							</p>
							<Button onClick={handleOpenCreate}>
								<Plus className="h-4 w-4 mr-2" aria-hidden="true" />
								{t("settings.scheduledExports.empty.createButton", "Create Schedule")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Schedules table */}
			{schedules && schedules.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.scheduledExports.table.title", "Active Schedules")}</CardTitle>
						<CardDescription>
							{t("settings.scheduledExports.table.description", "Manage your recurring export schedules")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.scheduledExports.table.name", "Name")}</TableHead>
									<TableHead>{t("settings.scheduledExports.table.type", "Type")}</TableHead>
									<TableHead>{t("settings.scheduledExports.table.schedule", "Schedule")}</TableHead>
									<TableHead>{t("settings.scheduledExports.table.lastRun", "Last Run")}</TableHead>
									<TableHead>{t("settings.scheduledExports.table.nextRun", "Next Run")}</TableHead>
									<TableHead>{t("settings.scheduledExports.table.status", "Status")}</TableHead>
									<TableHead className="w-[80px]">
										<span className="sr-only">{t("settings.scheduledExports.table.actions", "Actions")}</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{schedules.map((schedule) => (
									<TableRow key={schedule.id}>
										<TableCell>
											<div className="font-medium">{schedule.name}</div>
											{schedule.description && (
												<div className="text-sm text-muted-foreground">
													{schedule.description}
												</div>
											)}
										</TableCell>
										<TableCell>
											<Badge variant="secondary">
												{getReportTypeLabel(schedule.reportType)}
											</Badge>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
												{getScheduleLabel(schedule)}
											</div>
											<div className="text-xs text-muted-foreground">
												{schedule.timezone}
											</div>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{formatDate(schedule.lastExecutionAt)}
										</TableCell>
										<TableCell>
											{schedule.isActive ? (
												formatDate(schedule.nextExecutionAt)
											) : (
												<span className="text-muted-foreground">{t("settings.scheduledExports.table.paused", "Paused")}</span>
											)}
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<Switch
													checked={schedule.isActive}
													onCheckedChange={(checked) =>
														handleToggle(schedule.id, checked)
													}
													aria-label={schedule.isActive
														? t("settings.scheduledExports.table.deactivate", "Deactivate schedule")
														: t("settings.scheduledExports.table.activate", "Activate schedule")}
												/>
												{schedule.isActive ? (
													<CheckCircle2 className="h-4 w-4 text-green-500" aria-label={t("settings.scheduledExports.table.active", "Active")} />
												) : (
													<AlertCircle className="h-4 w-4 text-muted-foreground" aria-label={t("settings.scheduledExports.table.inactive", "Inactive")} />
												)}
											</div>
										</TableCell>
										<TableCell>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														variant="ghost"
														size="sm"
														aria-label={t("settings.scheduledExports.table.openMenu", "Open actions menu")}
													>
														<MoreHorizontal className="h-4 w-4" aria-hidden="true" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => handleOpenEdit(schedule.id)}>
														<Pencil className="h-4 w-4 mr-2" aria-hidden="true" />
														{t("settings.scheduledExports.actions.edit", "Edit")}
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => setHistorySchedule(schedule)}>
														<History className="h-4 w-4 mr-2" aria-hidden="true" />
														{t("settings.scheduledExports.actions.viewHistory", "View History")}
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => setRunNowSchedule(schedule)}>
														<Play className="h-4 w-4 mr-2" aria-hidden="true" />
														{t("settings.scheduledExports.actions.runNow", "Run Now")}
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														className="text-destructive"
														onClick={() => setDeleteSchedule(schedule)}
													>
														<Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
														{t("settings.scheduledExports.actions.delete", "Delete")}
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			{/* Help text */}
			<Card>
				<CardContent className="pt-6">
					<div className="text-sm text-muted-foreground space-y-2">
						<p>
							<strong>{t("settings.scheduledExports.help.scheduleTypes", "Schedule Types:")}</strong>{" "}
							{t("settings.scheduledExports.help.scheduleTypesDesc", "Daily, Weekly (Monday), Monthly (1st), Quarterly (Jan/Apr/Jul/Oct 1st), or custom cron expressions.")}
						</p>
						<p>
							<strong>{t("settings.scheduledExports.help.delivery", "Delivery:")}</strong>{" "}
							{t("settings.scheduledExports.help.deliveryDesc", "Exports are uploaded to S3 and email notifications with download links are sent to configured recipients.")}
						</p>
						<p>
							<strong>{t("settings.scheduledExports.help.dateRanges", "Date Ranges:")}</strong>{" "}
							{t("settings.scheduledExports.help.dateRangesDesc", "Automatically calculated based on the schedule frequency (e.g., previous month for monthly exports).")}
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Create/Edit Dialog */}
			<ScheduledExportDialog
				open={isCreateDialogOpen}
				onOpenChange={(open) => {
					setIsCreateDialogOpen(open);
					if (!open) {
						setEditScheduleId(null);
						setEditInitialValues(null);
					}
				}}
				organizationId={organizationId}
				editScheduleId={editScheduleId ?? undefined}
				initialValues={editInitialValues ?? undefined}
				payrollConfigs={payrollConfigs}
				filterOptions={filterOptions}
				onSuccess={() => mutate()}
			/>

			{/* Execution History Dialog */}
			{historySchedule && (
				<ExecutionHistoryDialog
					open={Boolean(historySchedule)}
					onOpenChange={(open) => !open && setHistorySchedule(null)}
					organizationId={organizationId}
					scheduleId={historySchedule.id}
					scheduleName={historySchedule.name}
				/>
			)}

			{/* Run Now Dialog */}
			{runNowSchedule && (
				<RunNowDialog
					open={Boolean(runNowSchedule)}
					onOpenChange={(open) => !open && setRunNowSchedule(null)}
					organizationId={organizationId}
					scheduleId={runNowSchedule.id}
					scheduleName={runNowSchedule.name}
					dateRangeStrategy={runNowSchedule.dateRangeStrategy}
					onSuccess={() => mutate()}
				/>
			)}

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={Boolean(deleteSchedule)} onOpenChange={(open) => !open && setDeleteSchedule(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.scheduledExports.deleteDialog.title", "Delete Scheduled Export")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.scheduledExports.deleteDialog.description",
								"Are you sure you want to delete \"{name}\"? This action cannot be undone.",
								{ name: deleteSchedule?.name ?? "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{t("settings.scheduledExports.deleteDialog.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("settings.scheduledExports.deleteDialog.confirm", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
