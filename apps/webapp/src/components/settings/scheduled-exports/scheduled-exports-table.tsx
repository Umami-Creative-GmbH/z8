"use client";

import {
	IconAlertCircle,
	IconCalendar,
	IconCircleCheck,
	IconClock,
	IconDots,
	IconHistory,
	IconLoader2,
	IconPencil,
	IconPlayerPlay,
	IconPlus,
	IconRefresh,
	IconTrash,
	IconUserCog,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteScheduledExportAction,
	type FilterOptions,
	getFilterOptionsAction,
	getPayrollConfigsAction,
	getScheduledExportAction,
	getScheduledExportsAction,
	type PayrollConfigSummary,
	type ScheduledExportSummary,
	toggleScheduledExportAction,
} from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
import { describeFailure, useConfirmedAction } from "@/components/settings/confirm-action-dialog";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { SCHEDULED_EXPORT_REFUSALS } from "./scheduled-export-refusals";

// Dynamic imports for heavy dialog components (bundle-dynamic-imports)
const ScheduledExportDialog = dynamic(
	() =>
		import("./scheduled-export-dialog").then((m) => m.ScheduledExportDialog),
	{ ssr: false },
);
const ExecutionHistoryDialog = dynamic(
	() =>
		import("./execution-history-dialog").then((m) => m.ExecutionHistoryDialog),
	{ ssr: false },
);
const RunNowDialog = dynamic(
	() => import("./run-now-dialog").then((m) => m.RunNowDialog),
	{
		ssr: false,
	},
);
const ChangeOwnerDialog = dynamic(
	() => import("./change-owner-dialog").then((m) => m.ChangeOwnerDialog),
	{ ssr: false },
);

interface ScheduledExportsTableProps {
	organizationId: string;
	currentUserId: string;
	initialSchedules: ScheduledExportSummary[];
	initialFilterOptions: FilterOptions | null;
	initialPayrollConfigs: PayrollConfigSummary[];
}

