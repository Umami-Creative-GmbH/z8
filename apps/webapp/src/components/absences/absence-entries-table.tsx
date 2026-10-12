"use client";

import { IconPaperclip, IconUserShare, IconX } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import { DataTable, DataTableToolbar } from "@/components/data-table-server";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateRange, formatDays } from "@/lib/absences/date-utils";
import { getSickDetailLabel, getSickDetailLabelKey } from "@/lib/absences/sick-details";
import type { AbsenceWithCategory, AbsenceWithDays, DayPeriod } from "@/lib/absences/types";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { useRouter } from "@/navigation";
import { CategoryBadge } from "./category-badge";
import { ChangeDeputyDialog } from "./change-deputy-dialog";
import { DeputyName } from "./deputy-name";
import { AbsenceSickNotesPanel } from "./sick-notes/absence-sick-notes-panel";
import { AttachSickNoteDialog } from "./sick-notes/attach-sick-note-dialog";
import { SickNoteMarker } from "./sick-notes/sick-note-marker";
import { useOwnAbsenceSickNotes } from "./sick-notes/use-own-absence-sick-notes";

interface AbsenceEntriesTableProps {
	absences: AbsenceWithDays[];
	currentDate: string;
	onUpdate?: () => void;
}

function canShowCancelAction(absence: AbsenceWithDays, today: string): boolean {
	if (absence.status === "pending") return true;
	if (absence.status === "approved") return absence.startDate > today;
	return false;
}

/** The deputy can change on pending and approved absences until they have ended (#1011). */
function canChangeDeputy(absence: AbsenceWithCategory, today: string): boolean {
	return (
		(absence.status === "pending" || absence.status === "approved") &&
		comparePlainDates(parsePlainDate(absence.endDate), parsePlainDate(today)) >= 0
	);
}

/** Sick notes go on the employee's own sick leave unless it was rejected (#982). */
function takesSickNotes(absence: AbsenceWithDays): boolean {
	return absence.category.type === "sick" && absence.status !== "rejected";
}

