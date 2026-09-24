import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { travelExpenseClaim } from "@/db/schema";
import { env } from "@/env";
import { getAuthContext } from "@/lib/auth-helpers";
import { deletePrivateObject, uploadPrivateObject } from "@/lib/storage/export-s3-client";
import { S3_PUBLIC_BUCKET, s3Client } from "@/lib/storage/s3-client";
import { isAllowedTravelExpenseMime } from "@/lib/travel-expenses/attachment-validation";
import {
	finalizeTravelExpenseReceiptUpload,
	markTravelExpenseReceiptUploadFailed,
	runTravelExpenseReceiptCleanup,
	type StoredReceiptObject,
	stageTravelExpenseReceiptUpload,
	travelExpenseReceiptStorageKey,
} from "@/lib/travel-expenses/receipt-upload";
import { sanitizeTusFileKey } from "@/lib/upload/tus-ownership";

const MAX_FILE_SIZE_BYTES = Number(env.TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES);

function formatFileSize(bytes: number): string {
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

interface ProcessTravelExpenseUploadRequest {
	tusFileKey: string;
	claimId: string;
	fileName?: string;
}

function sanitizeFileName(fileName: string): string {
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

export async function POST(request: NextRequest) {
	await connection();

	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}

		const body = (await request.json()) as ProcessTravelExpenseUploadRequest;
		const { tusFileKey, claimId, fileName } = body;

		if (!tusFileKey || !claimId) {
			return NextResponse.json(
				{ error: "Missing tusFileKey or claimId" },
				{ status: 400 },
			);
		}

		const safeTusFileKey = sanitizeTusFileKey(tusFileKey, authContext.user.id);
		if (!safeTusFileKey) {
			return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
		}

		const claim = await db.query.travelExpenseClaim.findFirst({
			where: and(
				eq(travelExpenseClaim.id, claimId),
				eq(
					travelExpenseClaim.organizationId,
					authContext.employee.organizationId,
				),
				eq(travelExpenseClaim.employeeId, authContext.employee.id),
				eq(travelExpenseClaim.status, "draft"),
			),
			columns: { id: true, organizationId: true, status: true },
		});

		if (claim?.status !== "draft") {
			return NextResponse.json(
				{ error: "Travel expense claim not found" },
				{ status: 404 },
			);
		}

		const getResponse = await s3Client.send(
			new GetObjectCommand({
				Bucket: S3_PUBLIC_BUCKET,
				Key: safeTusFileKey,
			}),
		);

		if (
			getResponse.ContentLength &&
			getResponse.ContentLength > MAX_FILE_SIZE_BYTES
		) {
			return NextResponse.json(
				{
					error: `File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE_BYTES)}`,
				},
				{ status: 413 },
			);
		}

		const byteArray = await getResponse.Body?.transformToByteArray();
		if (!byteArray) {
			return NextResponse.json(
				{ error: "Failed to read uploaded file" },
				{ status: 500 },
			);
		}

		const buffer = Buffer.from(byteArray);
		if (buffer.length > MAX_FILE_SIZE_BYTES) {
			return NextResponse.json(
				{
					error: `File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE_BYTES)}`,
				},
				{ status: 413 },
			);
		}

		const detectedType = await fileTypeFromBuffer(buffer);
		if (!detectedType || !isAllowedTravelExpenseMime(detectedType.mime)) {
			return NextResponse.json(
				{ error: "Unsupported file type" },
				{ status: 400 },
			);
		}

		const providedName = fileName?.trim() || `attachment.${detectedType.ext}`;
		const safeName = sanitizeFileName(providedName);
		const finalName = safeName.includes(".")
			? safeName
			: `${safeName}.${detectedType.ext}`;
		// The server computes the content identity over the exact bytes it stores.
		const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
		const attachmentId = randomUUID();
		const staged = {
			attachmentId,
			organizationId: claim.organizationId,
			claimId: claim.id,
			uploadedBy: authContext.employee.id,
			storageKey: travelExpenseReceiptStorageKey({
				organizationId: claim.organizationId,
				claimId: claim.id,
				attachmentId,
				fileName: finalName,
			}),
		};

		// Durable before the object exists, so any later failure leaves cleanup work.
		await stageTravelExpenseReceiptUpload(db, staged);

		let stored: StoredReceiptObject | null = null;
		let finalized: Awaited<ReturnType<typeof finalizeTravelExpenseReceiptUpload>>;
		try {
			stored = await uploadPrivateObject(
				claim.organizationId,
				staged.storageKey,
				buffer,
				detectedType.mime,
				{
					"uploaded-by": authContext.employee.id,
					"original-key": safeTusFileKey,
					"upload-timestamp": new Date().toISOString(),
					"content-sha256": checksumSha256,
				},
			);
			finalized = await finalizeTravelExpenseReceiptUpload(db, {
				...staged,
				stored,
				fileName: finalName,
				mimeType: detectedType.mime,
				sizeBytes: buffer.length,
				checksumSha256,
			});
		} catch (error) {
			await markTravelExpenseReceiptUploadFailed(db, {
				...staged,
				stored,
				reason: "finalization_failed",
			}).catch((markError) =>
				console.error("Failed to record travel expense upload cleanup", markError),
			);
			throw error;
		}

		await s3Client
			.send(
				new DeleteObjectCommand({
					Bucket: S3_PUBLIC_BUCKET,
					Key: safeTusFileKey,
				}),
			)
			.catch((error) =>
				console.error("Failed to delete processed travel expense upload", error),
			);

		if (finalized.kind === "claim_not_draft") {
			// The claim was submitted while this file was uploading. The stored
			// object stays recorded for cleanup; try to remove it right away.
			await runTravelExpenseReceiptCleanup(db, {
				deleteObject: deletePrivateObject,
				only: {
					attachmentId: staged.attachmentId,
					organizationId: staged.organizationId,
				},
			}).catch((error) =>
				console.error("Deferred travel expense upload cleanup", error),
			);
			return NextResponse.json(
				{
					error:
						"This claim is no longer a draft, so the file was not attached. Create a new claim to submit a different receipt set.",
				},
				{ status: 409 },
			);
		}

		const createdAttachment = finalized.attachment;
		return NextResponse.json({
			success: true,
			attachment: {
				id: createdAttachment.id,
				fileName: createdAttachment.fileName,
				mimeType: createdAttachment.mimeType ?? detectedType.mime,
				sizeBytes: createdAttachment.sizeBytes ?? buffer.length,
				storageKey: createdAttachment.storageKey,
			},
		});
	} catch (error) {
		console.error("Travel expense upload processing failed", error);
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
