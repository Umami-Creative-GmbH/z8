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
import { formatDate, formatDuration, formatTime } from "@/lib/time-tracking/time-utils";
import type { WorkPeriodWithEntries } from "@/lib/time-tracking/types";
import { TimeCorrectionDialog } from "./time-correction-dialog";

interface Props {
	workPeriods: WorkPeriodWithEntries[];
	hasManager: boolean;
}

export function TimeEntriesTable({ workPeriods, hasManager }: Props) {
	const columns: ColumnDef<WorkPeriodWithEntries>[] = [
		{
			accessorKey: "startTime",
			header: "Date",
			cell: ({ row }) => formatDate(row.original.startTime),
		},
		{
			id: "clockIn",
			header: "Clock In",
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<span>{formatTime(row.original.startTime)}</span>
					{row.original.clockInEntry.isSuperseded && (
						<Badge variant="outline" className="w-fit text-xs">
							Corrected
						</Badge>
					)}
				</div>
			),
		},
		{
			id: "clockOut",
			header: "Clock Out",
			cell: ({ row }) => {
				if (!row.original.endTime) {
					return <Badge variant="secondary">Active</Badge>;
				}
				return (
					<div className="flex flex-col gap-1">
						<span>{formatTime(row.original.endTime)}</span>
						{row.original.clockOutEntry?.isSuperseded && (
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
				return <span className="tabular-nums">{formatDuration(row.original.durationMinutes)}</span>;
			},
		},
	];

	// Add actions column if user has a manager
	if (hasManager) {
		columns.push({
			id: "actions",
			header: "",
			cell: ({ row }) => (
				<div className="flex justify-end">
					<TimeCorrectionDialog workPeriod={row.original} />
				</div>
			),
		});
	}

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
