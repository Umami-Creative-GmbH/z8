"use client";

import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { useEffect, useReducer } from "react";
import {
	type ProcessTravelExpenseFileResponse,
	useTravelExpenseFileProcessMutation,
} from "@/lib/query/use-travel-expense-file-process";
import { ALLOWED_TRAVEL_EXPENSE_MIME_TYPES } from "@/lib/travel-expenses/attachment-validation";
import { getTusFileKeyFromUploadUrl } from "@/lib/upload/tus-url";

const DEFAULT_MAX_TRAVEL_EXPENSE_FILE_SIZE = 10 * 1024 * 1024;

interface UseTravelExpenseFileUploadOptions {
	claimId: string;
	maxFileSize?: number;
	onSuccess?: (attachment: ProcessTravelExpenseFileResponse["attachment"]) => void;
	onError?: (error: Error) => void;
}

interface UseTravelExpenseFileUploadReturn {
	addFile: (file: File) => void;
	progress: number;
	isUploading: boolean;
	isProcessing: boolean;
	reset: () => void;
}

type TravelExpenseUploadState = {
	progress: number;
	isUploading: boolean;
};

type TravelExpenseUploadAction =
	| { type: "start" }
	| { type: "progress"; progress: number }
	| { type: "reset" };

function travelExpenseUploadReducer(
	state: TravelExpenseUploadState,
	action: TravelExpenseUploadAction,
) {
	switch (action.type) {
		case "start":
			return { progress: 1, isUploading: true };
		case "progress":
			return { ...state, progress: action.progress };
		case "reset":
			return { progress: 0, isUploading: false };
	}
}

export function useTravelExpenseFileUpload({
	claimId,
	maxFileSize = DEFAULT_MAX_TRAVEL_EXPENSE_FILE_SIZE,
	onSuccess,
	onError,
}: UseTravelExpenseFileUploadOptions): UseTravelExpenseFileUploadReturn {
	const [uploadState, dispatchUploadState] = useReducer(travelExpenseUploadReducer, {
		progress: 0,
		isUploading: false,
	});
	const { progress, isUploading } = uploadState;
	const processMutation = useTravelExpenseFileProcessMutation();

	const uppy = (() => {
		return new Uppy({
			restrictions: {
				maxFileSize,
				maxNumberOfFiles: 1,
				allowedFileTypes: [...ALLOWED_TRAVEL_EXPENSE_MIME_TYPES],
			},
			autoProceed: true,
		}).use(Tus, {
			endpoint: "/api/tus",
			retryDelays: [0, 1000, 3000, 5000],
			chunkSize: 5 * 1024 * 1024,
		});
	})(); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
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
			if (result.successful && result.successful.length > 0) {
				const uploadedFile = result.successful[0];
				const uploadUrl = uploadedFile?.uploadURL;
				const tusFileKey = getTusFileKeyFromUploadUrl(uploadUrl);

				if (tusFileKey) {
					dispatchUploadState({ type: "progress", progress: 90 });

					try {
						const response = await processMutation.mutateAsync({
							tusFileKey,
							claimId,
							fileName: uploadedFile.name,
						});

						dispatchUploadState({ type: "progress", progress: 100 });
						onSuccess?.(response.attachment);
					} catch (error) {
						onError?.(
							error instanceof Error ? error : new Error("Travel expense file processing failed"),
						);
					}
				} else {
					onError?.(new Error("Upload failed: missing file key"));
				}
			} else if (result.failed && result.failed.length > 0) {
				onError?.(new Error("Upload failed"));
			}

			dispatchUploadState({ type: "reset" });
			uppy.cancelAll();
		};

		const handleError = (_file: unknown, error: { message?: string }) => {
			dispatchUploadState({ type: "reset" });
			onError?.(new Error(error?.message || "Upload failed"));
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
		};
	}, [uppy, claimId, onSuccess, onError, processMutation]);

	useEffect(() => {
		return () => {
			uppy.destroy();
		};
	}, [uppy]);

	const addFile = (file: File) => {
		try {
			uppy.cancelAll();
			uppy.addFile({
				name: file.name,
				type: file.type,
				data: file,
			});
		} catch (error) {
			onError?.(error instanceof Error ? error : new Error("Failed to add file"));
		}
	};

	const reset = () => {
		dispatchUploadState({ type: "reset" });
		uppy.cancelAll();
	};

	return {
		addFile,
		progress,
		isUploading,
		isProcessing: processMutation.isPending,
		reset,
	};
}
