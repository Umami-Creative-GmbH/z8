"use client";

import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPES,
	MAX_QUALIFICATION_EVIDENCE_BYTES,
} from "@/lib/qualifications/evidence-validation";
import {
	type ProcessQualificationEvidenceFileResponse,
	useQualificationEvidenceFileProcessMutation,
} from "@/lib/query/use-qualification-evidence-file-process";

interface UseQualificationEvidenceFileUploadOptions {
	employeeSkillId: string | null;
	onSuccess?: (evidence: ProcessQualificationEvidenceFileResponse["evidence"]) => void;
	onError?: (error: Error) => void;
}

interface UseQualificationEvidenceFileUploadReturn {
	addFile: (file: File) => void;
	progress: number;
	isUploading: boolean;
	isProcessing: boolean;
	reset: () => void;
}

export function useQualificationEvidenceFileUpload({
	employeeSkillId,
	onSuccess,
	onError,
}: UseQualificationEvidenceFileUploadOptions): UseQualificationEvidenceFileUploadReturn {
	const [progress, setProgress] = useState(0);
	const [isUploading, setIsUploading] = useState(false);
	const processMutation = useQualificationEvidenceFileProcessMutation();

	const uppy = useMemo(() => {
		return new Uppy({
			restrictions: {
				maxFileSize: MAX_QUALIFICATION_EVIDENCE_BYTES,
				maxNumberOfFiles: 1,
				allowedFileTypes: [...ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPES],
			},
			autoProceed: true,
		}).use(Tus, {
			endpoint: "/api/tus",
			retryDelays: [0, 1000, 3000, 5000],
			chunkSize: 5 * 1024 * 1024,
		});
	}, []);

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
				const uploadPercent = Math.round(
					(progressState.bytesUploaded / progressState.bytesTotal) * 85,
				);
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

				if (tusFileKey && employeeSkillId) {
					setProgress(90);

					try {
						const response = await processMutation.mutateAsync({
							tusFileKey,
							employeeSkillId,
							fileName: uploadedFile.name,
						});

						setProgress(100);
						onSuccess?.(response.evidence);
					} catch (error) {
						onError?.(
							error instanceof Error
								? error
								: new Error("Qualification evidence file processing failed"),
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
	}, [uppy, employeeSkillId, onSuccess, onError, processMutation]);

	useEffect(() => {
		return () => {
			uppy.destroy();
		};
	}, [uppy]);

	const addFile = useCallback(
		(file: File) => {
			if (!employeeSkillId) {
				onError?.(new Error("Qualification is required"));
				return;
			}

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
		[uppy, employeeSkillId, onError],
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