export function ScheduledExportsTable({
	organizationId,
	currentUserId,
	initialSchedules,
	initialFilterOptions,
	initialPayrollConfigs,
}: ScheduledExportsTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const schedulesKey = ["scheduled-exports", currentUserId, organizationId] as const;

	// Dialog states
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [editScheduleId, setEditScheduleId] = useState<string | null>(null);
	const [historySchedule, setHistorySchedule] =
		useState<ScheduledExportSummary | null>(null);
	const [runNowSchedule, setRunNowSchedule] =
		useState<ScheduledExportSummary | null>(null);
	const deletion = useConfirmedAction<ScheduledExportSummary>();
	const [ownerSchedule, setOwnerSchedule] =
		useState<ScheduledExportSummary | null>(null);

	// Filter options and payroll configs for the dialog
	const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(
		initialFilterOptions,
	);
	const [payrollConfigs, setPayrollConfigs] = useState<PayrollConfigSummary[]>(
		initialPayrollConfigs,
	);
	const [editInitialValues, setEditInitialValues] = useState<Record<
		string,
		unknown
	> | null>(null);

	// Share one actor/org-scoped cache with the application's refresh owner.
	const {
		data: schedules,
		error,
		isFetching,
		isLoading: loading,
		refetch,
	} = useQuery({
		queryKey: schedulesKey,
		queryFn: async () => {
			const result = await getScheduledExportsAction();
			if (result.success) {
				return result.data;
			}
			throw new Error(
				actionErrorMessage(t, result, {}, [
					"settings.scheduledExports.error.loadFailed",
					"Failed to load scheduled exports",
				]),
			);
		},
		initialData: initialSchedules,
		staleTime: 0,
		refetchOnWindowFocus: false,
	});
	const mutate = () => refetch({ cancelRefetch: false });
	const changeSchedule = useMutation({
		mutationFn: async (change: {
			scheduleId: string;
			kind: "toggle" | "delete";
			isActive?: boolean;
		}) => {
			const result =
				change.kind === "delete"
					? await deleteScheduledExportAction({ scheduleId: change.scheduleId })
					: await toggleScheduledExportAction({
							scheduleId: change.scheduleId,
							isActive: Boolean(change.isActive),
						});
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, SCHEDULED_EXPORT_REFUSALS, [
						change.kind === "delete"
							? "settings.scheduledExports.error.deleteFailed"
							: "settings.scheduledExports.error.toggleFailed",
						change.kind === "delete" ? "Delete failed" : "Toggle failed",
					]),
				);
			}
		},
		onMutate: async (change) => {
			await queryClient.cancelQueries({ queryKey: schedulesKey, exact: true });
			const previous = queryClient.getQueryData<ScheduledExportSummary[]>(schedulesKey);
			queryClient.setQueryData<ScheduledExportSummary[]>(schedulesKey, (current) =>
				change.kind === "delete"
					? current?.filter((schedule) => schedule.id !== change.scheduleId)
					: current?.map((schedule) =>
							schedule.id === change.scheduleId
								? { ...schedule, isActive: Boolean(change.isActive) }
								: schedule,
						),
			);
			return { previous };
		},
		onError: (cause, change, context) => {
			if (context?.previous) queryClient.setQueryData(schedulesKey, context.previous);
			// A failed deletion is shown inside its confirmation dialog instead.
			if (change.kind !== "delete") toast.error(cause.message);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: schedulesKey, exact: true }),
		// Retrying a mutation can duplicate a successful server operation after transport loss.
		retry: false,
	});

	// Load filter options and payroll configs when dialog opens
	const loadDialogData = async () => {
		const [filterResult, configResult] = await Promise.all([
			getFilterOptionsAction(),
			getPayrollConfigsAction(),
		]);

		if (filterResult.success) {
			setFilterOptions(filterResult.data);
		}
		if (configResult.success) {
			setPayrollConfigs(configResult.data);
		}
	};

	// Load schedule for editing
	const loadScheduleForEdit = async (scheduleId: string) => {
		const result = await getScheduledExportAction({ scheduleId });
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
	};

	// Open create dialog
	const handleOpenCreate = async () => {
		await loadDialogData();
		setEditScheduleId(null);
		setEditInitialValues(null);
		setIsCreateDialogOpen(true);
	};

	// Open edit dialog (async-parallel: fetch data in parallel)
	const handleOpenEdit = async (scheduleId: string) => {
		await Promise.all([loadDialogData(), loadScheduleForEdit(scheduleId)]);
		setIsCreateDialogOpen(true);
	};

	// Toggle schedule active status with optimistic update
	const handleToggle = async (scheduleId: string, isActive: boolean) => {
		changeSchedule.mutate({ scheduleId, kind: "toggle", isActive });
	};

	// Delete schedule with optimistic update; the confirmation stays open until the
	// deletion settles and shows a failure inline (the row is restored on failure).
	const handleConfirmDelete = () =>
		void deletion.confirm(
			async (schedule) => {
				await changeSchedule.mutateAsync({ scheduleId: schedule.id, kind: "delete" });
			},
			(failure) =>
				describeFailure(
					failure,
					t("settings.scheduledExports.error.deleteFailed", "Delete failed"),
				),
		);

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
				return t(
					"settings.scheduledExports.scheduleType.quarterly",
					"Quarterly",
				);
			case "cron":
				return (
					schedule.cronExpression ||
					t("settings.scheduledExports.scheduleType.custom", "Custom")
				);
			default:
				return t("settings.scheduledExports.scheduleType.unknown", "Unknown");
		}
	};

	// Format report type
	const getReportTypeLabel = (type: string): string => {
		switch (type) {
			case "payroll_export":
				return t(
					"settings.scheduledExports.reportType.payrollShort",
					"Payroll",
				);
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
				<IconLoader2
					className="size-8 animate-spin text-muted-foreground"
					aria-label={t("common.loading", "Loading")}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<ScheduledExportsHeader onCreate={handleOpenCreate} />

			<ScheduledExportsStatus
				error={error}
				isRetrying={isFetching}
				onCreate={handleOpenCreate}
				onRetry={() => void mutate()}
				schedules={schedules}
			/>

			{schedules && schedules.length > 0 && (
				<SchedulesCard
					formatDate={formatDate}
					getReportTypeLabel={getReportTypeLabel}
					getScheduleLabel={getScheduleLabel}
					onDelete={deletion.request}
					onEdit={handleOpenEdit}
					onHistory={setHistorySchedule}
					onChangeOwner={setOwnerSchedule}
					onRunNow={setRunNowSchedule}
					onToggle={handleToggle}
					schedules={schedules}
				/>
			)}

			<ScheduledExportsHelp />
			<ScheduledExportDialogs
				deleteSchedule={deletion.target}
				deleteOpen={deletion.open}
				isDeleting={deletion.isPending}
				deleteError={deletion.error}
				editInitialValues={editInitialValues}
				editScheduleId={editScheduleId}
				filterOptions={filterOptions}
				historySchedule={historySchedule}
				isCreateDialogOpen={isCreateDialogOpen}
				onDeleteOpenChange={deletion.onOpenChange}
				onCloseHistory={() => setHistorySchedule(null)}
				onCloseRunNow={() => setRunNowSchedule(null)}
				onConfirmDelete={handleConfirmDelete}
				onCreateOpenChange={(open) => {
					setIsCreateDialogOpen(open);
					if (!open) {
						setEditScheduleId(null);
						setEditInitialValues(null);
					}
				}}
				onSuccess={() => mutate()}
				organizationId={organizationId}
				payrollConfigs={payrollConfigs}
				runNowSchedule={runNowSchedule}
			/>
			{ownerSchedule && (
				<ChangeOwnerDialog
					open={Boolean(ownerSchedule)}
					onOpenChange={(open: boolean) => !open && setOwnerSchedule(null)}
					organizationId={organizationId}
					currentUserId={currentUserId}
					schedule={ownerSchedule}
					onSuccess={() => mutate()}
				/>
			)}
		</div>
	);
}

