"use client";

import { IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
	formatDays,
} from "@/lib/absences/date-utils";
import type { AbsenceWithCategory, DayPeriod } from "@/lib/absences/types";
import { CategoryBadge } from "./category-badge";

interface AbsenceEntriesTableProps {
	absences: AbsenceWithCategory[];
	onUpdate?: () => void;
}

export function AbsenceEntriesTable({ absences, onUpdate }: AbsenceEntriesTableProps) {
	const { t } = useTranslate();
	const router = useRouter();
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

	// Translate status for display
	const getStatusLabel = (status: "pending" | "approved" | "rejected"): string => {
		switch (status) {
			case "pending":
				return t("absences.status.pending", "Pending");
			case "approved":
				return t("absences.status.approved", "Approved");
			case "rejected":
				return t("absences.status.rejected", "Rejected");
		}
	};

	const handleCancel = async (absenceId: string) => {
		setCancelingId(absenceId);

		const result = await cancelAbsenceRequest(absenceId);

		setCancelingId(null);

		if (result.success) {
			toast.success(t("absences.toast.requestCancelled", "Absence request cancelled"));
			// Revalidate the page data to reflect the cancelled absence
			router.refresh();
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
								<TableCell className="text-right tabular-nums">{formatDays(days, t)}</TableCell>
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
										{getStatusLabel(absence.status)}
									</Badge>
								</TableCell>
								<TableCell className="max-w-[200px] truncate text-muted-foreground">
									{absence.notes || "—"}
								</TableCell>
								<TableCell className="text-right">
									{absence.status === "pending" && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													variant="ghost"
													size="sm"
													disabled={cancelingId === absence.id}
													aria-label={t("absences.table.cancelRequest", "Cancel request")}
												>
													<IconX className="size-4" />
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														{t("absences.dialog.cancelTitle", "Cancel Absence Request")}
													</AlertDialogTitle>
													<AlertDialogDescription>
														{t(
															"absences.dialog.cancelDescription",
															"Are you sure you want to cancel this absence request? This action cannot be undone.",
														)}
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>
														{t("common.cancel", "Cancel")}
													</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => handleCancel(absence.id)}
														className="bg-destructive text-white hover:bg-destructive/90"
													>
														{t("absences.dialog.confirmCancel", "Yes, cancel request")}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
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
