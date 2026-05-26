import type { ColumnDef } from "@tanstack/react-table";
import type { TFnType } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";
import { isSameDayInTimezone } from "@/lib/time-tracking/time-utils";
import {
	formatDateInZone,
	formatTimeInZone,
	getTimezoneAbbreviation,
} from "@/lib/time-tracking/timezone-utils";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { DurationCell } from "./time-entries-table-duration-cell";

interface TimeEntry {
	id: string;
	isSuperseded: boolean | null;
	notes: string | null;
}

export interface WorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: "pending" | "approved" | "rejected";
	clockIn: TimeEntry;
	clockOut: TimeEntry | undefined;
	surchargeMinutes?: number | null;
	totalCreditedMinutes?: number | null;
	wasAutoAdjusted?: boolean;
	autoAdjustmentReason?: WorkPeriodAutoAdjustmentReason | null;
}

export function getTimeEntriesColumns({
	t,
	employeeTimezone,
	timeFormat,
	hasManager,
	renderEditAction,
	renderAdminAction,
}: {
	t: TFnType;
	employeeTimezone: string;
	timeFormat: TimeFormat;
	hasManager: boolean;
	renderEditAction: (period: WorkPeriodData, isSameDay: boolean) => ReactNode;
	renderAdminAction?: (period: WorkPeriodData) => ReactNode;
}): ColumnDef<WorkPeriodData>[] {
	const timezoneAbbreviation = getTimezoneAbbreviation(employeeTimezone);

	return [
		{
			accessorKey: "startTime",
			header: t("timeTracking.table.date", "Date"),
			cell: ({ row }) => formatDateInZone(row.original.startTime, employeeTimezone),
		},
		{
			id: "clockIn",
			header: () => (
				<div className="flex items-baseline gap-1">
					<span>{t("timeTracking.table.clockIn", "Clock In")}</span>
					<span className="text-xs text-muted-foreground">({timezoneAbbreviation})</span>
				</div>
			),
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<span>
						{formatTimeInZone(row.original.startTime, employeeTimezone, false, timeFormat)}
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
				<div className="flex items-baseline gap-1">
					<span>{t("timeTracking.table.clockOut", "Clock Out")}</span>
					<span className="text-xs text-muted-foreground">({timezoneAbbreviation})</span>
				</div>
			),
			cell: ({ row }) => {
				if (!row.original.endTime) {
					return <Badge variant="secondary">{t("timeTracking.table.active", "Active")}</Badge>;
				}

				return (
					<div className="flex flex-col gap-1">
						<span>
							{formatTimeInZone(row.original.endTime, employeeTimezone, false, timeFormat)}
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
				return notes ? (
					<span className="block max-w-[200px] truncate text-sm" title={notes}>
						{notes}
					</span>
				) : (
					<span className="text-muted-foreground">-</span>
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

				const isSameDay = isSameDayInTimezone(period.startTime, employeeTimezone);
				const editAction = isSameDay || hasManager ? renderEditAction(period, isSameDay) : null;
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
