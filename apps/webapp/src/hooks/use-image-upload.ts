"use client";

import Uppy from "@uppy/core";
import German from "@uppy/locales/lib/de_DE";
import English from "@uppy/locales/lib/en_US";
import Tus from "@uppy/tus";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useImageProcessMutation } from "@/lib/query/use-image-process";

interface UseImageUploadOptions {
	uploadType: "avatar" | "org-logo" | "branding-logo" | "branding-background";
	organizationId?: string;
	maxFileSize?: number;
	onSuccess?: (url: string) => void;
	onError?: (error: Error) => void;
}

interface UseImageUploadReturn {
	addFile: (file: File) => void;
	progress: number;
	isUploading: boolean;
	isProcessing: boolean;
	previewUrl: string | null;
	reset: () => void;
}

export function useImageUpload({
	uploadType,
	organizationId,
	maxFileSize = 5 * 1024 * 1024,
	onSuccess,
	onError,
}: UseImageUploadOptions): UseImageUploadReturn {
	const locale = useLocale();
	const [progress, setProgress] = useState(0);
	const [isUploading, setIsUploading] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	const processMutation = useImageProcessMutation();

	const uppyLocale = locale === "de" ? German : English;

	const uppy = useMemo(() => {
		return new Uppy({
			restrictions: {
				maxFileSize,
				maxNumberOfFiles: 1,
				allowedFileTypes: ["image/*"],
			},
			autoProceed: true,
			locale: uppyLocale,
		}).use(Tus, {
			endpoint: "/api/tus",
			retryDelays: [0, 1000, 3000, 5000],
			chunkSize: 5 * 1024 * 1024, // 5MB chunks
			// Credentials included automatically via cookies
		});
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Update locale when it changes
	useEffect(() => {
		uppy.setOptions({ locale: uppyLocale });
	}, [locale, uppy, uppyLocale]);

	// Handle upload events
	useEffect(() => {
		const handleUploadStart = () => {
			setIsUploading(true);
			setProgress(1);
		};

		const handleProgress = (progress: { bytesUploaded: number; bytesTotal: number }) => {
			if (progress.bytesTotal > 0) {
				// Show 0-85% for upload, reserve 15% for processing
				const uploadPercent = Math.round((progress.bytesUploaded / progress.bytesTotal) * 85);
				setProgress(Math.max(1, uploadPercent));
			}
		};

		const handleFileProgress = (
			_file: unknown,
			progress: { bytesUploaded: number; bytesTotal: number | null },
		) => {
			if (progress.bytesTotal && progress.bytesTotal > 0) {
				const uploadPercent = Math.round((progress.bytesUploaded / progress.bytesTotal) * 85);
				setProgress(Math.max(1, uploadPercent));
			}
		};

		const handleComplete = async (result: {
			successful?: Array<{ uploadURL?: string }>;
			failed?: unknown[];
		}) => {
			if (result.successful && result.successful.length > 0) {
				const uploadedFile = result.successful[0];
				// Extract the file key from the upload URL
				const uploadUrl = uploadedFile?.uploadURL;
				const tusFileKey = uploadUrl?.split("/").pop();

				if (tusFileKey) {
					setProgress(90); // Processing stage

					try {
						// Use TanStack Query mutation for image processing
						const response = await processMutation.mutateAsync({
							tusFileKey,
							uploadType,
							organizationId,
						});

						setProgress(100);
						onSuccess?.(response.url);
					} catch (err) {
						onError?.(err instanceof Error ? err : new Error("Processing failed"));
					}
				}
			} else if (result.failed && result.failed.length > 0) {
				onError?.(new Error("Upload failed"));
			}

			setIsUploading(false);
			setProgress(0);
			setPreviewUrl(null);
			uppy.cancelAll();
		};

		const handleError = (_file: unknown, error: { message?: string }) => {
			setIsUploading(false);
			setProgress(0);
			setPreviewUrl(null);
			onError?.(new Error(error?.message || "Upload failed"));
			uppy.cancelAll();
		};

		uppy.on("upload", handleUploadStart);
		uppy.on("progress", handleProgress);
		uppy.on("upload-progress", handleFileProgress);
		uppy.on("complete", handleComplete);
		uppy.on("upload-error", handleError);

		return () => {
			uppy.off("upload", handleUploadStart);
			uppy.off("progress", handleProgress);
			uppy.off("upload-progress", handleFileProgress);
			uppy.off("complete", handleComplete);
			uppy.off("upload-error", handleError);
		};
	}, [uppy, uploadType, organizationId, onSuccess, onError, processMutation]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			uppy.destroy();
		};
	}, [uppy]);

	const addFile = useCallback(
		(file: File) => {
			// Create local preview
			const reader = new FileReader();
			reader.onloadend = () => {
				setPreviewUrl(reader.result as string);
			};
			reader.readAsDataURL(file);

			// Add to Uppy
			try {
				// Clear any existing files first
				uppy.cancelAll();

				uppy.addFile({
					name: file.name,
					type: file.type,
					data: file,
				});
			} catch (err) {
				console.error("Error adding file to Uppy:", err);
				onError?.(err instanceof Error ? err : new Error("Failed to add file"));
			}
		},
		[uppy, onError],
	);

	const reset = useCallback(() => {
		setProgress(0);
		setIsUploading(false);
		setPreviewUrl(null);
		uppy.cancelAll();
	}, [uppy]);

	return {
		addFile,
		progress,
		isUploading,
		isProcessing: processMutation.isPending,
		previewUrl,
		reset,
	};
}
