"use client";

import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { discardStagedSickNoteUploadsAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import { Progress } from "@/components/ui/progress";
import { TFormItem, TFormMessage } from "@/components/ui/tanstack-form";
import type { ServerActionResult } from "@/lib/effect/result";
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

/**
 * The optional sick notes of a dialog that creates sick leave: the employee's
 * request (#983) and the on-behalf recording (#984). The files are uploaded
 * first and sent along once all are uploaded; the server attaches them once
 * the absence exists.
 */

interface AbsenceDates {
	startDate: string;
	endDate: string;
}

/** The absence created, and what became of the staged notes when any came along. */
interface WithSickNotes {
	absenceId: string;
	sickNotes?: { failed: readonly { fileName: string }[] };
}

/**
 * Stages the dialog's sick notes and sends the absence with them. `submit`
 * resolves to the server's result, or to null when it was already handled
 * with a toast: a file could not be uploaded (nothing is sent), or the server
 * call itself failed (the uploads are deleted again).
 */
export function useStagedSickNotes(dates: AbsenceDates) {
	const { t } = useTranslate();
	const uploads = useStagedSickNoteUploads();
	const defaults = useSickNoteDefaults(dates);

	async function submit<Result extends WithSickNotes>(input: {
		files: readonly StagedSickNoteFile[];
		/** Sends the absence, with the uploads when there are any. */
		send: (uploaded: UploadedSickNote[] | null) => Promise<ServerActionResult<Result>>;
		/** Shown when the server call fails outright. */
		failureMessage: string;
	}): Promise<ServerActionResult<Result> | null> {
		let uploaded: UploadedSickNote[] = [];
		if (input.files.length > 0) {
			try {
				uploaded = await uploads.stage(resolveStagedSickNoteFiles(input.files, defaults));
			} catch (error) {
				toast.error(
					t(
						"absences.sickNotes.request.uploadFailed",
						"{fileName} could not be uploaded. Remove it or try again.",
						{ fileName: error instanceof StagedSickNoteUploadError ? error.fileName : "" },
					),
				);
				return null;
			}
		}
		try {
			return await input.send(uploaded.length > 0 ? uploaded : null);
		} catch {
			// Never reached the server, or it did not answer: nothing will attach the uploads.
			if (uploaded.length > 0) {
				// Best effort: the network may still be down.
				await Promise.allSettled([
					discardStagedSickNoteUploadsAction(uploaded.map((note) => note.tusFileKey)),
				]);
			}
			toast.error(input.failureMessage);
			return null;
		}
	}

	/** The `sickNotes` field's submit validator. */
	function validate(files: readonly StagedSickNoteFile[]): string | undefined {
		return stagedSickNoteFilesComplete(files)
			? undefined
			: t(
					"absences.sickNotes.files.incomplete",
					"Give each sick note a title and a document date.",
				);
	}

	return { uploads, submit, validate };
}

/** The file names of the staged notes the server could not attach. */
export function failedSickNoteNames(result: { data: WithSickNotes }): string {
	return (result.data.sickNotes?.failed ?? []).map((failure) => failure.fileName).join(", ");
}

interface SickNotesField {
	state: { value: StagedSickNoteFile[]; meta: { errors: unknown[] } };
	handleChange: (value: StagedSickNoteFile[]) => void;
}

/** The dialog's sick note section: title, description, files and upload progress. */
export function StagedSickNotesSection({
	id,
	title,
	description,
	field,
	dates,
	disabled,
	uploads,
}: {
	/** Id of the section heading. */
	id: string;
	title: string;
	description: string;
	field: SickNotesField;
	dates: AbsenceDates;
	disabled: boolean;
	uploads: ReturnType<typeof useStagedSickNotes>["uploads"];
}) {
	const { t } = useTranslate();
	return (
		<TFormItem>
			<section aria-labelledby={id} className="space-y-2">
				<div>
					<h3 id={id} className="text-sm font-medium">
						{title}
					</h3>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
				<SickNoteFilesField
					value={field.state.value}
					onChange={field.handleChange}
					dates={dates}
					disabled={disabled}
					invalid={field.state.meta.errors.length > 0}
				/>
				<TFormMessage field={field} />
				{uploads.isStaging ? (
					<div className="space-y-1">
						<Progress
							value={uploads.progress}
							aria-label={t("absences.sickNotes.attach.progress", "Upload progress")}
						/>
						<p className="text-xs text-muted-foreground">
							{t("absences.sickNotes.attach.progressCount", "{done} of {total} uploaded", {
								done: uploads.done,
								total: uploads.total,
							})}
						</p>
					</div>
				) : null}
			</section>
		</TFormItem>
	);
}
