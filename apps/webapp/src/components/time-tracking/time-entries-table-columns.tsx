import type { ColumnDef } from "@tanstack/react-table";
import type { TFnType } from "@tolgee/react";
import type { ReactNode } from "react";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { Badge } from "@/components/ui/badge";
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatCapturedOffsetInstant } from "@/lib/datetime/temporal-format";
import { isSameDayInTimezone } from "@/lib/time-tracking/time-utils";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { DurationCell } from "./time-entries-table-duration-cell";

interface TimeEntry {
	id: string;
	isSuperseded: boolean | null;
	notes: string | null;
	utcOffsetMinutes: number;
}

export interface WorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: "pending" | "approved" | "rejected";
	approvalRequestId: string | null;
	workLocationType: WorkLocationType | "field" | null;
	workCategoryId: string | null;
	clockIn: TimeEntry;
	clockOut: TimeEntry | undefined;
	surchargeMinutes?: number | null;
	totalCreditedMinutes?: number | null;
	wasAutoAdjusted?: boolean;
	autoAdjustmentReason?: WorkPeriodAutoAdjustmentReason | null;
	/** Billable Time (#900): whether the work is billable. */
	isBillable?: boolean;
	/**
	 * Missing task (#884): accepted without the task its project required. The
	 * stored `work_period` column, like `isBillable`; read models built from it
	 * (calendar, reports) carry `missingTask?: true` instead.
	 */
	missingTask?: boolean;
}

export function getTimeEntriesColumns({
	t,
	locale,
	employeeTimezone,
	timeFormat,
	hasManager,
	renderEditAction,
	renderAdminAction,
	showBillable = false,
	isDrivingDetailsMissing,
}: {
	t: TFnType;
	locale: string;
	employeeTimezone: string;
	timeFormat: TimeFormat;
	hasManager: boolean;
	renderEditAction: (period: WorkPeriodData, isSameDay: boolean) => ReactNode;
	renderAdminAction?: (period: WorkPeriodData) => ReactNode;
	/** Mark billable work (#900); only while Billable Time is on. */
	showBillable?: boolean;
	/** Whether a work period shows driving details missing (#1127). */
	isDrivingDetailsMissing?: (workPeriodId: string) => boolean;
}): ColumnDef<DataTableFeatures, WorkPeriodData>[] {
	return [
		{
			accessorKey: "startTime",
			header: t("timeTracking.table.date", "Date"),
			cell: ({ row }) =>
				formatCapturedOffsetInstant(instantFromDate(row.original.startTime), {
					locale,
					timeFormat,
					offsetMinutes: row.original.clockIn.utcOffsetMinutes,
					preset: "dateShort",
				}),
		},
		{
			id: "clockIn",
			header: () => (
				<div className="flex flex-col">
					<span>{t("timeTracking.table.clockIn", "Clock In")}</span>
					<span className="text-xs text-muted-foreground">
						{t("timeTracking.table.recordedLocalTime", "Recorded local time")}
					</span>
				</div>
			),
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<span>
						{formatCapturedOffsetInstant(
							instantFromDate(row.original.startTime),
							{
								locale,
								timeFormat,
								offsetMinutes: row.original.clockIn.utcOffsetMinutes,
								preset: "time",
							},
						)}
					</span>
					{row.original.clockIn?.isSuperseded ? (
						<Badge variant="outline" className="w-fit text-xs">
							{t("timeTracking.table.corrected", "Corrected")}
						</Badge>
					) : null}
				</div>
			),
		},
		{
			id: "clockOut",
			header: () => (
				<div className="flex flex-col">
					<span>{t("timeTracking.table.clockOut", "Clock Out")}</span>
					<span className="text-xs text-muted-foreground">
						{t("timeTracking.table.recordedLocalTime", "Recorded local time")}
					</span>
				</div>
			),
			cell: ({ row }) => {
				if (!row.original.endTime) {
					return (
						<Badge variant="secondary">
							{t("timeTracking.table.active", "Active")}
						</Badge>
					);
				}

				return (
					<div className="flex flex-col gap-1">
						<span>
							{formatCapturedOffsetInstant(
								instantFromDate(row.original.endTime),
								{
									locale,
									timeFormat,
									offsetMinutes: row.original.clockOut!.utcOffsetMinutes,
									preset: "time",
								},
							)}
						</span>
						{row.original.clockOut?.isSuperseded ? (
							<Badge variant="outline" className="w-fit text-xs">
								{t("timeTracking.table.corrected", "Corrected")}
							</Badge>
						) : null}
					</div>
				);
			},
		},
		{
			accessorKey: "durationMinutes",
			header: t("timeTracking.table.duration", "Duration"),
			cell: ({ row }) => <DurationCell row={row.original} t={t} />,
		},
		{
			id: "description",
			header: t("timeTracking.table.description", "Description"),
			cell: ({ row }) => {
				const notes = row.original.clockOut?.notes;
				const description = notes ? (
					<span className="block max-w-[200px] truncate text-sm" title={notes}>
						{notes}
					</span>
				) : (
					<span className="text-muted-foreground">-</span>
				);
				const billable = showBillable && row.original.isBillable;
				const drivingDetailsMissing = isDrivingDetailsMissing?.(row.original.id) ?? false;
				const missingTask = row.original.missingTask === true;
				if (!billable && !drivingDetailsMissing && !missingTask) return description;
				return (
					<div className="flex flex-col gap-1">
						{description}
						{billable ? (
							<Badge variant="outline" className="w-fit text-xs">
								{t("timeTracking.table.billable", "Billable")}
							</Badge>
						) : null}
						{drivingDetailsMissing ? (
							<Badge
								variant="outline"
								className="w-fit border-amber-500/50 text-amber-700 text-xs dark:text-amber-300"
							>
								{t("timeTracking.table.drivingDetailsMissing", "Driving details missing")}
							</Badge>
						) : null}
						{missingTask ? (
							<Badge
								variant="outline"
								className="w-fit border-amber-500/50 text-amber-700 text-xs dark:text-amber-300"
								title={t(
									"timeTracking.table.missingTaskHint",
									"This project requires a task: add one to this booking in the calendar.",
								)}
							>
								{t("timeTracking.table.missingTask", "Missing task")}
							</Badge>
						) : null}
					</div>
				);
			},
		},
		{
			id: "actions",
			header: "",
			cell: ({ row }) => {
				const period = row.original;
				if (!period.endTime) {
					return null;
				}

				const isSameDay = isSameDayInTimezone(
					period.startTime,
					employeeTimezone,
				);
				const editAction =
					isSameDay || hasManager ? renderEditAction(period, isSameDay) : null;
				const adminAction = renderAdminAction?.(period) ?? null;

				if (!editAction && !adminAction) {
					return null;
				}

				return (
					<div className="flex justify-end gap-1">
						{editAction}
						{adminAction}
					</div>
				);
			},
		},
	];
}
