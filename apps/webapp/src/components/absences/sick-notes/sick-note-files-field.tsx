"use client";

import { IconCamera, IconPaperclip, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId, useRef, useState } from "react";
import {
	formatFileSize,
	usePersonnelFileProblemMessages,
} from "@/components/personnel-file/document-labels";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	MAX_STAGED_SICK_NOTES,
	PERSONNEL_DOCUMENT_MIME_TYPES,
	personnelDocumentFileProblem,
	SICK_NOTE_CAMERA_MIME_TYPES,
} from "@/lib/personnel-file/document.types";
import { DOCUMENT_TITLE_MAX_LENGTH } from "@/lib/personnel-file/document-rules";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";

/**
 * Sick-note files staged before they are uploaded (#983): picked from the
 * device or taken with the phone camera, each with its own title and document
 * date. Shared by the absence request dialog, "Attach sick note", and the
 * on-behalf recording dialog (#984).
 */

/** A file waiting to become a sick note. */
export interface StagedSickNoteFile {
	id: string;
	file: File;
	/** Null while it follows the default title for the absence's dates. */
	title: string | null;
	/** YYYY-MM-DD; null while it follows the absence's first day. */
	documentDate: string | null;
}

export interface SickNoteDefaults {
	title: string;
	/** YYYY-MM-DD, or "" while the absence has no start date yet. */
	documentDate: string;
}

/** A staged file with its title and document date settled. */
export interface ResolvedStagedSickNote {
	file: File;
	title: string;
	documentDate: string;
}

/**
 * The default title ("Sick note" plus the absence's date range) and document
 * date (its first day) for absence dates as entered; an empty end date is a
 * one-day absence.
 */
export function useSickNoteDefaults(dates: {
	startDate: string;
	endDate: string;
}): SickNoteDefaults {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const startDate = dates.startDate;
	const endDate = dates.endDate && dates.endDate >= startDate ? dates.endDate : startDate;
	return {
		title: startDate
			? t("absences.sickNotes.attach.defaultTitle", "Sick note {dateRange}", {
					dateRange: formatAbsenceDateRange(startDate, endDate, locale),
				})
			: t("absences.sickNotes.files.defaultTitleUndated", "Sick note"),
		documentDate: startDate,
	};
}

export function resolveStagedSickNoteFiles(
	files: readonly StagedSickNoteFile[],
	defaults: SickNoteDefaults,
): ResolvedStagedSickNote[] {
	return files.map((staged) => ({
		file: staged.file,
		title: (staged.title ?? defaults.title).trim(),
		documentDate: staged.documentDate ?? defaults.documentDate,
	}));
}

/**
 * Whether every staged file keeps a title and a document date: one the user
 * cleared is missing; one that follows the defaults is not.
 */
export function stagedSickNoteFilesComplete(files: readonly StagedSickNoteFile[]): boolean {
	return files.every(
		(staged) => (staged.title === null || staged.title.trim() !== "") && staged.documentDate !== "",
	);
}

