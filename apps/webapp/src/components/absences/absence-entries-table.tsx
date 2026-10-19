"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import { DataTable, DataTableToolbar } from "@/components/data-table-server";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AbsenceChangeKind } from "@/lib/absences/change-request-types";
import { formatDateRange, formatDays } from "@/lib/absences/date-utils";
import { getSickDetailLabel, getSickDetailLabelKey } from "@/lib/absences/sick-details";
import type { AbsenceWithDays, DayPeriod } from "@/lib/absences/types";
import type { SickNoteMarker as SickNoteMarkerData } from "@/lib/personnel-file/sick-note-store";
import { useInvalidatePeriodSubmissionReadiness } from "@/lib/query/period-submission-readiness";
import { useRouter } from "@/navigation";
import { AbsenceChangeDialog } from "./absence-change-dialog";
import { AbsenceChangeHistory } from "./absence-change-history";
import { AbsenceEntryActions } from "./absence-entry-actions";
import { CategoryBadge } from "./category-badge";
import { ChangeDeputyDialog } from "./change-deputy-dialog";
import { DeputyName } from "./deputy-name";
import { AbsenceSickNotesPanel } from "./sick-notes/absence-sick-notes-panel";
import { AttachSickNoteDialog } from "./sick-notes/attach-sick-note-dialog";
import { SickNoteMarker } from "./sick-notes/sick-note-marker";
import { useOwnAbsenceSickNotes } from "./sick-notes/use-own-absence-sick-notes";
import { useOwnAbsenceChanges } from "./use-own-absence-changes";

type TranslateFn = ReturnType<typeof useTranslate>["t"];

interface AbsenceEntriesTableProps {
	absences: AbsenceWithDays[];
	currentDate: string;
	onUpdate?: () => void;
}

/** Sick notes go on the employee's own sick leave unless it was rejected (#982). */
function takesSickNotes(absence: AbsenceWithDays): boolean {
	return absence.category.type === "sick" && absence.status !== "rejected";
}

// Format period for display
function formatPeriod(period: DayPeriod, t: TranslateFn): string {
	switch (period) {
		case "am":
			return ` (${t("absences.period.am", "AM")})`;
		case "pm":
			return ` (${t("absences.period.pm", "PM")})`;
		default:
			return "";
	}
}

// Translate status for display
function getStatusLabel(status: "pending" | "approved" | "rejected", t: TranslateFn): string {
	switch (status) {
		case "pending":
			return t("absences.status.pending", "Pending");
		case "approved":
			return t("absences.status.approved", "Approved");
		case "rejected":
			return t("absences.status.rejected", "Rejected");
	}
}

