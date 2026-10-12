"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { discardStagedSickNoteUploadsAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import { useTusFileUpload } from "@/hooks/use-tus-file-upload";
import {
	PERSONNEL_DOCUMENT_MAX_BYTES,
	PERSONNEL_DOCUMENT_MIME_TYPES,
} from "@/lib/personnel-file/document.types";
import type { ResolvedStagedSickNote } from "./sick-note-files-field";

/** A finished upload, as the absence request and recording actions take it (#983). */
export interface UploadedSickNote {
	tusFileKey: string;
	fileName?: string;
	title: string;
	/** YYYY-MM-DD */
	documentDate: string;
}

/** Uploading a staged file failed; earlier files were handled (see `stage`). */
export class StagedSickNoteUploadError extends Error {
	readonly fileName: string;
	/** The files finished before it: processed with `process`, discarded without. */
	readonly completed: readonly UploadedSickNote[];

	constructor(fileName: string, message: string, completed: readonly UploadedSickNote[] = []) {
		super(message);
		this.name = "StagedSickNoteUploadError";
		this.fileName = fileName;
		this.completed = completed;
	}
}

/** One `stage` call, from start until it settles. */
interface StagingRun {
	queue: ResolvedStagedSickNote[];
	total: number;
	/** The note whose file is uploading now. */
	uploading: ResolvedStagedSickNote | null;
	uploaded: UploadedSickNote[];
	resolve: (uploaded: UploadedSickNote[]) => void;
	reject: (error: StagedSickNoteUploadError) => void;
}

/**
 * Uploads staged sick-note files over TUS, one after another (#983). Without
 * `process`, `stage` resolves to the finished uploads for a server action to
 * attach once the absence exists; when a file fails, the uploads before it
 * are discarded and it rejects with the failed file's name. With `process`,
 * each finished upload is handed to it right away (e.g. attached to an
 * existing absence) and a failure stops the rest; what was processed stays.
 */
export function useStagedSickNoteUploads(
	options: { process?: (uploaded: UploadedSickNote) => Promise<void> } = {},
) {
	const activeRun = useRef<StagingRun | null>(null);
	const processRef = useRef(options.process);
	useLayoutEffect(() => {
		processRef.current = options.process;
	});
	const [count, setCount] = useState({ done: 0, total: 0 });

	function settle(): StagingRun | null {
		const run = activeRun.current;
		activeRun.current = null;
		setCount({ done: 0, total: 0 });
		return run;
	}

	const upload = useTusFileUpload<UploadedSickNote>({
		maxFileSize: PERSONNEL_DOCUMENT_MAX_BYTES,
		allowedFileTypes: PERSONNEL_DOCUMENT_MIME_TYPES,
		uploadMetadata: { purpose: "personnel-document" },
		process: async ({ tusFileKey, fileName }) => {
			const note = activeRun.current?.uploading;
			if (!note) throw new Error("Upload failed");
			const uploaded: UploadedSickNote = {
				tusFileKey,
				fileName: fileName ?? note.file.name,
				title: note.title,
				documentDate: note.documentDate,
			};
			await processRef.current?.(uploaded);
			return uploaded;
		},
		onSuccess: (uploaded) => {
			const run = activeRun.current;
			if (!run) return;
			run.uploaded.push(uploaded);
			setCount({ done: run.uploaded.length, total: run.total });
			next();
		},
		onError: (error) => {
			const run = settle();
			if (!run) return;
			if (!processRef.current && run.uploaded.length > 0) {
				void discardStagedSickNoteUploadsAction(
					run.uploaded.map((uploaded) => uploaded.tusFileKey),
				).catch(() => undefined);
			}
			run.reject(
				new StagedSickNoteUploadError(run.uploading?.file.name ?? "", error.message, run.uploaded),
			);
		},
	});

	function next() {
		const run = activeRun.current;
		if (!run) return;
		const following = run.queue.shift();
		if (!following) {
			settle();
			run.resolve(run.uploaded);
			return;
		}
		run.uploading = following;
		// The uploader clears itself right after reporting a finished file.
		setTimeout(() => upload.addFile(following.file), 0);
	}

	function stage(notes: readonly ResolvedStagedSickNote[]): Promise<UploadedSickNote[]> {
		if (activeRun.current) {
			return Promise.reject(new StagedSickNoteUploadError("", "Upload in progress"));
		}
		if (notes.length === 0) return Promise.resolve([]);
		return new Promise((resolve, reject) => {
			activeRun.current = {
				queue: [...notes],
				total: notes.length,
				uploading: null,
				uploaded: [],
				resolve,
				reject,
			};
			setCount({ done: 0, total: notes.length });
			next();
		});
	}

	return {
		stage,
		/** True from `stage` until it settles. */
		isStaging: count.total > 0,
		/** The current file's upload progress, 0–100. */
		progress: upload.progress,
		done: count.done,
		total: count.total,
	};
}
