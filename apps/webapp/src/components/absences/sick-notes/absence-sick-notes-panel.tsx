"use client";

import { IconLink, IconPaperclip, IconTrash, IconUnlink } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { listAbsenceSickNotesAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import type { EmployeeDocumentView } from "@/app/[locale]/(app)/personnel-files/actions";
import { unlinkSickNoteAction } from "@/app/[locale]/(app)/personnel-files/sick-note-actions";
import { DeleteDocumentDialog } from "@/components/personnel-file/delete-document-dialog";
import { DocumentList } from "@/components/personnel-file/document-list";
import { LinkExistingSickNoteDialog } from "@/components/personnel-file/sick-note-links";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import { queryKeys } from "@/lib/query/keys";
import { AttachSickNoteDialog, type SickNoteAbsenceTarget } from "./attach-sick-note-dialog";

/**
 * The sick notes of one absence (#982) for a viewer who may open them: the
 * employee themselves, or whoever manages the employee's sick notes. The
 * server lists only what personnel file access lets them see. The employee
 * may attach more and delete their own uploads within 24 hours. With
 * `manage`, whoever manages the employee's sick notes attaches HR-only or
 * shared notes, links notes already in the personnel file and unlinks them
 * (#984).
 */
export function AbsenceSickNotesPanel({
	absence,
	open,
	onOpenChange,
	canAttach,
	manage = false,
	onChanged,
}: {
	absence: SickNoteAbsenceTarget;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	canAttach: boolean;
	/** The viewer manages the employee's sick notes (officer area, #984). */
	manage?: boolean;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const queryClient = useQueryClient();
	const [attaching, setAttaching] = useState(false);
	const [deleting, setDeleting] = useState<EmployeeDocumentView | null>(null);
	const [linking, setLinking] = useState(false);
	const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

	const query = useQuery({
		queryKey: queryKeys.personnelFile.absenceSickNotes(absence.id),
		queryFn: async () => {
			const result = await listAbsenceSickNotesAction(absence.id);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open,
	});

	function refresh() {
		void queryClient.invalidateQueries({
			queryKey: manage ? queryKeys.personnelFile.all : queryKeys.personnelFile.sickNotesAll(),
		});
		onChanged();
	}

	async function unlink(document: EmployeeDocumentView) {
		setUnlinkingId(document.id);
		try {
			const result = await unlinkSickNoteAction({ documentId: document.id });
			if (!result.success) {
				toast.error(
					result.error ||
						t("absences.sickNotes.panel.unlinkFailed", "The sick note could not be unlinked."),
				);
				return;
			}
			toast.success(t("absences.sickNotes.panel.unlinked", "Sick note unlinked"));
			refresh();
		} finally {
			setUnlinkingId(null);
		}
	}

	const dateRange = formatAbsenceDateRange(absence.startDate, absence.endDate, locale);

	return (
		<>
			<ActionPanel open={open} onOpenChange={onOpenChange}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>{t("absences.sickNotes.panel.title", "Sick notes")}</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"absences.sickNotes.panel.description",
								"Sick notes for the absence {dateRange}.",
								{
									dateRange,
								},
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						{query.isPending ? (
							<div className="space-y-2" aria-busy="true">
								<Skeleton className="h-16 w-full" />
							</div>
						) : query.isError ? (
							<p role="alert" className="text-sm text-destructive">
								{t("absences.sickNotes.panel.loadFailed", "The sick notes could not be loaded.")}
							</p>
						) : query.data.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t("absences.sickNotes.panel.empty", "No sick notes you can open.")}
							</p>
						) : (
							<DocumentList
								documents={query.data}
								showVisibility={manage}
								actions={(document) => (
									<>
										{manage ? (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												disabled={unlinkingId === document.id}
												onClick={() => void unlink(document)}
												aria-label={t("absences.sickNotes.panel.unlink", "Unlink {title}", {
													title: document.title,
												})}
											>
												<IconUnlink aria-hidden="true" className="size-4" />
											</Button>
										) : null}
										{query.data.find((note) => note.id === document.id)?.canDelete ? (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												onClick={() => setDeleting(document)}
												aria-label={t("absences.sickNotes.panel.delete", "Delete {title}", {
													title: document.title,
												})}
											>
												<IconTrash aria-hidden="true" className="size-4 text-destructive" />
											</Button>
										) : null}
									</>
								)}
							/>
						)}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.close", "Close")}
						</Button>
						{manage ? (
							<Button type="button" variant="outline" onClick={() => setLinking(true)}>
								<IconLink aria-hidden="true" className="size-4" />
								{t("absences.sickNotes.panel.linkExisting", "Link sick note")}
							</Button>
						) : null}
						{canAttach || manage ? (
							<Button type="button" onClick={() => setAttaching(true)}>
								<IconPaperclip aria-hidden="true" className="size-4" />
								{t("absences.sickNotes.attachAction", "Attach sick note")}
							</Button>
						) : null}
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>
			{canAttach || manage ? (
				<AttachSickNoteDialog
					absence={absence}
					authority={manage ? "officer" : "employee"}
					open={attaching}
					onOpenChange={setAttaching}
					onAttached={refresh}
				/>
			) : null}
			{manage ? (
				<LinkExistingSickNoteDialog
					absence={absence}
					open={linking}
					onOpenChange={setLinking}
					onLinked={refresh}
				/>
			) : null}
			<DeleteDocumentDialog
				document={deleting}
				onOpenChange={(next) => {
					if (!next) setDeleting(null);
				}}
				onDeleted={refresh}
			/>
		</>
	);
}
