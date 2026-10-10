"use client";

import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { getTusFileKeyFromUploadUrl } from "@/lib/upload/tus-url";

export interface UseTusFileUploadOptions<Result> {
	/** Attaches the finished upload on the server, e.g. to a report item. */
	process: (input: { tusFileKey: string; fileName: string | undefined }) => Promise<Result>;
	maxFileSize: number;
	/** Accepted MIME types. */
	allowedFileTypes: readonly string[];
	/** Extra TUS upload metadata, e.g. `{ purpose: "personnel-document" }` (#865). */
	uploadMetadata?: Readonly<Record<string, string>>;
	onSuccess?: (result: Result) => void;
	onError?: (error: Error) => void;
}

export interface UseTusFileUploadReturn {
	addFile: (file: File) => void;
	progress: number;
	isUploading: boolean;
	isProcessing: boolean;
	reset: () => void;
}

type TusUploadState = {
	progress: number;
	isUploading: boolean;
	isProcessing: boolean;
};

type TusUploadAction =
	| { type: "start" }
	| { type: "progress"; progress: number }
	| { type: "processing" }
	| { type: "reset" };

const idle: TusUploadState = { progress: 0, isUploading: false, isProcessing: false };

function tusUploadReducer(state: TusUploadState, action: TusUploadAction): TusUploadState {
	switch (action.type) {
		case "start":
			return { progress: 1, isUploading: true, isProcessing: false };
		case "progress":
			return { ...state, progress: action.progress };
		case "processing":
			return { progress: 90, isUploading: true, isProcessing: true };
		case "reset":
			return idle;
	}
}

/**
 * Uploads one file at a time through TUS, then hands it to `process`.
 * The uploader lives for the component's lifetime: rerenders (autosave,
 * refetches, new callback identities) never recreate or destroy it mid-upload,
 * and completion always reaches the latest callbacks.
 */
export function useTusFileUpload<Result>({
	process,
	maxFileSize,
	allowedFileTypes,
	uploadMetadata,
	onSuccess,
	onError,
}: UseTusFileUploadOptions<Result>): UseTusFileUploadReturn {
	const [uploadState, dispatchUploadState] = useReducer(tusUploadReducer, idle);
	const uppyRef = useRef<Uppy | null>(null);
	const callbacks = useRef({ process, onSuccess, onError, uploadMetadata });
	useLayoutEffect(() => {
		callbacks.current = { process, onSuccess, onError, uploadMetadata };
	});
	const allowedFileTypesKey = allowedFileTypes.join(",");

	useEffect(() => {
		const uppy = new Uppy({
			restrictions: {
				maxFileSize,
				maxNumberOfFiles: 1,
				allowedFileTypes: allowedFileTypesKey.split(","),
			},
			autoProceed: true,
		}).use(Tus, {
			endpoint: "/api/tus",
			retryDelays: [0, 1000, 3000, 5000],
			chunkSize: 5 * 1024 * 1024,
		});
		uppyRef.current = uppy;

		const handleUploadStart = () => {
			dispatchUploadState({ type: "start" });
		};

		const handleFileProgress = (
			_file: unknown,
			progressState: { bytesUploaded: number; bytesTotal: number | null },
		) => {
			if (progressState.bytesTotal && progressState.bytesTotal > 0) {
				const uploadPercent = Math.round(
					(progressState.bytesUploaded / progressState.bytesTotal) * 85,
				);
				dispatchUploadState({ type: "progress", progress: Math.max(1, uploadPercent) });
			}
		};

		const handleComplete = async (result: {
			successful?: Array<{ uploadURL?: string; name?: string }>;
			failed?: unknown[];
		}) => {
			const { process: processUpload, onSuccess: succeeded, onError: failed } =
				callbacks.current;
			const uploadedFile = result.successful?.[0];
			if (uploadedFile) {
				const tusFileKey = getTusFileKeyFromUploadUrl(uploadedFile.uploadURL);
				if (tusFileKey) {
					dispatchUploadState({ type: "processing" });
					try {
						const processed = await processUpload({ tusFileKey, fileName: uploadedFile.name });
						succeeded?.(processed);
					} catch (error) {
						failed?.(
							error instanceof Error ? error : new Error("File processing failed"),
						);
					}
				} else {
					failed?.(new Error("Upload failed: missing file key"));
				}
			} else if (result.failed && result.failed.length > 0) {
				failed?.(new Error("Upload failed"));
			}

			dispatchUploadState({ type: "reset" });
			uppy.cancelAll();
		};

		const handleError = (_file: unknown, error: { message?: string }) => {
			dispatchUploadState({ type: "reset" });
			callbacks.current.onError?.(new Error(error?.message || "Upload failed"));
			uppy.cancelAll();
		};

		uppy.on("upload", handleUploadStart);
		uppy.on("upload-progress", handleFileProgress);
		uppy.on("complete", handleComplete);
		uppy.on("upload-error", handleError);

		return () => {
			uppy.off("upload", handleUploadStart);
			uppy.off("upload-progress", handleFileProgress);
			uppy.off("complete", handleComplete);
			uppy.off("upload-error", handleError);
			uppy.destroy();
			if (uppyRef.current === uppy) uppyRef.current = null;
		};
	}, [maxFileSize, allowedFileTypesKey]);

	const addFile = (file: File) => {
		const uppy = uppyRef.current;
		if (!uppy) {
			callbacks.current.onError?.(new Error("Uploader is not ready"));
			return;
		}
		try {
			uppy.cancelAll();
			uppy.addFile({
				name: file.name,
				type: file.type,
				data: file,
				...(callbacks.current.uploadMetadata
					? { meta: { ...callbacks.current.uploadMetadata } }
					: {}),
			});
		} catch (error) {
			callbacks.current.onError?.(
				error instanceof Error ? error : new Error("Failed to add file"),
			);
		}
	};

	const reset = () => {
		dispatchUploadState({ type: "reset" });
		uppyRef.current?.cancelAll();
	};

	return {
		addFile,
		progress: uploadState.progress,
		isUploading: uploadState.isUploading,
		isProcessing: uploadState.isProcessing,
		reset,
	};
}
