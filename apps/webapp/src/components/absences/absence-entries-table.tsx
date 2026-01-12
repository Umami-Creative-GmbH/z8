"use client";

import { IconX } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	calculateBusinessDaysWithHalfDays,
	formatDateRange,
} from "@/lib/absences/date-utils";
import type { AbsenceWithCategory, DayPeriod } from "@/lib/absences/types";
import { CategoryBadge } from "./category-badge";

interface AbsenceEntriesTableProps {
	absences: AbsenceWithCategory[];
	onUpdate?: () => void;
}

// Format period for display
function formatPeriod(period: DayPeriod): string {
	switch (period) {
		case "am":
			return " (AM)";
		case "pm":
			return " (PM)";
		default:
			return "";
	}
}

// Format days display (handle half days)
function formatDays(days: number): string {
	if (days === 1) return "1 day";
	if (days === 0.5) return "0.5 day";
	if (Number.isInteger(days)) return `${days} days`;
	return `${days} days`;
}

export function AbsenceEntriesTable({ absences, onUpdate }: AbsenceEntriesTableProps) {
	const [cancelingId, setCancelingId] = useState<string | null>(null);

	const handleCancel = async (absenceId: string) => {
		setCancelingId(absenceId);

		const result = await cancelAbsenceRequest(absenceId);

		setCancelingId(null);

		if (result.success) {
			toast.success("Absence request cancelled");
			onUpdate?.();
		} else {
			toast.error(result.error || "Failed to cancel absence request");
		}
	};

	if (absences.length === 0) {
		return (
			<div className="rounded-md border">
				<div className="p-8 text-center text-muted-foreground">No absence requests found.</div>
			</div>
		);
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Date Range</TableHead>
						<TableHead>Type</TableHead>
						<TableHead className="text-right">Days</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Notes</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{absences.map((absence) => {
						const days = calculateBusinessDaysWithHalfDays(
							absence.startDate,
							absence.startPeriod,
							absence.endDate,
							absence.endPeriod,
							[],
						);

						// Build date range display with periods
						const dateRangeText = formatDateRange(absence.startDate, absence.endDate);
						const showPeriods =
							absence.startPeriod !== "full_day" || absence.endPeriod !== "full_day";

						return (
							<TableRow key={absence.id}>
								<TableCell className="font-medium">
									<div className="flex flex-col">
										<span>{dateRangeText}</span>
										{showPeriods && (
											<span className="text-xs text-muted-foreground">
												{formatPeriod(absence.startPeriod) && (
													<>Start{formatPeriod(absence.startPeriod)}</>
												)}
												{formatPeriod(absence.startPeriod) && formatPeriod(absence.endPeriod) && (
													<> &middot; </>
												)}
												{formatPeriod(absence.endPeriod) && (
													<>End{formatPeriod(absence.endPeriod)}</>
												)}
											</span>
										)}
									</div>
								</TableCell>
								<TableCell>
									<CategoryBadge
										name={absence.category.name}
										type={absence.category.type}
										color={absence.category.color}
									/>
								</TableCell>
								<TableCell className="text-right tabular-nums">{formatDays(days)}</TableCell>
								<TableCell>
									<Badge
										variant={
											absence.status === "approved"
												? "default"
												: absence.status === "pending"
													? "secondary"
													: "destructive"
										}
									>
										{absence.status}
									</Badge>
								</TableCell>
								<TableCell className="max-w-[200px] truncate text-muted-foreground">
									{absence.notes || "—"}
								</TableCell>
								<TableCell className="text-right">
									{absence.status === "pending" && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleCancel(absence.id)}
											disabled={cancelingId === absence.id}
										>
											<IconX className="size-4" />
										</Button>
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
