"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { usePersonnelFileProblemMessages } from "@/components/personnel-file/document-labels";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useTravelExpenseFileUpload } from "@/hooks/use-travel-expense-file-upload";
import {
	PERSONNEL_DOCUMENT_MAX_BYTES,
	PERSONNEL_DOCUMENT_MIME_TYPES,
	personnelDocumentFileProblem,
} from "@/lib/personnel-file/document.types";
import { DOCUMENT_TITLE_MAX_LENGTH } from "@/lib/personnel-file/document-rules";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";

export interface SickNoteAbsenceTarget {
	id: string;
	employeeId: string;
	/** YYYY-MM-DD */
	startDate: string;
	/** YYYY-MM-DD */
	endDate: string;
}

interface SickNoteMetadata {
	title: string;
	documentDate: string;
}

async function attachSickNote(input: {
	tusFileKey: string;
	fileName: string | undefined;
	absence: SickNoteAbsenceTarget;
	metadata: SickNoteMetadata;
}): Promise<void> {
	const response = await fetch("/api/upload/personnel-file", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			tusFileKey: input.tusFileKey,
			fileName: input.fileName,
			employeeId: input.absence.employeeId,
			source: "own",
			absenceId: input.absence.id,
			metadata: { category: "sick_note", ...input.metadata },
		}),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error || "Upload failed");
	}
}

/**
 * Attaches one or more sick notes to the employee's own sick leave (#982).
 * Each file becomes its own shared sick note in the personnel file, with the
 * title and document date chosen here; there is no expiry or visibility.
 */
export function AttachSickNoteDialog({
	absence,
	open,
	onOpenChange,
	onAttached,
}: {
	absence: SickNoteAbsenceTarget;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAttached: () => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const fileProblemMessages = usePersonnelFileProblemMessages();
	const [files, setFiles] = useState<File[]>([]);
	const [fileError, setFileError] = useState<string | null>(null);
	const [uploadedCount, setUploadedCount] = useState(0);
	const [attaching, setAttaching] = useState(false);
	const queue = useRef<File[]>([]);
	const metadata = useRef<SickNoteMetadata | null>(null);
	const attached = useRef(0);

	const initialValues: SickNoteMetadata = {
		title: t("absences.sickNotes.attach.defaultTitle", "Sick note {dateRange}", {
			dateRange: formatAbsenceDateRange(absence.startDate, absence.endDate, locale),
		}),
		documentDate: absence.startDate,
	};

	function finish() {
		const count = attached.current;
		queue.current = [];
		metadata.current = null;
		attached.current = 0;
		setUploadedCount(0);
		setAttaching(false);
		if (count > 0) onAttached();
	}

	function uploadNext() {
		const next = queue.current.shift();
		if (!next) {
			const count = attached.current;
			finish();
			toast.success(
				t(
					"absences.sickNotes.attach.success",
					"{count, plural, one {Sick note attached} other {# sick notes attached}}",
					{ count },
				),
			);
			close();
			return;
		}
		// The uploader clears itself right after reporting a finished file.
		setTimeout(() => upload.addFile(next), 0);
	}

	const upload = useTravelExpenseFileUpload({
		maxFileSize: PERSONNEL_DOCUMENT_MAX_BYTES,
		allowedFileTypes: PERSONNEL_DOCUMENT_MIME_TYPES,
		uploadMetadata: { purpose: "personnel-document" },
		process: async ({ tusFileKey, fileName }) => {
			if (!metadata.current) throw new Error("Upload failed");
			await attachSickNote({ tusFileKey, fileName, absence, metadata: metadata.current });
		},
		onSuccess: () => {
			attached.current += 1;
			setUploadedCount(attached.current);
			uploadNext();
		},
		onError: (error) => {
			// Notes attached so far stay; the rest of the files are not sent.
			finish();
			toast.error(error.message || t("absences.sickNotes.attach.failed", "Upload failed"));
		},
	});

	const form = useForm({
		defaultValues: initialValues,
		onSubmit: ({ value }) => {
			if (files.length === 0) {
				setFileError(t("absences.sickNotes.attach.fileRequired", "Choose at least one file."));
				return;
			}
			metadata.current = { title: value.title.trim(), documentDate: value.documentDate };
			queue.current = [...files];
			attached.current = 0;
			setAttaching(true);
			uploadNext();
		},
	});

	function close() {
		form.reset(initialValues);
		setFiles([]);
		setFileError(null);
		onOpenChange(false);
	}

	function handleFilesChange(selected: FileList | null) {
		setFileError(null);
		const chosen = selected ? [...selected] : [];
		for (const file of chosen) {
			const problem = personnelDocumentFileProblem(file);
			if (problem) {
				setFiles([]);
				setFileError(`${file.name}: ${fileProblemMessages[problem]}`);
				return;
			}
		}
		setFiles(chosen);
	}

	const busy = attaching || upload.isUploading;
	const required = (label: string) =>
		t("absences.sickNotes.attach.required", "{label} is required", { label });

	return (
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
							{t(
								"absences.sickNotes.attach.description",
								"Add photos or PDFs of your sick note: PDF, JPEG, PNG or WebP files of up to 20 MB each. Each file is saved as its own sick note in your personnel file.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-5">
						<div className="grid gap-2">
							<Label htmlFor="sick-note-files">
								{t("absences.sickNotes.attach.files", "Files")}
								<span className="ml-1 text-destructive">*</span>
							</Label>
							<Input
								id="sick-note-files"
								type="file"
								multiple
								accept={PERSONNEL_DOCUMENT_MIME_TYPES.join(",")}
								disabled={busy}
								aria-invalid={fileError ? true : undefined}
								onChange={(event) => handleFilesChange(event.target.files)}
							/>
							{fileError ? (
								<p role="alert" className="text-sm text-destructive">
									{fileError}
								</p>
							) : null}
						</div>

						<form.Field
							name="title"
							validators={{
								onSubmit: ({ value }) =>
									value.trim()
										? undefined
										: required(t("absences.sickNotes.attach.titleLabel", "Title")),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("absences.sickNotes.attach.titleLabel", "Title")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											value={field.state.value}
											maxLength={DOCUMENT_TITLE_MAX_LENGTH}
											disabled={busy}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field
							name="documentDate"
							validators={{
								onSubmit: ({ value }) =>
									value
										? undefined
										: required(t("absences.sickNotes.attach.documentDate", "Document date")),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("absences.sickNotes.attach.documentDate", "Document date")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<DatePicker
											value={field.state.value}
											onChange={(value) => field.handleChange(value)}
											required
											disabled={busy}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"absences.sickNotes.attach.documentDateHint",
											"The day the sick note starts, usually the first day of your absence.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<p className="text-sm text-muted-foreground">
							{t(
								"absences.sickNotes.attach.sharedNote",
								"You see your sick notes under My Documents and on this absence. Your approver only sees that a sick note is attached. You can delete a sick note within 24 hours of uploading it.",
							)}
						</p>

						{busy ? (
							<div className="space-y-1">
								<Progress
									value={upload.progress}
									aria-label={t("absences.sickNotes.attach.progress", "Upload progress")}
								/>
								{files.length > 1 ? (
									<p className="text-xs text-muted-foreground">
										{t("absences.sickNotes.attach.progressCount", "{done} of {total} uploaded", {
											done: uploadedCount,
											total: files.length,
										})}
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
	);
}
