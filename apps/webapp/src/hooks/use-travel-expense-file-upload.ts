"use client";

import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ALLOWED_TRAVEL_EXPENSE_MIME_TYPES } from "@/lib/travel-expenses/attachment-validation";
import {
	type ProcessTravelExpenseFileResponse,
	useTravelExpenseFileProcessMutation,
} from "@/lib/query/use-travel-expense-file-process";

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

export function useTravelExpenseFileUpload({
	claimId,
	maxFileSize = 10 * 1024 * 1024,
	onSuccess,
	onError,
}: UseTravelExpenseFileUploadOptions): UseTravelExpenseFileUploadReturn {
	const [progress, setProgress] = useState(0);
	const [isUploading, setIsUploading] = useState(false);
	const processMutation = useTravelExpenseFileProcessMutation();

	const uppy = useMemo(() => {
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
	}, [maxFileSize]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		const handleUploadStart = () => {
			setIsUploading(true);
			setProgress(1);
		};

		const handleFileProgress = (
			_file: unknown,
			progressState: { bytesUploaded: number; bytesTotal: number | null },
		) => {
			if (progressState.bytesTotal && progressState.bytesTotal > 0) {
				const uploadPercent = Math.round((progressState.bytesUploaded / progressState.bytesTotal) * 85);
				setProgress(Math.max(1, uploadPercent));
			}
		};

		const handleComplete = async (result: {
			successful?: Array<{ uploadURL?: string; name?: string }>;
			failed?: unknown[];
		}) => {
			if (result.successful && result.successful.length > 0) {
				const uploadedFile = result.successful[0];
				const uploadUrl = uploadedFile?.uploadURL;
				const tusFileKey = uploadUrl?.split("/").pop();

				if (tusFileKey) {
					setProgress(90);

					try {
						const response = await processMutation.mutateAsync({
							tusFileKey,
							claimId,
							fileName: uploadedFile.name,
						});

						setProgress(100);
						onSuccess?.(response.attachment);
					} catch (error) {
						onError?.(
							error instanceof Error
								? error
								: new Error("Travel expense file processing failed"),
						);
					}
				} else {
					onError?.(new Error("Upload failed: missing file key"));
				}
			} else if (result.failed && result.failed.length > 0) {
				onError?.(new Error("Upload failed"));
			}

			setIsUploading(false);
			setProgress(0);
			uppy.cancelAll();
		};

		const handleError = (_file: unknown, error: { message?: string }) => {
			setIsUploading(false);
			setProgress(0);
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

	const addFile = useCallback(
		(file: File) => {
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
		},
		[uppy, onError],
	);

	const reset = useCallback(() => {
		setProgress(0);
		setIsUploading(false);
		uppy.cancelAll();
	}, [uppy]);

	return {
		addFile,
		progress,
		isUploading,
		isProcessing: processMutation.isPending,
		reset,
	};
}
