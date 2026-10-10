"use client";

import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PERSONNEL_DOCUMENT_MAX_BYTES } from "@/lib/personnel-file/document.types";
import { PAYSLIP_BATCH_MAX_FILES } from "@/lib/personnel-file/payslip-batch.types";
import { getTusFileKeyFromUploadUrl } from "@/lib/upload/tus-url";
import { stageUpload } from "./payslip-batch-upload-client";

/**
 * Uploads payslip batch files (#868) through TUS, a few at a time, and stages
 * each finished upload in the batch. Every file is reported on its own, so a
 * failed file never stops the others.
 */

export interface PayslipBatchUploadProgress {
	total: number;
	staged: number;
	failed: Array<{ id: string; fileName: string; error: string }>;
}

const idle: PayslipBatchUploadProgress = { total: 0, staged: 0, failed: [] };

export function usePayslipBatchUpload(options: {
	batchId: string;
	/** Called after each staged file and once more when all files are done. */
	onStaged: () => void;
}) {
	const [progress, setProgress] = useState<PayslipBatchUploadProgress>(idle);
	const uppyRef = useRef<Uppy | null>(null);
	const onStaged = useRef(options.onStaged);
	useLayoutEffect(() => {
		onStaged.current = options.onStaged;
	});
	const { batchId } = options;

	useEffect(() => {
		const uppy = new Uppy({
			restrictions: {
				maxFileSize: PERSONNEL_DOCUMENT_MAX_BYTES,
				maxNumberOfFiles: PAYSLIP_BATCH_MAX_FILES,
				allowedFileTypes: ["application/pdf", ".pdf"],
			},
			autoProceed: true,
		}).use(Tus, {
			endpoint: "/api/tus",
			retryDelays: [0, 1000, 3000, 5000],
			chunkSize: 5 * 1024 * 1024,
			limit: 4,
		});
		uppyRef.current = uppy;

		const fail = (fileName: string, error: string) => {
			const failure = { id: crypto.randomUUID(), fileName, error };
			setProgress((current) => ({
				...current,
				failed: [...current.failed, failure],
			}));
		};

		const handleSuccess = async (
			file: { id: string; name?: string } | undefined,
			response: { uploadURL?: string },
		) => {
			if (!file) return;
			const fileName = file.name ?? "payslip.pdf";
			const tusFileKey = getTusFileKeyFromUploadUrl(response.uploadURL);
			try {
				if (!tusFileKey) throw new Error("Upload failed");
				await stageUpload({ batchId, tusFileKey, fileName });
				setProgress((current) => ({ ...current, staged: current.staged + 1 }));
				onStaged.current();
			} catch (error) {
				fail(fileName, error instanceof Error ? error.message : "Upload failed");
			} finally {
				uppy.removeFile(file.id);
			}
		};
		const handleError = (
			file: { id: string; name?: string } | undefined,
			error: { message?: string },
		) => {
			if (!file) return;
			fail(file.name ?? "payslip.pdf", error?.message || "Upload failed");
			uppy.removeFile(file.id);
		};

		uppy.on("upload-success", handleSuccess);
		uppy.on("upload-error", handleError);
		return () => {
			uppy.off("upload-success", handleSuccess);
			uppy.off("upload-error", handleError);
			uppy.destroy();
			if (uppyRef.current === uppy) uppyRef.current = null;
		};
	}, [batchId]);

	const addFiles = (files: readonly File[]) => {
		const uppy = uppyRef.current;
		if (!uppy) return;
		setProgress((current) =>
			current.staged + current.failed.length >= current.total
				? { total: files.length, staged: 0, failed: [] }
				: { ...current, total: current.total + files.length },
		);
		for (const file of files) {
			try {
				uppy.addFile({
					name: file.name,
					type: "application/pdf",
					data: file,
					meta: { purpose: "payslip-batch" },
				});
			} catch (error) {
				const id = crypto.randomUUID();
				setProgress((current) => ({
					...current,
					failed: [
						...current.failed,
						{
							id,
							fileName: file.name,
							error: error instanceof Error ? error.message : "Upload failed",
						},
					],
				}));
			}
		}
	};

	const isUploading = progress.staged + progress.failed.length < progress.total;
	return { addFiles, progress, isUploading };
}
