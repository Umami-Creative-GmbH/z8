"use client";

import { IconCircleCheck, IconCircleX, IconClock } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	DataTable,
	DataTablePagination,
	DataTableToolbar,
} from "@/components/data-table-server";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { Badge } from "@/components/ui/badge";
import { formatDateRange, formatDays } from "@/lib/absences/date-utils";
import {
	getSickDetailLabel,
	getSickDetailLabelKey,
} from "@/lib/absences/sick-details";
import type { AbsenceWithDays, DayPeriod } from "@/lib/absences/types";
import type { SickNoteMarker as SickNoteMarkerData } from "@/lib/personnel-file/sick-note-store";
import { CategoryBadge } from "./category-badge";
import { DeputyName } from "./deputy-name";
import { OwnAbsenceEntryActions, useOwnAbsenceActions } from "./own-absence-actions";
import { SickNoteMarker } from "./sick-notes/sick-note-marker";

type TranslateFn = ReturnType<typeof useTranslate>["t"];

/** Needs `OwnAbsenceActionsProvider`, which owns the row actions and their dialogs (#1863). */
interface AbsenceEntriesTableProps {
	absences: AbsenceWithDays[];
	currentDate: string;
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
function getStatusLabel(
	status: "pending" | "approved" | "rejected",
	t: TranslateFn,
): string {
	switch (status) {
		case "pending":
			return t("absences.status.pending", "Pending");
		case "approved":
			return t("absences.status.approved", "Approved");
		case "rejected":
			return t("absences.status.rejected", "Rejected");
	}
}

export function AbsenceEntriesTable({
	absences,
	currentDate,
}: AbsenceEntriesTableProps) {
	const { t } = useTranslate();
	const [search, setSearch] = useState("");
	const actions = useOwnAbsenceActions();

	// Filter absences by search
	const filteredAbsences = (() => {
		if (!search) return absences;
		const searchLower = search.toLocaleLowerCase();
		// Match the status as the person reads it, in their language.
		return absences.filter(
			(absence) =>
				absence.category.name.toLocaleLowerCase().includes(searchLower) ||
				absence.notes?.toLocaleLowerCase().includes(searchLower) ||
				getStatusLabel(absence.status, t)
					.toLocaleLowerCase()
					.includes(searchLower),
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
					sickNoteMarker={actions.sickNoteMarkers[row.original.id]}
					onOpenSickNotes={() => actions.openSickNotes(row.original)}
				/>
			),
		},
		{
			accessorKey: "days",
			header: () => (
				<div className="text-right">
					{t("absences.table.headers.days", "Days")}
				</div>
			),
			cell: ({ row }) => {
				return (
					<div className="text-right tabular-nums">
						{formatDays(row.original.absenceDays, t)}
					</div>
				);
			},
		},
		{
			accessorKey: "status",
			header: t("absences.table.headers.status", "Status"),
			cell: ({ row }) => (
				<div className="flex flex-col items-start gap-1">
					<AbsenceStatusBadge status={row.original.status} />
					{actions.hasPendingChange(row.original.id) ? (
						// Explains why the row's change actions are unavailable.
						<span className="text-muted-foreground text-xs">
							{t("absences.table.changePending", "Change request pending")}
						</span>
					) : null}
				</div>
			),
		},
		{
			accessorKey: "notes",
			header: t("absences.table.headers.notes", "Notes"),
			cell: ({ row }) => (
				<span
					className="block max-w-[200px] truncate text-muted-foreground"
					title={row.original.notes || undefined}
				>
					{row.original.notes || "—"}
				</span>
			),
		},
		{
			id: "actions",
			header: () => (
				<div className="text-right">
					{t("absences.table.headers.actions", "Actions")}
				</div>
			),
			cell: ({ row }) => (
				<OwnAbsenceEntryActions
					absence={row.original}
					currentDate={currentDate}
				/>
			),
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
				getRowId={(absence) => absence.id}
				className="bg-card"
				mobileLayout="stacked"
				pinLastColumn
				emptyMessage={
					search
						? t(
								"absences.table.noSearchResults",
								"No absences match your search.",
							)
						: t("absences.table.noRequests", "No absence requests found.")
				}
			>
				{(table) => <DataTablePagination table={table} />}
			</DataTable>
		</div>
	);
}

const STATUS_BADGE = {
	approved: {
		icon: IconCircleCheck,
		className: "border-primary/30 bg-primary/10 text-primary",
	},
	pending: {
		icon: IconClock,
		className:
			"border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
	},
	rejected: {
		icon: IconCircleX,
		className: "border-destructive/30 bg-destructive/10 text-destructive",
	},
} as const;

/** Status as text with an icon; colour supports it and matches the calendar legend. */
function AbsenceStatusBadge({ status }: { status: AbsenceWithDays["status"] }) {
	const { t } = useTranslate();
	const { icon: Icon, className } = STATUS_BADGE[status];
	return (
		<Badge variant="outline" className={className}>
			<Icon aria-hidden="true" />
			{getStatusLabel(status, t)}
		</Badge>
	);
}

function AbsenceDateRangeCell({ absence }: { absence: AbsenceWithDays }) {
	const { t } = useTranslate();
	const dateRangeText = formatDateRange(absence.startDate, absence.endDate);
	const showPeriods =
		absence.startPeriod !== "full_day" || absence.endPeriod !== "full_day";
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
					{t(
						getSickDetailLabelKey(absence.sickDetail),
						getSickDetailLabel(absence.sickDetail),
					)}
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
					<span className="text-muted-foreground">
						{t("absences.deputy.label", "Deputy")}
					</span>{" "}
					<DeputyName deputy={absence.deputy} className="font-medium" />
				</span>
			) : null}
		</div>
	);
}
