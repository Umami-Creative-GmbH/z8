"use client";

import { useTranslate } from "@tolgee/react";
import { createContext, type ReactNode, use, useState } from "react";
import { toast } from "sonner";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import type { AbsenceChangeKind } from "@/lib/absences/change-request-types";
import type { AbsenceWithDays } from "@/lib/absences/types";
import type { SickNoteMarker } from "@/lib/personnel-file/sick-note-store";
import { useInvalidatePeriodSubmissionReadiness } from "@/lib/query/period-submission-readiness";
import { useRouter } from "@/navigation";
import { AbsenceChangeDialog } from "./absence-change-dialog";
import { AbsenceEntryActions } from "./absence-entry-actions";
import { ChangeDeputyDialog } from "./change-deputy-dialog";
import { AbsenceSickNotesPanel } from "./sick-notes/absence-sick-notes-panel";
import { AttachSickNoteDialog } from "./sick-notes/attach-sick-note-dialog";
import { useOwnAbsenceSickNotes } from "./sick-notes/use-own-absence-sick-notes";
import { hasPendingChangeRequest } from "./has-pending-change-request";
import { useOwnAbsenceChanges } from "./use-own-absence-changes";

interface OwnAbsenceActionsValue {
	/** The employee's own absence change requests. */
	changes: ReturnType<typeof useOwnAbsenceChanges>;
	/** Reloads everything an absence change request can affect. */
	changed: () => void;
	sickNoteMarkers: Readonly<Record<string, SickNoteMarker>>;
	hasPendingChange: (absenceId: string) => boolean;
	openSickNotes: (absence: AbsenceWithDays) => void;
	canAttachSickNote: (absence: AbsenceWithDays) => boolean;
	cancelingId: string | null;
	requestChange: (absence: AbsenceWithDays, kind: AbsenceChangeKind) => void;
	changeDeputy: (absence: AbsenceWithDays) => void;
	attachSickNote: (absence: AbsenceWithDays) => void;
	cancel: (absenceId: string) => Promise<void>;
}

const OwnAbsenceActionsContext = createContext<OwnAbsenceActionsValue | null>(null);

/** Sick notes go on the employee's own sick leave unless it was rejected (#982). */
function takesSickNotes(absence: AbsenceWithDays): boolean {
	return absence.category.type === "sick" && absence.status !== "rejected";
}

/**
 * The actions on the employee's own absences, shared by the calendar and the table (#1863):
 * their data, the dialogs they open and the cancel flow. Eligibility stays in
 * `AbsenceEntryActions`.
 */
export function OwnAbsenceActionsProvider({
	absences,
	onUpdate,
	children,
}: {
	absences: AbsenceWithDays[];
	/** Called after an action changed absence data, so the views can reload. */
	onUpdate?: () => void;
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	// Pending absence requests keep their submission periods open (#1350).
	const invalidateReadiness = useInvalidatePeriodSubmissionReadiness();
	const [cancelingId, setCancelingId] = useState<string | null>(null);
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

	const cancel = async (absenceId: string) => {
		setCancelingId(absenceId);
		const result = await cancelAbsenceRequest(absenceId);
		setCancelingId(null);
		if (result.success) {
			toast.success(t("absences.toast.requestCancelled", "Absence cancelled"));
			refresh();
			void invalidateReadiness();
			onUpdate?.();
		} else {
			toast.error(
				result.error || t("absences.toast.cancelFailed", "Failed to cancel absence request"),
			);
		}
	};

	const value: OwnAbsenceActionsValue = {
		changes,
		changed,
		sickNoteMarkers: sickNotes.markers,
		hasPendingChange: (absenceId) => hasPendingChangeRequest(changes.data, absenceId),
		openSickNotes: setSickNotesOf,
		canAttachSickNote: (absence) => sickNotes.canAttach && takesSickNotes(absence),
		cancelingId,
		requestChange: (absence, kind) => setChangeOf({ absence, kind }),
		changeDeputy: setChangingDeputyOf,
		attachSickNote: setAttachingTo,
		cancel,
	};

	return (
		<OwnAbsenceActionsContext value={value}>
			{children}
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
		</OwnAbsenceActionsContext>
	);
}

export function useOwnAbsenceActions(): OwnAbsenceActionsValue {
	const value = use(OwnAbsenceActionsContext);
	if (!value) {
		throw new Error("useOwnAbsenceActions must be used inside OwnAbsenceActionsProvider");
	}
	return value;
}

/**
 * `AbsenceEntryActions` wired to the shared controller. `onAction` runs before an action starts,
 * so a surrounding popover can close first.
 */
export function OwnAbsenceEntryActions({
	absence,
	currentDate,
	onAction,
}: {
	absence: AbsenceWithDays;
	currentDate: string;
	onAction?: () => void;
}) {
	const actions = useOwnAbsenceActions();
	return (
		<AbsenceEntryActions
			absence={absence}
			currentDate={currentDate}
			canAttachSickNote={actions.canAttachSickNote(absence)}
			changeRequests={actions.changes.data}
			changesLoaded={actions.changes.isSuccess}
			isCanceling={actions.cancelingId === absence.id}
			onRequestChange={(kind) => {
				onAction?.();
				actions.requestChange(absence, kind);
			}}
			onChangeDeputy={() => {
				onAction?.();
				actions.changeDeputy(absence);
			}}
			onAttachSickNote={() => {
				onAction?.();
				actions.attachSickNote(absence);
			}}
			onCancel={() => {
				onAction?.();
				void actions.cancel(absence.id);
			}}
		/>
	);
}
