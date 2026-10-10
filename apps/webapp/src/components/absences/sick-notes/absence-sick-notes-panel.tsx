"use client";

import { IconPaperclip, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { listAbsenceSickNotesAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import type { EmployeeDocumentView } from "@/app/[locale]/(app)/personnel-files/actions";
import { DeleteDocumentDialog } from "@/components/personnel-file/delete-document-dialog";
import { DocumentList } from "@/components/personnel-file/document-list";
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
 * may attach more and delete their own uploads within 24 hours.
 */
export function AbsenceSickNotesPanel({
	absence,
	open,
	onOpenChange,
	canAttach,
	onChanged,
}: {
	absence: SickNoteAbsenceTarget;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	canAttach: boolean;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const queryClient = useQueryClient();
	const [attaching, setAttaching] = useState(false);
	const [deleting, setDeleting] = useState<EmployeeDocumentView | null>(null);

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
		void queryClient.invalidateQueries({ queryKey: queryKeys.personnelFile.sickNotesAll() });
		onChanged();
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
								showVisibility={false}
								actions={(document) =>
									query.data.find((note) => note.id === document.id)?.canDelete ? (
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
									) : null
								}
							/>
						)}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.close", "Close")}
						</Button>
						{canAttach ? (
							<Button type="button" onClick={() => setAttaching(true)}>
								<IconPaperclip aria-hidden="true" className="size-4" />
								{t("absences.sickNotes.attachAction", "Attach sick note")}
							</Button>
						) : null}
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>
			{canAttach ? (
				<AttachSickNoteDialog
					absence={absence}
					open={attaching}
					onOpenChange={setAttaching}
					onAttached={refresh}
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
