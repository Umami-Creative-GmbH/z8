"use client";

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatDuration, isSameDayInTimezone } from "@/lib/time-tracking/time-utils";
import {
	formatDateInZone,
	formatTimeInZone,
	getTimezoneAbbreviation,
} from "@/lib/time-tracking/timezone-utils";

// Dynamic import for TimeCorrectionDialog (bundle-dynamic-imports)
// Only loaded when user interacts with the edit action, reducing initial bundle size
const TimeCorrectionDialog = dynamic(
	() => import("./time-correction-dialog").then((mod) => mod.TimeCorrectionDialog),
	{ ssr: false },
);

// Preload function to call on hover for better perceived performance (bundle-preload)
const preloadTimeCorrectionDialog = () => {
	void import("./time-correction-dialog");
};

interface TimeEntry {
	id: string;
	isSuperseded: boolean | null;
	notes: string | null;
}

interface WorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	clockIn: TimeEntry;
	clockOut: TimeEntry | undefined;
	// Surcharge fields (optional - only present when surcharges are enabled)
	surchargeMinutes?: number | null;
	totalCreditedMinutes?: number | null;
	// Auto-adjustment fields (optional - only present when breaks were auto-enforced)
	wasAutoAdjusted?: boolean;
	autoAdjustmentReason?: WorkPeriodAutoAdjustmentReason | null;
}

interface Props {
	workPeriods: WorkPeriodData[];
	hasManager: boolean;
	employeeTimezone: string;
}

export function TimeEntriesTable({ workPeriods, hasManager, employeeTimezone }: Props) {
	const { t } = useTranslate();
	const timezoneAbbr = getTimezoneAbbreviation(employeeTimezone);

	const columns = useMemo<ColumnDef<WorkPeriodData>[]>(
		() => [
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
						<span className="text-xs text-muted-foreground">({timezoneAbbr})</span>
					</div>
				),
				cell: ({ row }) => (
					<div className="flex flex-col gap-1">
						<span>{formatTimeInZone(row.original.startTime, employeeTimezone)}</span>
						{row.original.clockIn?.isSuperseded && (
							<Badge variant="outline" className="w-fit text-xs">
								{t("timeTracking.table.corrected", "Corrected")}
							</Badge>
						)}
					</div>
				),
			},
			{
				id: "clockOut",
				header: () => (
					<div className="flex items-baseline gap-1">
						<span>{t("timeTracking.table.clockOut", "Clock Out")}</span>
						<span className="text-xs text-muted-foreground">({timezoneAbbr})</span>
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
							<span>{formatTimeInZone(row.original.endTime, employeeTimezone)}</span>
							{row.original.clockOut?.isSuperseded && (
								<Badge variant="outline" className="w-fit text-xs">
									{t("timeTracking.table.corrected", "Corrected")}
								</Badge>
							)}
						</div>
					);
				},
			},
			{
				accessorKey: "durationMinutes",
				header: t("timeTracking.table.duration", "Duration"),
				cell: ({ row }) => {
					if (!row.original.durationMinutes) return "-";
					const hasSurcharge =
						row.original.surchargeMinutes && row.original.surchargeMinutes > 0;
					const wasAutoAdjusted = row.original.wasAutoAdjusted;
					const adjustmentReason = row.original.autoAdjustmentReason;

					const durationDisplay = (
						<span className="tabular-nums">
							{formatDuration(
								hasSurcharge
									? (row.original.totalCreditedMinutes ?? row.original.durationMinutes)
									: row.original.durationMinutes,
							)}
						</span>
					);

					const autoAdjustmentIndicator = wasAutoAdjusted && adjustmentReason && (
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
										{adjustmentReason.originalDurationMinutes && (
											<p className="text-xs text-muted-foreground">
												{t("timeTracking.autoAdjusted.originalDuration", "Original: {duration}", {
													duration: formatDuration(adjustmentReason.originalDurationMinutes),
												})}
											</p>
										)}
									</div>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					);

					if (hasSurcharge) {
						return (
							<div className="flex flex-col gap-0.5">
								<div className="flex items-center gap-1">
									{durationDisplay}
									{autoAdjustmentIndicator}
								</div>
								<span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
									+{formatDuration(row.original.surchargeMinutes!)}
								</span>
							</div>
						);
					}

					return (
						<div className="flex items-center gap-1">
							{durationDisplay}
							{autoAdjustmentIndicator}
						</div>
					);
				},
			},
			{
				id: "description",
				header: t("timeTracking.table.description", "Description"),
				cell: ({ row }) => {
					const notes = row.original.clockOut?.notes;
					if (!notes) return <span className="text-muted-foreground">-</span>;
					return (
						<span className="block max-w-[200px] truncate text-sm" title={notes}>
							{notes}
						</span>
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

					return (
						<div
							className="flex justify-end"
							onMouseEnter={preloadTimeCorrectionDialog}
							onFocus={preloadTimeCorrectionDialog}
						>
							<TimeCorrectionDialog
								workPeriod={period}
								isSameDay={isSameDay}
								employeeTimezone={employeeTimezone}
							/>
						</div>
					);
				},
			},
		],
		[t, timezoneAbbr, employeeTimezone, hasManager],
	);

	const table = useReactTable({
		data: workPeriods,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("timeTracking.table.title", "Time Entries")}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<TableHead key={header.id}>
											{header.isPlaceholder
												? null
												: flexRender(header.column.columnDef.header, header.getContext())}
										</TableHead>
									))}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{table.getRowModel().rows?.length ? (
								table.getRowModel().rows.map((row) => (
									<TableRow key={row.id}>
										{row.getVisibleCells().map((cell) => (
											<TableCell key={cell.id}>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</TableCell>
										))}
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={columns.length} className="h-24 text-center">
										<div className="flex flex-col items-center gap-2 text-muted-foreground">
											<p>
												{t(
													"timeTracking.table.emptyState",
													"No time entries found for this week.",
												)}
											</p>
											<p className="text-sm">
												{t(
													"timeTracking.table.emptyStateHint",
													"Clock in to start tracking your time.",
												)}
											</p>
										</div>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}
