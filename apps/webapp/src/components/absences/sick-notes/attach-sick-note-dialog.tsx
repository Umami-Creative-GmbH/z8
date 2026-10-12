"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { TFormItem, TFormMessage } from "@/components/ui/tanstack-form";
import { DEFAULT_VISIBILITY, type DocumentVisibility } from "@/lib/personnel-file/document.types";
import {
	resolveStagedSickNoteFiles,
	SickNoteFilesField,
	type StagedSickNoteFile,
	stagedSickNoteFilesComplete,
	useSickNoteDefaults,
} from "./sick-note-files-field";
import {
	StagedSickNoteUploadError,
	type UploadedSickNote,
	useStagedSickNoteUploads,
} from "./use-staged-sick-note-uploads";

export interface SickNoteAbsenceTarget {
	id: string;
	employeeId: string;
	/** YYYY-MM-DD */
	startDate: string;
	/** YYYY-MM-DD */
	endDate: string;
}

/**
 * Who attaches: the employee to their own absence (always shared), or whoever
 * manages the employee's sick notes (#984), HR-only unless they share it.
 */
export type SickNoteAttacher = "employee" | "officer";

async function attachSickNote(input: {
	uploaded: UploadedSickNote;
	absence: SickNoteAbsenceTarget;
	authority: SickNoteAttacher;
	visibility: DocumentVisibility;
}): Promise<void> {
	const { uploaded, absence } = input;
	const officer = input.authority === "officer";
	const response = await fetch("/api/upload/personnel-file", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			tusFileKey: uploaded.tusFileKey,
			fileName: uploaded.fileName,
			employeeId: absence.employeeId,
			...(officer ? {} : { source: "own" }),
			absenceId: absence.id,
			metadata: {
				category: "sick_note",
				title: uploaded.title,
				documentDate: uploaded.documentDate,
				...(officer ? { visibility: input.visibility } : {}),
			},
		}),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error || "Upload failed");
	}
}

/**
 * Attaches one or more sick notes to the employee's own sick leave (#982).
 * Each file, picked or taken with the phone camera (#983), becomes its own
 * shared sick note in the personnel file with its own title and document
 * date; there is no expiry or visibility. Whoever manages the employee's sick
 * notes attaches HR-only notes, or shares them with the employee (#984).
 */
export function AttachSickNoteDialog({
	absence,
	authority = "employee",
	open,
	onOpenChange,
	onAttached,
}: {
	absence: SickNoteAbsenceTarget;
	authority?: SickNoteAttacher;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAttached: () => void;
}) {
	const { t } = useTranslate();
	const dates = { startDate: absence.startDate, endDate: absence.endDate };
	const defaults = useSickNoteDefaults(dates);
	const [shared, setShared] = useState(false);
	const visibility: DocumentVisibility = shared ? "shared" : DEFAULT_VISIBILITY.sick_note;
	const uploads = useStagedSickNoteUploads({
		process: (uploaded) => attachSickNote({ uploaded, absence, authority, visibility }),
	});
	const officer = authority === "officer";

	const form = useForm({
		defaultValues: { sickNotes: [] as StagedSickNoteFile[] },
		onSubmit: async ({ value }) => {
			let attached: number;
			try {
				attached = (await uploads.stage(resolveStagedSickNoteFiles(value.sickNotes, defaults)))
					.length;
			} catch (error) {
				// Notes attached so far stay; the rest of the files are not sent.
				if (error instanceof StagedSickNoteUploadError && error.completed.length > 0) onAttached();
				const message =
					error instanceof Error && error.message
						? error.message
						: t("absences.sickNotes.attach.failed", "Upload failed");
				toast.error(
					error instanceof StagedSickNoteUploadError && error.fileName
						? `${error.fileName}: ${message}`
						: message,
				);
				return;
			}
			toast.success(
				t(
					"absences.sickNotes.attach.success",
					"{count, plural, one {Sick note attached} other {# sick notes attached}}",
					{ count: attached },
				),
			);
			onAttached();
			close();
		},
	});

	function close() {
		form.reset();
		setShared(false);
		onOpenChange(false);
	}

	return (
		<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
			{(busy: boolean) => (
				<ActionPanel
					open={open}
					onOpenChange={(next) => (next ? onOpenChange(true) : !busy && close())}
				>
					<ActionPanelContent>
						<form
							className="flex min-h-0 flex-1 flex-col"
							action={() => {
								void form.handleSubmit();
							}}
							onSubmit={(event) => {
								event.stopPropagation();
							}}
						>
							<ActionPanelHeader>
								<ActionPanelTitle>
									{t("absences.sickNotes.attach.title", "Attach sick note")}
								</ActionPanelTitle>
								<ActionPanelDescription>
									{officer
										? t(
												"absences.sickNotes.attach.officerDescription",
												"Add photos or PDFs of the sick note: PDF, JPEG, PNG or WebP files of up to 20 MB each. Each file is saved as its own sick note in the employee's personnel file.",
											)
										: t(
												"absences.sickNotes.attach.description",
												"Add photos or PDFs of your sick note: PDF, JPEG, PNG or WebP files of up to 20 MB each. Each file is saved as its own sick note in your personnel file.",
											)}
								</ActionPanelDescription>
							</ActionPanelHeader>

							<ActionPanelBody className="space-y-5">
								<form.Field
									name="sickNotes"
									validators={{
										onSubmit: ({ value }) =>
											value.length === 0
												? t("absences.sickNotes.attach.fileRequired", "Choose at least one file.")
												: stagedSickNoteFilesComplete(value)
													? undefined
													: t(
															"absences.sickNotes.files.incomplete",
															"Give each sick note a title and a document date.",
														),
									}}
								>
									{(field) => (
										<TFormItem>
											<SickNoteFilesField
												value={field.state.value}
												onChange={field.handleChange}
												dates={dates}
												disabled={busy}
												invalid={field.state.meta.errors.length > 0}
											/>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>

								{officer ? (
									<div className="flex items-start justify-between gap-4 rounded-md border p-3">
										<div className="space-y-1">
											<Label htmlFor="attach-sick-note-shared">
												{t("absences.sickNotes.attach.share", "Share with the employee")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"absences.sickNotes.attach.shareHint",
													"Off: HR-only, the employee only sees that a sick note is attached. On: the employee sees it under My Documents.",
												)}
											</p>
										</div>
										<Switch
											id="attach-sick-note-shared"
											checked={shared}
											onCheckedChange={setShared}
											disabled={busy}
										/>
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										{t(
											"absences.sickNotes.attach.sharedNote",
											"You see your sick notes under My Documents and on this absence. Your approver only sees that a sick note is attached. You can delete a sick note within 24 hours of uploading it.",
										)}
									</p>
								)}

								{uploads.isStaging ? (
									<div className="space-y-1">
										<Progress
											value={uploads.progress}
											aria-label={t("absences.sickNotes.attach.progress", "Upload progress")}
										/>
										{uploads.total > 1 ? (
											<p className="text-xs text-muted-foreground">
												{t(
													"absences.sickNotes.attach.progressCount",
													"{done} of {total} uploaded",
													{
														done: uploads.done,
														total: uploads.total,
													},
												)}
											</p>
										) : null}
									</div>
								) : null}
							</ActionPanelBody>

							<ActionPanelFooter>
								<Button type="button" variant="outline" onClick={close} disabled={busy}>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={busy}>
									{busy ? <IconLoader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
									{t("absences.sickNotes.attach.submit", "Attach")}
								</Button>
							</ActionPanelFooter>
						</form>
					</ActionPanelContent>
				</ActionPanel>
			)}
		</form.Subscribe>
	);
}
