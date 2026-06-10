"use client";

import Uppy from "@uppy/core";
import German from "@uppy/locales/lib/de_DE";
import English from "@uppy/locales/lib/en_US";
import Tus from "@uppy/tus";
import { useLocale } from "next-intl";
import { useEffect, useReducer, useState } from "react";
import { useImageProcessMutation } from "@/lib/query/use-image-process";
import { getTusFileKeyFromUploadUrl } from "@/lib/upload/tus-url";

const DEFAULT_MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;

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

type ImageUploadState = {
	progress: number;
	isUploading: boolean;
	previewUrl: string | null;
};

type ImageUploadAction =
	| { type: "start" }
	| { type: "progress"; progress: number }
	| { type: "preview"; previewUrl: string }
	| { type: "reset" };

function imageUploadReducer(state: ImageUploadState, action: ImageUploadAction): ImageUploadState {
	switch (action.type) {
		case "start":
			return { ...state, progress: 1, isUploading: true };
		case "progress":
			return { ...state, progress: action.progress };
		case "preview":
			return { ...state, previewUrl: action.previewUrl };
		case "reset":
			return { progress: 0, isUploading: false, previewUrl: null };
	}
}

export function useImageUpload({
	uploadType,
	organizationId,
	maxFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE,
	onSuccess,
	onError,
}: UseImageUploadOptions): UseImageUploadReturn {
	const locale = useLocale();
	const [uploadState, dispatchUploadState] = useReducer(imageUploadReducer, {
		progress: 0,
		isUploading: false,
		previewUrl: null,
	});
	const { progress, isUploading, previewUrl } = uploadState;

	const processMutation = useImageProcessMutation();

	const uppyLocale = locale === "de" ? German : English;

	const [uppy] = useState(() =>
		new Uppy({
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
		}),
	);

	// Update locale when it changes
	useEffect(() => {
		uppy.setOptions({ locale: uppyLocale });
	}, [uppy, uppyLocale]);

	// Handle upload events
	useEffect(() => {
		const handleUploadStart = () => {
			dispatchUploadState({ type: "start" });
		};

		const handleProgress = (progress: number) => {
			// progress is a percentage 0-100, reserve 15% for processing
			const uploadPercent = Math.round((progress / 100) * 85);
			dispatchUploadState({ type: "progress", progress: Math.max(1, uploadPercent) });
		};

		const handleFileProgress = (
			_file: unknown,
			progress: { bytesUploaded: number; bytesTotal: number | null },
		) => {
			if (progress.bytesTotal && progress.bytesTotal > 0) {
				const uploadPercent = Math.round((progress.bytesUploaded / progress.bytesTotal) * 85);
				dispatchUploadState({ type: "progress", progress: Math.max(1, uploadPercent) });
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
				const tusFileKey = getTusFileKeyFromUploadUrl(uploadUrl);

				if (tusFileKey) {
					dispatchUploadState({ type: "progress", progress: 90 });

					try {
						// Use TanStack Query mutation for image processing
						const response = await processMutation.mutateAsync({
							tusFileKey,
							uploadType,
							organizationId,
						});

						dispatchUploadState({ type: "progress", progress: 100 });
						onSuccess?.(response.url);
					} catch (err) {
						onError?.(err instanceof Error ? err : new Error("Processing failed"));
					}
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

	const addFile = (file: File) => {
		// Create local preview
		const reader = new FileReader();
		reader.onloadend = () => {
			dispatchUploadState({ type: "preview", previewUrl: reader.result as string });
		};
		reader.readAsDataURL(file);

		// Add to Uppy
		try {
			// Clear any existing files first
			uppy.cancelAll();

			uppy.addFile({
				name: file.name,
				type: file.type,
				meta: {
					contentType: file.type,
				},
				data: file,
			});
		} catch (err) {
			console.error("Error adding file to Uppy:", err);
			onError?.(err instanceof Error ? err : new Error("Failed to add file"));
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
		previewUrl,
		reset,
	};
}