export function AbsenceEntriesTable({ absences, currentDate, onUpdate }: AbsenceEntriesTableProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [cancelingId, setCancelingId] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const sickNotes = useOwnAbsenceSickNotes(absences);
	const [sickNotesOf, setSickNotesOf] = useState<AbsenceWithDays | null>(null);
	const [attachingTo, setAttachingTo] = useState<AbsenceWithDays | null>(null);
	const [changingDeputyOf, setChangingDeputyOf] = useState<AbsenceWithDays | null>(null);

	// Attaching can turn "without certificate" into "with certificate".
	const handleSickNotesChanged = () => {
		void sickNotes.refresh();
		refresh();
		onUpdate?.();
	};

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
			toast.success(t("absences.toast.requestCancelled", "Absence cancelled"));
			// Revalidate the page data to reflect the cancelled absence
			refresh();
			onUpdate?.();
		} else {
			toast.error(
				result.error || t("absences.toast.cancelFailed", "Failed to cancel absence request"),
			);
		}
	};

	// Filter absences by search
	const filteredAbsences = (() => {
		if (!search) return absences;
		const searchLower = search.toLowerCase();
		return absences.filter(
			(absence) =>
				absence.category.name.toLowerCase().includes(searchLower) ||
				absence.notes?.toLowerCase().includes(searchLower) ||
				absence.status.toLowerCase().includes(searchLower),
		);
	})();

	// Column definitions
	const columns: ColumnDef<DataTableFeatures, AbsenceWithDays>[] = [
		{
			accessorKey: "dateRange",
			header: t("absences.table.headers.dateRange", "Date Range"),
			cell: ({ row }) => {
				const absence = row.original;
				const dateRangeText = formatDateRange(absence.startDate, absence.endDate);
				const showPeriods = absence.startPeriod !== "full_day" || absence.endPeriod !== "full_day";

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
				<div className="flex flex-col items-start gap-1">
					<CategoryBadge
						name={row.original.category.name}
						type={row.original.category.type}
						color={row.original.category.color}
					/>
					{row.original.category.type === "sick" && row.original.sickDetail && (
						<span className="text-muted-foreground text-xs">
							{t(
								getSickDetailLabelKey(row.original.sickDetail),
								getSickDetailLabel(row.original.sickDetail),
							)}
						</span>
					)}
					{row.original.category.type === "sick" ? (
						<SickNoteMarker
							count={sickNotes.markers[row.original.id]?.count ?? 0}
							onOpen={
								sickNotes.markers[row.original.id]?.viewable
									? () => setSickNotesOf(row.original)
									: undefined
							}
						/>
					) : null}
					{row.original.deputy ? (
						<span className="text-xs">
							<span className="text-muted-foreground">{t("absences.deputy.label", "Deputy")}</span>{" "}
							<DeputyName deputy={row.original.deputy} className="font-medium" />
						</span>
					) : null}
				</div>
			),
		},
		{
			accessorKey: "days",
			header: () => <div className="text-right">{t("absences.table.headers.days", "Days")}</div>,
			cell: ({ row }) => {
				return (
					<div className="text-right tabular-nums">{formatDays(row.original.absenceDays, t)}</div>
				);
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
				const canAttachSickNote = sickNotes.canAttach && takesSickNotes(absence);
				const canCancel = canShowCancelAction(absence, currentDate);
				const canChange = canChangeDeputy(absence, currentDate);
				if (!canCancel && !canAttachSickNote && !canChange) return null;
				const cancelLabel = t("absences.table.cancelAbsence", "Cancel absence");
				const cancelTooltip = t("absences.table.cancelAbsenceTooltip", "Cancel absence");
				const attachLabel = t("absences.sickNotes.attachAction", "Attach sick note");
				const changeDeputyLabel = t("absences.deputy.changeAction", "Change deputy");

				return (
					<div className="flex justify-end gap-1">
						{canChange ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setChangingDeputyOf(absence)}
								aria-label={changeDeputyLabel}
							>
								<IconUserShare aria-hidden="true" className="size-4" />
								<span className="sm:sr-only">{changeDeputyLabel}</span>
							</Button>
						) : null}
						{canAttachSickNote ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setAttachingTo(absence)}
								aria-label={attachLabel}
							>
								<IconPaperclip aria-hidden="true" className="size-4" />
								<span className="sm:sr-only">{attachLabel}</span>
							</Button>
						) : null}
						{canCancel ? (
							<Tooltip>
								<AlertDialog>
									<TooltipTrigger asChild>
										<AlertDialogTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												disabled={cancelingId === absence.id}
												aria-label={cancelLabel}
											>
												<IconX className="size-4" />
												{/* Touch screens cannot show the tooltip (#846). */}
												<span className="sm:sr-only">{cancelLabel}</span>
											</Button>
										</AlertDialogTrigger>
									</TooltipTrigger>
									<TooltipContent>{cancelTooltip}</TooltipContent>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>
												{t("absences.dialog.cancelTitle", "Cancel Absence")}
											</AlertDialogTitle>
											<AlertDialogDescription>
												{t(
													"absences.dialog.cancelDescription",
													"Are you sure you want to cancel this absence? This action cannot be undone.",
												)}
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
											<AlertDialogAction
												onClick={() => handleCancel(absence.id)}
												className="bg-destructive text-white hover:bg-destructive/90"
											>
												{t("absences.dialog.confirmCancel", "Yes, cancel absence")}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</Tooltip>
						) : null}
					</div>
				);
			},
		},
	];

	return (
		<div className="space-y-4">
			<DataTableToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder={t(
					"absences.table.searchPlaceholder",
					"Search by type, status, or notes…",
				)}
			/>

			<DataTable
				columns={columns}
				data={filteredAbsences}
				className="bg-card"
				pinLastColumn
				emptyMessage={
					search
						? t("absences.table.noSearchResults", "No absences match your search.")
						: t("absences.table.noRequests", "No absence requests found.")
				}
			/>
			{sickNotesOf ? (
				<AbsenceSickNotesPanel
					absence={sickNotesOf}
					open
					onOpenChange={(open) => {
						if (!open) setSickNotesOf(null);
					}}
					canAttach={sickNotes.canAttach && takesSickNotes(sickNotesOf)}
					onChanged={handleSickNotesChanged}
				/>
			) : null}
			{changingDeputyOf ? (
				<ChangeDeputyDialog
					absence={changingDeputyOf}
					open
					onOpenChange={(open) => {
						if (!open) setChangingDeputyOf(null);
					}}
					onChanged={() => {
						refresh();
						onUpdate?.();
					}}
				/>
			) : null}
			{attachingTo ? (
				<AttachSickNoteDialog
					absence={attachingTo}
					open
					onOpenChange={(open) => {
						if (!open) setAttachingTo(null);
					}}
					onAttached={handleSickNotesChanged}
				/>
			) : null}
		</div>
	);
}
