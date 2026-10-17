"use client";

import { IconCheck, IconX } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import type { ApprovalWithAbsence } from "@/app/[locale]/(app)/approvals/actions";
import { CategoryBadge } from "@/components/absences/category-badge";
import {
	SICK_NOTE_MARKER_LINK_CLASS,
	SickNoteMarker,
	SickNoteMarkerLabel,
} from "@/components/absences/sick-notes/sick-note-marker";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { formatDateRange } from "@/lib/absences/date-utils";
import { getSickDetailLabel, getSickDetailLabelKey } from "@/lib/absences/sick-details";
import { personnelFilePath } from "@/lib/personnel-file/paths";
import { Link } from "@/navigation";

type Translate = ReturnType<typeof useTranslate>["t"];

// Format days display (handle half days)
export function formatAbsenceDays(days: number): string {
	if (days === 1) return "1 day";
	if (days === 0.5) return "0.5 day";
	if (Number.isInteger(days)) return `${days} days`;
	return `${days} days`;
}

function RequesterCell({ requester }: { requester: ApprovalWithAbsence["requester"] }) {
	return (
		<div className="flex items-center gap-3">
			<UserAvatar
				image={requester.user.image}
				seed={requester.user.id}
				name={requester.user.name}
				size="sm"
				clockStatus="unknown"
			/>
			<div>
				<div className="font-medium">{requester.user.name}</div>
				<div className="text-xs text-muted-foreground">{requester.user.email}</div>
			</div>
		</div>
	);
}

type Absence = ApprovalWithAbsence["absence"];

function SickNotesIndicator({ absence }: { absence: Absence }) {
	if (!absence.sickNotes) {
		return null;
	}

	if (absence.sickNotes.viewable) {
		// Only for an approver who may open them through personnel file access (#982).
		return (
			<Link
				href={personnelFilePath(absence.employeeId, { category: "sick_note" })}
				className={SICK_NOTE_MARKER_LINK_CLASS}
			>
				<SickNoteMarkerLabel count={absence.sickNotes.count} />
			</Link>
		);
	}

	return <SickNoteMarker count={absence.sickNotes.count} />;
}

function DeputyNote({ deputy }: { deputy: NonNullable<Absence["deputy"]> }) {
	const { t } = useTranslate();

	// Who covers, so the approver can reject when the cover does not work (#1011).
	return (
		<span className="text-xs">
			<span className="text-muted-foreground">
				{t("approvals:approvals.deputy.label", "Deputy")}
			</span>{" "}
			<span className="font-medium">{deputy.name}</span>
			{!deputy.canDecideApprovals && (
				<span className="block text-amber-600 dark:text-amber-400">
					{t("approvals:approvals.deputy.contactOnly", "Contact only: cannot decide approvals")}
				</span>
			)}
		</span>
	);
}

function AbsenceTypeCell({ absence }: { absence: Absence }) {
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
			<SickNotesIndicator absence={absence} />
			{absence.deputy && <DeputyNote deputy={absence.deputy} />}
		</div>
	);
}

interface ApprovalActionsCellProps {
	approval: ApprovalWithAbsence;
	disabled: boolean;
	onApprove: (approval: ApprovalWithAbsence) => void;
	onReject: (approval: ApprovalWithAbsence) => void;
}

function ApprovalActionsCell({
	approval,
	disabled,
	onApprove,
	onReject,
}: ApprovalActionsCellProps) {
	const { t } = useTranslate();

	return (
		<div className="flex justify-end gap-2">
			<Button variant="outline" size="sm" onClick={() => onApprove(approval)} disabled={disabled}>
				<IconCheck className="mr-1 size-4" />
				{t("approvals:approvals.approve", "Approve")}
			</Button>
			<Button variant="outline" size="sm" onClick={() => onReject(approval)} disabled={disabled}>
				<IconX className="mr-1 size-4" />
				{t("approvals:approvals.reject", "Reject")}
			</Button>
		</div>
	);
}

interface AbsenceApprovalColumnsInput {
	t: Translate;
	actionsDisabled: boolean;
	onApprove: (approval: ApprovalWithAbsence) => void;
	onReject: (approval: ApprovalWithAbsence) => void;
}

export function buildAbsenceApprovalColumns({
	t,
	actionsDisabled,
	onApprove,
	onReject,
}: AbsenceApprovalColumnsInput): ColumnDef<DataTableFeatures, ApprovalWithAbsence>[] {
	return [
		{
			accessorKey: "requester",
			header: t("approvals:approvals.employee", "Employee"),
			cell: ({ row }) => <RequesterCell requester={row.original.requester} />,
		},
		{
			accessorKey: "dates",
			header: t("approvals:approvals.dates", "Dates"),
			cell: ({ row }) => (
				<span className="font-medium">
					{formatDateRange(row.original.absence.startDate, row.original.absence.endDate)}
				</span>
			),
		},
		{
			accessorKey: "type",
			header: t("approvals:approvals.type", "Type"),
			cell: ({ row }) => <AbsenceTypeCell absence={row.original.absence} />,
		},
		{
			accessorKey: "days",
			header: () => <div className="text-right">{t("approvals:approvals.days", "Days")}</div>,
			cell: ({ row }) => {
				return (
					<div className="text-right tabular-nums">
						{formatAbsenceDays(row.original.absence.absenceDays)}
					</div>
				);
			},
		},
		{
			accessorKey: "notes",
			header: t("approvals:approvals.notes", "Notes"),
			cell: ({ row }) => (
				<span className="max-w-[200px] truncate text-muted-foreground block">
					{row.original.absence.notes || "—"}
				</span>
			),
		},
		{
			id: "actions",
			cell: ({ row }) => (
				<ApprovalActionsCell
					approval={row.original}
					disabled={actionsDisabled}
					onApprove={onApprove}
					onReject={onReject}
				/>
			),
		},
	];
}