export function AbsenceEntriesTable({ absences, currentDate, onUpdate }: AbsenceEntriesTableProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	// Pending absence requests keep their submission periods open (#1350).
	const invalidateReadiness = useInvalidatePeriodSubmissionReadiness();
	const [cancelingId, setCancelingId] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const sickNotes = useOwnAbsenceSickNotes(absences);
	const [sickNotesOf, setSickNotesOf] = useState<AbsenceWithDays | null>(null);
	const [attachingTo, setAttachingTo] = useState<AbsenceWithDays | null>(null);
	const [changingDeputyOf, setChangingDeputyOf] = useState<AbsenceWithDays | null>(null);
	const [changeOf, setChangeOf] = useState<{
		absence: AbsenceWithDays;
		kind: AbsenceChangeKind;
	} | null>(null);
	const changes = useOwnAbsenceChanges();
	const changed = () => {
		void changes.refetch();
		refresh();
		void invalidateReadiness();
		onUpdate?.();
	};

	// Attaching can turn "without certificate" into "with certificate".
	const handleSickNotesChanged = () => {
		void sickNotes.refresh();
		refresh();
		onUpdate?.();
	};

	const handleCancel = async (absenceId: string) => {
		setCancelingId(absenceId);

		const result = await cancelAbsenceRequest(absenceId);

		setCancelingId(null);

		if (result.success) {
			toast.success(t("absences.toast.requestCancelled", "Absence cancelled"));
			// Revalidate the page data to reflect the cancelled absence
			refresh();
			void invalidateReadiness();
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
			cell: ({ row }) => <AbsenceDateRangeCell absence={row.original} />,
		},
		{
			accessorKey: "type",
			header: t("absences.table.headers.type", "Type"),
			cell: ({ row }) => (
				<AbsenceTypeCell
					absence={row.original}
					sickNoteMarker={sickNotes.markers[row.original.id]}
					onOpenSickNotes={() => setSickNotesOf(row.original)}
				/>
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
					{getStatusLabel(row.original.status, t)}
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
			cell: ({ row }) => (
				<AbsenceEntryActions
					absence={row.original}
					currentDate={currentDate}
					canAttachSickNote={sickNotes.canAttach && takesSickNotes(row.original)}
					changeRequests={changes.data}
					changesLoaded={changes.isSuccess}
					isCanceling={cancelingId === row.original.id}
					onRequestChange={(kind) => setChangeOf({ absence: row.original, kind })}
					onChangeDeputy={() => setChangingDeputyOf(row.original)}
					onAttachSickNote={() => setAttachingTo(row.original)}
					onCancel={() => handleCancel(row.original.id)}
				/>
			),
		},
	];

	return (
		<div className="space-y-4">
			{changes.isError ? (
				<p role="alert" className="text-sm text-destructive">
					{t("absences.change.historyFailed", "Could not load change requests.")}{" "}
					<Button variant="link" onClick={() => void changes.refetch()}>
						{t("common.retry", "Retry")}
					</Button>
				</p>
			) : null}
			{changes.data?.length ? (
				<AbsenceChangeHistory requests={changes.data} onChanged={changed} />
			) : null}
			{changeOf ? (
				<AbsenceChangeDialog
					absence={changeOf.absence}
					kind={changeOf.kind}
					open
					onOpenChange={(open) => {
						if (!open) setChangeOf(null);
					}}
					onChanged={changed}
				/>
			) : null}
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

function AbsenceDateRangeCell({ absence }: { absence: AbsenceWithDays }) {
	const { t } = useTranslate();
	const dateRangeText = formatDateRange(absence.startDate, absence.endDate);
	const showPeriods = absence.startPeriod !== "full_day" || absence.endPeriod !== "full_day";
	const startPeriod = formatPeriod(absence.startPeriod, t);
	const endPeriod = formatPeriod(absence.endPeriod, t);

	return (
		<div className="flex flex-col">
			<span className="font-medium">{dateRangeText}</span>
			{showPeriods && (
				<span className="text-xs text-muted-foreground">
					{startPeriod && (
						<>
							{t("absences.table.start", "Start")}
							{startPeriod}
						</>
					)}
					{startPeriod && endPeriod && <> &middot; </>}
					{endPeriod && (
						<>
							{t("absences.table.end", "End")}
							{endPeriod}
						</>
					)}
				</span>
			)}
		</div>
	);
}

function AbsenceTypeCell({
	absence,
	sickNoteMarker,
	onOpenSickNotes,
}: {
	absence: AbsenceWithDays;
	sickNoteMarker: SickNoteMarkerData | undefined;
	onOpenSickNotes: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-col items-start gap-1">
			<CategoryBadge
				name={absence.category.name}
				type={absence.category.type}
				color={absence.category.color}
			/>
			{absence.category.type === "sick" && absence.sickDetail && (
				<span className="text-muted-foreground text-xs">
					{t(getSickDetailLabelKey(absence.sickDetail), getSickDetailLabel(absence.sickDetail))}
				</span>
			)}
			{absence.category.type === "sick" ? (
				<SickNoteMarker
					count={sickNoteMarker?.count ?? 0}
					onOpen={sickNoteMarker?.viewable ? onOpenSickNotes : undefined}
				/>
			) : null}
			{absence.deputy ? (
				<span className="text-xs">
					<span className="text-muted-foreground">{t("absences.deputy.label", "Deputy")}</span>{" "}
					<DeputyName deputy={absence.deputy} className="font-medium" />
				</span>
			) : null}
		</div>
	);
}
