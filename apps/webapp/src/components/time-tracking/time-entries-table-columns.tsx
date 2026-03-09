import { IconInfoCircle } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { TFnType } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";
import { formatDuration, isSameDayInTimezone } from "@/lib/time-tracking/time-utils";
import {
	formatDateInZone,
	formatTimeInZone,
	getTimezoneAbbreviation,
} from "@/lib/time-tracking/timezone-utils";

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
	clockIn: TimeEntry;
	clockOut: TimeEntry | undefined;
	surchargeMinutes?: number | null;
	totalCreditedMinutes?: number | null;
	wasAutoAdjusted?: boolean;
	autoAdjustmentReason?: WorkPeriodAutoAdjustmentReason | null;
}

function DurationCell({ row, t }: { row: WorkPeriodData; t: TFnType }) {
	if (!row.durationMinutes) {
		return "-";
	}

	const hasSurcharge = !!row.surchargeMinutes && row.surchargeMinutes > 0;
	const duration = hasSurcharge
		? (row.totalCreditedMinutes ?? row.durationMinutes)
		: row.durationMinutes;
	const adjustmentReason = row.autoAdjustmentReason;

	const autoAdjustmentIndicator =
		row.wasAutoAdjusted && adjustmentReason ? (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex cursor-help">
							<IconInfoCircle
								className="h-4 w-4 text-amber-500"
								aria-label={t(
									"timeTracking.autoAdjusted.indicator",
									"Auto-adjusted for compliance",
								)}
							/>
						</span>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs">
						<div className="space-y-1">
							<p className="font-medium">
								{t("timeTracking.autoAdjusted.title", "Auto-adjusted for compliance")}
							</p>
							<p className="text-sm">
								{t(
									"timeTracking.autoAdjusted.description",
									"A {breakMinutes}-minute break was automatically added to comply with {regulationName}.",
									{
										breakMinutes: adjustmentReason.breakInsertedMinutes,
										regulationName: adjustmentReason.regulationName,
									},
								)}
							</p>
							{adjustmentReason.originalDurationMinutes ? (
								<p className="text-xs text-muted-foreground">
									{t("timeTracking.autoAdjusted.originalDuration", "Original: {duration}", {
										duration: formatDuration(adjustmentReason.originalDurationMinutes),
									})}
								</p>
							) : null}
						</div>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		) : null;

	if (hasSurcharge) {
		return (
			<div className="flex flex-col gap-0.5">
				<div className="flex items-center gap-1">
					<span className="tabular-nums">{formatDuration(duration)}</span>
					{autoAdjustmentIndicator}
				</div>
				<span className="tabular-nums text-xs text-emerald-600 dark:text-emerald-400">
					+{formatDuration(row.surchargeMinutes!)}
				</span>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1">
			<span className="tabular-nums">{formatDuration(duration)}</span>
			{autoAdjustmentIndicator}
		</div>
	);
}

export function getTimeEntriesColumns({
	t,
	employeeTimezone,
	hasManager,
	renderEditAction,
}: {
	t: TFnType;
	employeeTimezone: string;
	hasManager: boolean;
	renderEditAction: (period: WorkPeriodData, isSameDay: boolean) => ReactNode;
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
					<span>{formatTimeInZone(row.original.startTime, employeeTimezone)}</span>
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
						<span>{formatTimeInZone(row.original.endTime, employeeTimezone)}</span>
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
				if (!isSameDay && !hasManager) {
					return null;
				}

				return <div className="flex justify-end">{renderEditAction(period, isSameDay)}</div>;
			},
		},
	];
}
