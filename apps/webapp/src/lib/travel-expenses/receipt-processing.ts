import "server-only";
import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { fileTypeFromBuffer } from "file-type";
import { S3_PUBLIC_BUCKET, s3Client } from "@/lib/storage/s3-client";
import { isAllowedTravelExpenseMime } from "./attachment-validation";

/**
 * Reads a finished TUS upload and validates the actual bytes of a receipt:
 * size limit, detected content type and a server-computed checksum. Shared by
 * legacy claim and report receipt processing.
 */

export function formatFileSize(bytes: number): string {
	const units = ["bytes", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && size % 1024 === 0 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return unitIndex === 0
		? `${size} ${size === 1 ? "byte" : "bytes"}`
		: `${size}${units[unitIndex]}`;
}

export function sanitizeReceiptFileName(fileName: string): string {
	const baseName = fileName.split(/[/\\]/).pop() ?? "attachment";
	const normalized = baseName
		.replace(/\s+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^[-_.]+|[-_.]+$/g, "");

	if (!normalized) {
		return "attachment";
	}

	return normalized.slice(0, 120);
}

export type ReadUploadedReceiptResult =
	| {
			ok: true;
			buffer: Buffer;
			mimeType: string;
			fileName: string;
			checksumSha256: string;
	  }
	| { ok: false; status: 400 | 413 | 500; error: string };

export async function readUploadedReceipt(input: {
	/** An already ownership-checked TUS file key. */
	tusFileKey: string;
	fileName: string | undefined;
	maxBytes: number;
}): Promise<ReadUploadedReceiptResult> {
	const tooLarge = {
		ok: false,
		status: 413,
		error: `File too large. Maximum size is ${formatFileSize(input.maxBytes)}`,
	} as const;
	const getResponse = await s3Client.send(
		new GetObjectCommand({ Bucket: S3_PUBLIC_BUCKET, Key: input.tusFileKey }),
	);
	if (getResponse.ContentLength && getResponse.ContentLength > input.maxBytes) {
		return tooLarge;
	}

	const byteArray = await getResponse.Body?.transformToByteArray();
	if (!byteArray) {
		return { ok: false, status: 500, error: "Failed to read uploaded file" };
	}

	const buffer = Buffer.from(byteArray);
	if (buffer.length > input.maxBytes) {
		return tooLarge;
	}

	const detectedType = await fileTypeFromBuffer(buffer);
	if (!detectedType || !isAllowedTravelExpenseMime(detectedType.mime)) {
		return { ok: false, status: 400, error: "Unsupported file type" };
	}

	const providedName = input.fileName?.trim() || `attachment.${detectedType.ext}`;
	const safeName = sanitizeReceiptFileName(providedName);
	return {
		ok: true,
		buffer,
		mimeType: detectedType.mime,
		fileName: safeName.includes(".") ? safeName : `${safeName}.${detectedType.ext}`,
		// The server computes the content identity over the exact bytes it stores.
		checksumSha256: createHash("sha256").update(buffer).digest("hex"),
	};
}

/** Best effort: the temporary upload is no longer needed once processed. */
export async function deleteTusUpload(tusFileKey: string): Promise<void> {
	await s3Client
		.send(new DeleteObjectCommand({ Bucket: S3_PUBLIC_BUCKET, Key: tusFileKey }))
		.catch((error) => console.error("Failed to delete processed travel expense upload", error));
}
