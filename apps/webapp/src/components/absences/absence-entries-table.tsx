"use client";

import { IconX } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import { DataTable, DataTableToolbar } from "@/components/data-table-server";
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
	const [search, setSearch] = useState("");

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

	// Filter absences by search
	const filteredAbsences = useMemo(() => {
		if (!search) return absences;
		const searchLower = search.toLowerCase();
		return absences.filter(
			(absence) =>
				absence.category.name.toLowerCase().includes(searchLower) ||
				absence.notes?.toLowerCase().includes(searchLower) ||
				absence.status.toLowerCase().includes(searchLower),
		);
	}, [absences, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<AbsenceWithCategory>[]>(
		() => [
			{
				accessorKey: "dateRange",
				header: t("absences.table.headers.dateRange", "Date Range"),
				cell: ({ row }) => {
					const absence = row.original;
					const dateRangeText = formatDateRange(absence.startDate, absence.endDate);
					const showPeriods =
						absence.startPeriod !== "full_day" || absence.endPeriod !== "full_day";

					return (
						<div className="flex flex-col">
							<span className="font-medium">{dateRangeText}</span>
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
					);
				},
			},
			{
				accessorKey: "type",
				header: t("absences.table.headers.type", "Type"),
				cell: ({ row }) => (
					<CategoryBadge
						name={row.original.category.name}
						type={row.original.category.type}
						color={row.original.category.color}
					/>
				),
			},
			{
				accessorKey: "days",
				header: () => <div className="text-right">{t("absences.table.headers.days", "Days")}</div>,
				cell: ({ row }) => {
					const days = calculateBusinessDaysWithHalfDays(
						row.original.startDate,
						row.original.startPeriod,
						row.original.endDate,
						row.original.endPeriod,
						[],
					);
					return <div className="text-right tabular-nums">{formatDays(days, t)}</div>;
				},
			},
			{
				accessorKey: "status",
				header: t("absences.table.headers.status", "Status"),
				cell: ({ row }) => (
					<Badge
						variant={
							row.original.status === "approved"
								? "default"
								: row.original.status === "pending"
									? "secondary"
									: "destructive"
						}
					>
						{getStatusLabel(row.original.status)}
					</Badge>
				),
			},
			{
				accessorKey: "notes",
				header: t("absences.table.headers.notes", "Notes"),
				cell: ({ row }) => (
					<span className="max-w-[200px] truncate text-muted-foreground block">
						{row.original.notes || "—"}
					</span>
				),
			},
			{
				id: "actions",
				header: () => (
					<div className="text-right">{t("absences.table.headers.actions", "Actions")}</div>
				),
				cell: ({ row }) => {
					const absence = row.original;
					if (absence.status !== "pending") return null;

					return (
						<div className="flex justify-end">
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
										<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => handleCancel(absence.id)}
											className="bg-destructive text-white hover:bg-destructive/90"
										>
											{t("absences.dialog.confirmCancel", "Yes, cancel request")}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					);
				},
			},
		],
		[t, cancelingId],
	);

	return (
		<div className="space-y-4">
			<DataTableToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder={t(
					"absences.table.searchPlaceholder",
					"Search by type, status, or notes...",
				)}
			/>

			<DataTable
				columns={columns}
				data={filteredAbsences}
				emptyMessage={
					search
						? t("absences.table.noSearchResults", "No absences match your search.")
						: t("absences.table.noRequests", "No absence requests found.")
				}
			/>
		</div>
	);
}
