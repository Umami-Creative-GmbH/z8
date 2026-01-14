"use client";

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TimeCorrectionDialog } from "./time-correction-dialog";

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
}

interface Props {
	workPeriods: WorkPeriodData[];
	hasManager: boolean;
	employeeTimezone: string;
}

export function TimeEntriesTable({ workPeriods, hasManager, employeeTimezone }: Props) {
	const timezoneAbbr = getTimezoneAbbreviation(employeeTimezone);

	const columns: ColumnDef<WorkPeriodData>[] = [
		{
			accessorKey: "startTime",
			header: "Date",
			cell: ({ row }) => formatDateInZone(row.original.startTime, employeeTimezone),
		},
		{
			id: "clockIn",
			header: () => (
				<div className="flex items-baseline gap-1">
					<span>Clock In</span>
					<span className="text-xs text-muted-foreground">({timezoneAbbr})</span>
				</div>
			),
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<span>{formatTimeInZone(row.original.startTime, employeeTimezone)}</span>
					{row.original.clockIn?.isSuperseded && (
						<Badge variant="outline" className="w-fit text-xs">
							Corrected
						</Badge>
					)}
				</div>
			),
		},
		{
			id: "clockOut",
			header: () => (
				<div className="flex items-baseline gap-1">
					<span>Clock Out</span>
					<span className="text-xs text-muted-foreground">({timezoneAbbr})</span>
				</div>
			),
			cell: ({ row }) => {
				if (!row.original.endTime) {
					return <Badge variant="secondary">Active</Badge>;
				}
				return (
					<div className="flex flex-col gap-1">
						<span>{formatTimeInZone(row.original.endTime, employeeTimezone)}</span>
						{row.original.clockOut?.isSuperseded && (
							<Badge variant="outline" className="w-fit text-xs">
								Corrected
							</Badge>
						)}
					</div>
				);
			},
		},
		{
			accessorKey: "durationMinutes",
			header: "Duration",
			cell: ({ row }) => {
				if (!row.original.durationMinutes) return "-";
				const hasSurcharge = row.original.surchargeMinutes && row.original.surchargeMinutes > 0;
				if (hasSurcharge) {
					return (
						<div className="flex flex-col gap-0.5">
							<span className="tabular-nums">
								{formatDuration(row.original.totalCreditedMinutes ?? row.original.durationMinutes)}
							</span>
							<span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
								+{formatDuration(row.original.surchargeMinutes!)}
							</span>
						</div>
					);
				}
				return <span className="tabular-nums">{formatDuration(row.original.durationMinutes)}</span>;
			},
		},
		{
			id: "description",
			header: "Description",
			cell: ({ row }) => {
				// Show notes from clock-out entry (where descriptions are typically stored)
				const notes = row.original.clockOut?.notes;
				if (!notes) return <span className="text-muted-foreground">-</span>;
				return (
					<span className="max-w-[200px] truncate text-sm" title={notes}>
						{notes}
					</span>
				);
			},
		},
	];

	// Add actions column - show edit button based on:
	// - Same day entries: always show (no manager required)
	// - Past entries: only show if user has a manager
	columns.push({
		id: "actions",
		header: "",
		cell: ({ row }) => {
			const period = row.original;

			// Don't show edit for active (not clocked out) periods
			if (!period.endTime) {
				return null;
			}

			const isSameDay = isSameDayInTimezone(period.startTime, employeeTimezone);

			// For same-day entries, always show edit button
			// For past entries, only show if user has a manager (for approval workflow)
			if (!isSameDay && !hasManager) {
				return null;
			}

			return (
				<div className="flex justify-end">
					<TimeCorrectionDialog
						workPeriod={period}
						isSameDay={isSameDay}
						employeeTimezone={employeeTimezone}
					/>
				</div>
			);
		},
	});

	const table = useReactTable({
		data: workPeriods,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Time Entries</CardTitle>
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
											<p>No time entries found for this week.</p>
											<p className="text-sm">Clock in to start tracking your time.</p>
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