export function SickNoteFilesField({
	value,
	onChange,
	dates,
	disabled = false,
	invalid = false,
}: {
	value: readonly StagedSickNoteFile[];
	onChange: (next: StagedSickNoteFile[]) => void;
	/** The absence's dates as entered, for the default title and document date. */
	dates: { startDate: string; endDate: string };
	disabled?: boolean;
	/** Marks files without a title or document date (after a refused submit). */
	invalid?: boolean;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const fieldId = useId();
	const problemMessages = usePersonnelFileProblemMessages();
	const defaults = useSickNoteDefaults(dates);
	const cameraInput = useRef<HTMLInputElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const nextId = useRef(0);
	const [error, setError] = useState<string | null>(null);

	function add(event: React.ChangeEvent<HTMLInputElement>) {
		const chosen = event.target.files ? [...event.target.files] : [];
		// Allows choosing the same file again, e.g. after removing it.
		event.target.value = "";
		if (chosen.length === 0) return;
		const problems: string[] = [];
		const accepted: StagedSickNoteFile[] = [];
		for (const file of chosen) {
			const problem = personnelDocumentFileProblem(file);
			if (problem) {
				problems.push(`${file.name}: ${problemMessages[problem]}`);
				continue;
			}
			nextId.current += 1;
			accepted.push({ id: `${fieldId}-${nextId.current}`, file, title: null, documentDate: null });
		}
		const room = MAX_STAGED_SICK_NOTES - value.length;
		if (accepted.length > room) {
			problems.push(
				t("absences.sickNotes.files.tooMany", "You can add up to {max} files.", {
					max: MAX_STAGED_SICK_NOTES,
				}),
			);
		}
		setError(problems.length > 0 ? problems.join(" ") : null);
		if (room > 0 && accepted.length > 0) onChange([...value, ...accepted.slice(0, room)]);
	}

	function update(id: string, change: Partial<Pick<StagedSickNoteFile, "title" | "documentDate">>) {
		onChange(value.map((staged) => (staged.id === id ? { ...staged, ...change } : staged)));
	}

	function remove(id: string) {
		setError(null);
		onChange(value.filter((staged) => staged.id !== id));
	}

	const titleLabel = t("absences.sickNotes.attach.titleLabel", "Title");
	const dateLabel = t("absences.sickNotes.attach.documentDate", "Document date");

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={disabled}
					onClick={() => cameraInput.current?.click()}
				>
					<IconCamera aria-hidden="true" className="mr-2 size-4" />
					{t("absences.sickNotes.files.takePhoto", "Take photo")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={disabled}
					onClick={() => fileInput.current?.click()}
				>
					<IconPaperclip aria-hidden="true" className="mr-2 size-4" />
					{t("absences.sickNotes.files.chooseFiles", "Choose files")}
				</Button>
				<input
					ref={cameraInput}
					type="file"
					accept={SICK_NOTE_CAMERA_MIME_TYPES.join(",")}
					capture="environment"
					className="sr-only"
					tabIndex={-1}
					aria-hidden="true"
					data-testid="sick-note-camera-input"
					disabled={disabled}
					onChange={add}
				/>
				<input
					ref={fileInput}
					type="file"
					multiple
					accept={PERSONNEL_DOCUMENT_MIME_TYPES.join(",")}
					className="sr-only"
					tabIndex={-1}
					aria-hidden="true"
					data-testid="sick-note-file-input"
					disabled={disabled}
					onChange={add}
				/>
			</div>

			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}

			{value.length > 0 ? (
				<ul className="space-y-3">
					{value.map((staged) => {
						const title = staged.title ?? defaults.title;
						const documentDate = staged.documentDate ?? defaults.documentDate;
						const titleId = `${staged.id}-title`;
						const dateId = `${staged.id}-date`;
						return (
							<li key={staged.id} className="space-y-3 rounded-md border p-3">
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">{staged.file.name}</p>
										<p className="text-xs text-muted-foreground">
											{formatFileSize(staged.file.size, locale)}
										</p>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={disabled}
										aria-label={t("absences.sickNotes.files.remove", "Remove {fileName}", {
											fileName: staged.file.name,
										})}
										onClick={() => remove(staged.id)}
									>
										<IconX aria-hidden="true" className="size-4" />
									</Button>
								</div>
								<div className="grid gap-3 sm:grid-cols-2">
									<div className="grid gap-1.5">
										<Label htmlFor={titleId}>{titleLabel}</Label>
										<Input
											id={titleId}
											value={title}
											maxLength={DOCUMENT_TITLE_MAX_LENGTH}
											disabled={disabled}
											aria-invalid={invalid && !title.trim() ? true : undefined}
											onChange={(event) => update(staged.id, { title: event.target.value })}
										/>
									</div>
									<div className="grid gap-1.5">
										<Label htmlFor={dateId}>{dateLabel}</Label>
										<DatePicker
											id={dateId}
											aria-label={dateLabel}
											value={documentDate}
											disabled={disabled}
											aria-invalid={invalid && !documentDate ? true : undefined}
											onChange={(next) => update(staged.id, { documentDate: next })}
										/>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			) : null}
		</div>
	);
}
