"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { discardStagedSickNoteUploadsAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import { useTravelExpenseFileUpload } from "@/hooks/use-travel-expense-file-upload";
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

interface Run {
	queue: ResolvedStagedSickNote[];
	total: number;
	current: ResolvedStagedSickNote | null;
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
	const run = useRef<Run | null>(null);
	const processRef = useRef(options.process);
	useLayoutEffect(() => {
		processRef.current = options.process;
	});
	const [count, setCount] = useState({ done: 0, total: 0 });

	function settle(): Run | null {
		const current = run.current;
		run.current = null;
		setCount({ done: 0, total: 0 });
		return current;
	}

	const upload = useTravelExpenseFileUpload<UploadedSickNote>({
		maxFileSize: PERSONNEL_DOCUMENT_MAX_BYTES,
		allowedFileTypes: PERSONNEL_DOCUMENT_MIME_TYPES,
		uploadMetadata: { purpose: "personnel-document" },
		process: async ({ tusFileKey, fileName }) => {
			const current = run.current?.current;
			if (!current) throw new Error("Upload failed");
			const uploaded: UploadedSickNote = {
				tusFileKey,
				fileName: fileName ?? current.file.name,
				title: current.title,
				documentDate: current.documentDate,
			};
			await processRef.current?.(uploaded);
			return uploaded;
		},
		onSuccess: (uploaded) => {
			const current = run.current;
			if (!current) return;
			current.uploaded.push(uploaded);
			setCount({ done: current.uploaded.length, total: current.total });
			next();
		},
		onError: (error) => {
			const current = settle();
			if (!current) return;
			if (!processRef.current && current.uploaded.length > 0) {
				void discardStagedSickNoteUploadsAction(
					current.uploaded.map((uploaded) => uploaded.tusFileKey),
				).catch(() => undefined);
			}
			current.reject(
				new StagedSickNoteUploadError(
					current.current?.file.name ?? "",
					error.message,
					current.uploaded,
				),
			);
		},
	});

	function next() {
		const current = run.current;
		if (!current) return;
		const following = current.queue.shift();
		if (!following) {
			settle();
			current.resolve(current.uploaded);
			return;
		}
		current.current = following;
		// The uploader clears itself right after reporting a finished file.
		setTimeout(() => upload.addFile(following.file), 0);
	}

	function stage(notes: readonly ResolvedStagedSickNote[]): Promise<UploadedSickNote[]> {
		if (run.current) return Promise.reject(new StagedSickNoteUploadError("", "Upload in progress"));
		if (notes.length === 0) return Promise.resolve([]);
		return new Promise((resolve, reject) => {
			run.current = {
				queue: [...notes],
				total: notes.length,
				current: null,
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
