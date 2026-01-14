"use client";

import { IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
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
import { calculateBusinessDaysWithHalfDays, formatDateRange } from "@/lib/absences/date-utils";
import type { AbsenceWithCategory, DayPeriod } from "@/lib/absences/types";
import { CategoryBadge } from "./category-badge";

interface AbsenceEntriesTableProps {
	absences: AbsenceWithCategory[];
	onUpdate?: () => void;
}

export function AbsenceEntriesTable({ absences, onUpdate }: AbsenceEntriesTableProps) {
	const { t } = useTranslate();
	const [cancelingId, setCancelingId] = useState<string | null>(null);

	// Format period for display
	const formatPeriod = (period: DayPeriod): string => {
		switch (period) {
			case "am":
				return ` (${t("absences.period.am", "AM")})`;
			case "pm":
				return ` (${t("absences.period.pm", "PM")})`;
			default:
				return "";
		}
	};

	// Format days display (handle half days)
	const formatDays = (days: number): string => {
		if (days === 1) return t("common.days.one", "1 day");
		if (days === 0.5) return t("common.days.half", "0.5 day");
		if (Number.isInteger(days)) return t("common.days.count", "{count} days", { count: days });
		return t("common.days.count", "{count} days", { count: days });
	};

	const handleCancel = async (absenceId: string) => {
		setCancelingId(absenceId);

		const result = await cancelAbsenceRequest(absenceId);

		setCancelingId(null);

		if (result.success) {
			toast.success(t("absences.toast.requestCancelled", "Absence request cancelled"));
			onUpdate?.();
		} else {
			toast.error(
				result.error || t("absences.toast.cancelFailed", "Failed to cancel absence request"),
			);
		}
	};

	if (absences.length === 0) {
		return (
			<div className="rounded-md border">
				<div className="p-8 text-center text-muted-foreground">
					{t("absences.table.noRequests", "No absence requests found.")}
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t("absences.table.headers.dateRange", "Date Range")}</TableHead>
						<TableHead>{t("absences.table.headers.type", "Type")}</TableHead>
						<TableHead className="text-right">{t("absences.table.headers.days", "Days")}</TableHead>
						<TableHead>{t("absences.table.headers.status", "Status")}</TableHead>
						<TableHead>{t("absences.table.headers.notes", "Notes")}</TableHead>
						<TableHead className="text-right">
							{t("absences.table.headers.actions", "Actions")}
						</TableHead>
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
													<>
														{t("absences.table.start", "Start")}
														{formatPeriod(absence.startPeriod)}
													</>
												)}
												{formatPeriod(absence.startPeriod) && formatPeriod(absence.endPeriod) && (
													<> &middot; </>
												)}
												{formatPeriod(absence.endPeriod) && (
													<>
														{t("absences.table.end", "End")}
														{formatPeriod(absence.endPeriod)}
													</>
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