function ScheduledExportsHeader({ onCreate }: { onCreate: () => void }) {
	const { t } = useTranslate();

	return (
		<PageHeader
			title={t("settings.scheduledExports.title", "Scheduled Exports")}
			description={t(
				"settings.scheduledExports.description",
				"Configure recurring exports for payroll, data, and audit reports.",
			)}
			actions={
				<Button onClick={onCreate}>
					<IconPlus className="size-4 mr-2" aria-hidden="true" />
					{t("settings.scheduledExports.newSchedule", "New Schedule")}
				</Button>
			}
		/>
	);
}

function ScheduledExportsStatus({
	error,
	isRetrying,
	onCreate,
	onRetry,
	schedules,
}: {
	error: unknown;
	isRetrying: boolean;
	onCreate: () => void;
	onRetry: () => void;
	schedules: ScheduledExportSummary[] | undefined;
}) {
	const { t } = useTranslate();

	if (error) {
		return (
			<Card className="border-destructive">
				<CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
					<div
						className="flex min-w-0 items-center gap-2 text-destructive"
						role="alert"
					>
						<IconAlertCircle className="size-5 shrink-0" aria-hidden="true" />
						<p>
							{error instanceof Error
								? error.message
								: t(
										"settings.scheduledExports.error.loadFailed",
										"Failed to load scheduled exports",
									)}
						</p>
					</div>
					<Button
						variant="outline"
						onClick={onRetry}
						disabled={isRetrying}
					>
						{isRetrying ? (
							<IconLoader2
								className="size-4 mr-2 animate-spin"
								aria-hidden="true"
							/>
						) : (
							<IconRefresh className="size-4 mr-2" aria-hidden="true" />
						)}
						{t("settings.scheduledExports.error.retry", "Try again")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	if (schedules?.length !== 0) return null;

	return (
		<Card>
			<CardContent>
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconCalendar aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle role="heading" aria-level={2}>
							{t("settings.scheduledExports.empty.title", "No scheduled exports")}
						</EmptyTitle>
						<EmptyDescription>
							{t(
								"settings.scheduledExports.empty.description",
								"Create your first scheduled export to automate recurring reports.",
							)}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button onClick={onCreate}>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t(
								"settings.scheduledExports.empty.createButton",
								"Create Schedule",
							)}
						</Button>
					</EmptyContent>
				</Empty>
			</CardContent>
		</Card>
	);
}

interface SchedulesCardProps {
	formatDate: (date: Date | null) => string;
	getReportTypeLabel: (type: string) => string;
	getScheduleLabel: (schedule: ScheduledExportSummary) => string;
	onChangeOwner: (schedule: ScheduledExportSummary) => void;
	onDelete: (schedule: ScheduledExportSummary) => void;
	onEdit: (scheduleId: string) => void;
	onHistory: (schedule: ScheduledExportSummary) => void;
	onRunNow: (schedule: ScheduledExportSummary) => void;
	onToggle: (scheduleId: string, isActive: boolean) => void;
	schedules: ScheduledExportSummary[];
}

function SchedulesCard({
	formatDate,
	getReportTypeLabel,
	getScheduleLabel,
	onChangeOwner,
	onDelete,
	onEdit,
	onHistory,
	onRunNow,
	onToggle,
	schedules,
}: SchedulesCardProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{/* The table lists paused schedules too, so it is not titled "Active". */}
					{t("settings.scheduledExports.table.titleAll", "Schedules")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.scheduledExports.table.description",
						"Manage your recurring export schedules",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>
								{t("settings.scheduledExports.table.name", "Name")}
							</TableHead>
							<TableHead>
								{t("settings.scheduledExports.table.type", "Type")}
							</TableHead>
							<TableHead>
								{t("settings.scheduledExports.table.schedule", "Schedule")}
							</TableHead>
							<TableHead>
								{t("settings.scheduledExports.table.owner", "Owner")}
							</TableHead>
							<TableHead>
								{t("settings.scheduledExports.table.lastRun", "Last Run")}
							</TableHead>
							<TableHead>
								{t("settings.scheduledExports.table.nextRun", "Next Run")}
							</TableHead>
							<TableHead>
								{t("settings.scheduledExports.table.status", "Status")}
							</TableHead>
							<TableHead className="w-[80px]">
								<span className="sr-only">
									{t("settings.scheduledExports.table.actions", "Actions")}
								</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{schedules.map((schedule) => (
							<ScheduledExportRow
								formatDate={formatDate}
								getReportTypeLabel={getReportTypeLabel}
								getScheduleLabel={getScheduleLabel}
								key={schedule.id}
								onChangeOwner={onChangeOwner}
								onDelete={onDelete}
								onEdit={onEdit}
								onHistory={onHistory}
								onRunNow={onRunNow}
								onToggle={onToggle}
								schedule={schedule}
							/>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function ScheduledExportRow({
	formatDate,
	getReportTypeLabel,
	getScheduleLabel,
	onChangeOwner,
	onDelete,
	onEdit,
	onHistory,
	onRunNow,
	onToggle,
	schedule,
}: Omit<SchedulesCardProps, "schedules"> & {
	schedule: ScheduledExportSummary;
}) {
	const { t } = useTranslate();

	return (
		<TableRow>
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
					<IconClock
						className="size-4 text-muted-foreground"
						aria-hidden="true"
					/>
					{getScheduleLabel(schedule)}
				</div>
				<div className="text-xs text-muted-foreground">{schedule.timezone}</div>
			</TableCell>
			<TableCell>
				<div>
					{schedule.ownerName ??
						t("settings.scheduledExports.table.unknownOwner", "Unknown owner")}
				</div>
				{!schedule.ownerEligible && (
					<div className="flex items-center gap-1 text-xs text-warning">
						<IconAlertCircle className="size-3.5" aria-hidden="true" />
						{t(
							"settings.scheduledExports.table.ownerNotAdmin",
							"No longer an org admin",
						)}
					</div>
				)}
			</TableCell>
			<TableCell className="text-muted-foreground">
				{formatDate(schedule.lastExecutionAt)}
			</TableCell>
			<TableCell>
				{schedule.isActive ? (
					formatDate(schedule.nextExecutionAt)
				) : (
					<span className="text-muted-foreground">
						{t("settings.scheduledExports.table.paused", "Paused")}
					</span>
				)}
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-2">
					<Switch
						checked={schedule.isActive}
						onCheckedChange={(checked) => onToggle(schedule.id, checked)}
						aria-label={
							schedule.isActive
								? t(
										"settings.scheduledExports.table.deactivate",
										"Deactivate schedule",
									)
								: t(
										"settings.scheduledExports.table.activate",
										"Activate schedule",
									)
						}
					/>
					{schedule.isActive ? (
						<IconCircleCheck
							className="size-4 text-primary"
							aria-label={t("settings.scheduledExports.table.active", "Active")}
						/>
					) : (
						<IconAlertCircle
							className="size-4 text-muted-foreground"
							aria-label={t(
								"settings.scheduledExports.table.inactive",
								"Inactive",
							)}
						/>
					)}
				</div>
			</TableCell>
			<TableCell>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							aria-label={t(
								"settings.scheduledExports.table.openMenu",
								"Open actions menu",
							)}
						>
							<IconDots className="size-4" aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => onEdit(schedule.id)}>
							<IconPencil className="size-4 mr-2" aria-hidden="true" />
							{t("settings.scheduledExports.actions.edit", "Edit")}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onHistory(schedule)}>
							<IconHistory className="size-4 mr-2" aria-hidden="true" />
							{t(
								"settings.scheduledExports.actions.viewHistory",
								"View History",
							)}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onRunNow(schedule)}>
							<IconPlayerPlay className="size-4 mr-2" aria-hidden="true" />
							{t("settings.scheduledExports.actions.runNow", "Run Now")}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onChangeOwner(schedule)}>
							<IconUserCog className="size-4 mr-2" aria-hidden="true" />
							{t("settings.scheduledExports.actions.changeOwner", "Change Owner")}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="text-destructive"
							onClick={() => onDelete(schedule)}
						>
							<IconTrash className="size-4 mr-2" aria-hidden="true" />
							{t("settings.scheduledExports.actions.delete", "Delete")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</TableCell>
		</TableRow>
	);
}

function ScheduledExportsHelp() {
	const { t } = useTranslate();

	return (
		<Card>
			<CardContent className="pt-6">
				<div className="text-sm text-muted-foreground space-y-2">
					<p>
						<strong>
							{t(
								"settings.scheduledExports.help.scheduleTypes",
								"Schedule Types:",
							)}
						</strong>{" "}
						{t(
							"settings.scheduledExports.help.scheduleTypesDesc",
							"Daily, Weekly (Monday), Monthly (1st), Quarterly (Jan/Apr/Jul/Oct 1st), or custom cron expressions.",
						)}
					</p>
					<p>
						<strong>
							{t("settings.scheduledExports.help.delivery", "Delivery:")}
						</strong>{" "}
						{t(
							"settings.scheduledExports.help.deliveryDesc",
							"Exports are uploaded to S3 and email notifications with download links are sent to configured recipients.",
						)}
					</p>
					<p>
						<strong>
							{t("settings.scheduledExports.help.owner", "Owner:")}
						</strong>{" "}
						{t(
							"settings.scheduledExports.help.ownerDesc",
							"Each schedule runs on behalf of an org admin. If its owner stops being an org admin or leaves, the schedule pauses and every org admin is notified so one can take it over.",
						)}
					</p>
					<p>
						<strong>
							{t("settings.scheduledExports.help.dateRanges", "Date Ranges:")}
						</strong>{" "}
						{t(
							"settings.scheduledExports.help.dateRangesDesc",
							"Automatically calculated based on the schedule frequency (e.g., previous month for monthly exports).",
						)}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

interface ScheduledExportDialogsProps {
	deleteSchedule: ScheduledExportSummary | null;
	deleteOpen: boolean;
	isDeleting: boolean;
	deleteError: string | null;
	editInitialValues: Record<string, unknown> | null;
	editScheduleId: string | null;
	filterOptions: FilterOptions | null;
	historySchedule: ScheduledExportSummary | null;
	isCreateDialogOpen: boolean;
	onDeleteOpenChange: (open: boolean) => void;
	onCloseHistory: () => void;
	onCloseRunNow: () => void;
	onConfirmDelete: () => void;
	onCreateOpenChange: (open: boolean) => void;
	onSuccess: () => void;
	organizationId: string;
	payrollConfigs: PayrollConfigSummary[];
	runNowSchedule: ScheduledExportSummary | null;
}

function ScheduledExportDialogs({
	deleteSchedule,
	deleteOpen,
	isDeleting,
	deleteError,
	editInitialValues,
	editScheduleId,
	filterOptions,
	historySchedule,
	isCreateDialogOpen,
	onDeleteOpenChange,
	onCloseHistory,
	onCloseRunNow,
	onConfirmDelete,
	onCreateOpenChange,
	onSuccess,
	organizationId,
	payrollConfigs,
	runNowSchedule,
}: ScheduledExportDialogsProps) {
	const { t } = useTranslate();

	return (
		<>
			<ScheduledExportDialog
				open={isCreateDialogOpen}
				onOpenChange={onCreateOpenChange}
				editScheduleId={editScheduleId ?? undefined}
				initialValues={editInitialValues ?? undefined}
				payrollConfigs={payrollConfigs}
				filterOptions={filterOptions}
				onSuccess={onSuccess}
			/>
			{historySchedule && (
				<ExecutionHistoryDialog
					open={Boolean(historySchedule)}
					onOpenChange={(open: boolean) => !open && onCloseHistory()}
					organizationId={organizationId}
					scheduleId={historySchedule.id}
					scheduleName={historySchedule.name}
				/>
			)}
			{runNowSchedule && (
				<RunNowDialog
					open={Boolean(runNowSchedule)}
					onOpenChange={(open: boolean) => !open && onCloseRunNow()}
					scheduleId={runNowSchedule.id}
					scheduleName={runNowSchedule.name}
					dateRangeStrategy={runNowSchedule.dateRangeStrategy}
					onSuccess={onSuccess}
				/>
			)}
			<DeleteConfirmDialog
				open={deleteOpen}
				onOpenChange={onDeleteOpenChange}
				title={t("settings.scheduledExports.deleteDialog.title", "Delete Scheduled Export")}
				description={t(
					"settings.scheduledExports.deleteDialog.description",
					'Are you sure you want to delete "{name}"? This action cannot be undone.',
					{ name: deleteSchedule?.name ?? "" },
				)}
				confirmLabel={t("settings.scheduledExports.deleteDialog.confirm", "Delete")}
				isDeleting={isDeleting}
				error={deleteError}
				onConfirm={onConfirmDelete}
			/>
		</>
	);
}
