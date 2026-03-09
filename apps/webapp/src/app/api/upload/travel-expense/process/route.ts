import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { NextResponse, type NextRequest, connection } from "next/server";
import { db } from "@/db";
import { travelExpenseAttachment, travelExpenseClaim } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import { S3_BUCKET, s3Client } from "@/lib/storage/s3-client";
import { isAllowedTravelExpenseMime } from "@/lib/travel-expenses/attachment-validation";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface ProcessTravelExpenseUploadRequest {
	tusFileKey: string;
	claimId: string;
	fileName?: string;
}

function isValidTusFileKey(key: string): boolean {
	return !key.includes("..") && !key.includes("/") && !key.includes("\\") && key.length > 0;
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
			return NextResponse.json({ error: "Missing tusFileKey or claimId" }, { status: 400 });
		}

		if (!isValidTusFileKey(tusFileKey)) {
			return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
		}

		const claim = await db.query.travelExpenseClaim.findFirst({
			where: and(
				eq(travelExpenseClaim.id, claimId),
				eq(travelExpenseClaim.organizationId, authContext.employee.organizationId),
				eq(travelExpenseClaim.employeeId, authContext.employee.id),
			),
			columns: { id: true, organizationId: true },
		});

		if (!claim) {
			return NextResponse.json({ error: "Travel expense claim not found" }, { status: 404 });
		}

		const getResponse = await s3Client.send(
			new GetObjectCommand({
				Bucket: S3_BUCKET,
				Key: tusFileKey,
			}),
		);

		if (getResponse.ContentLength && getResponse.ContentLength > MAX_FILE_SIZE_BYTES) {
			return NextResponse.json({ error: "File too large. Maximum size is 10MB" }, { status: 413 });
		}

		const byteArray = await getResponse.Body?.transformToByteArray();
		if (!byteArray) {
			return NextResponse.json({ error: "Failed to read uploaded file" }, { status: 500 });
		}

		const buffer = Buffer.from(byteArray);
		if (buffer.length > MAX_FILE_SIZE_BYTES) {
			return NextResponse.json({ error: "File too large. Maximum size is 10MB" }, { status: 413 });
		}

		const detectedType = await fileTypeFromBuffer(buffer);
		if (!detectedType || !isAllowedTravelExpenseMime(detectedType.mime)) {
			return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
		}

		const providedName = fileName?.trim() || `attachment.${detectedType.ext}`;
		const safeName = sanitizeFileName(providedName);
		const finalName = safeName.includes(".") ? safeName : `${safeName}.${detectedType.ext}`;
		const timestamp = Date.now();
		const finalStorageKey = `travel-expenses/${claim.organizationId}/${claim.id}/${timestamp}-${finalName}`;

		await s3Client.send(
			new PutObjectCommand({
				Bucket: S3_BUCKET,
				Key: finalStorageKey,
				Body: buffer,
				ContentType: detectedType.mime,
				Metadata: {
					"uploaded-by": authContext.employee.id,
					"original-key": tusFileKey,
					"upload-timestamp": new Date().toISOString(),
				},
			}),
		);

		const [createdAttachment] = await db
			.insert(travelExpenseAttachment)
			.values({
				organizationId: claim.organizationId,
				claimId: claim.id,
				storageProvider: "s3",
				storageBucket: S3_BUCKET,
				storageKey: finalStorageKey,
				fileName: finalName,
				mimeType: detectedType.mime,
				sizeBytes: buffer.length,
				uploadedBy: authContext.employee.id,
			})
			.returning({
				id: travelExpenseAttachment.id,
				fileName: travelExpenseAttachment.fileName,
				mimeType: travelExpenseAttachment.mimeType,
				sizeBytes: travelExpenseAttachment.sizeBytes,
				storageKey: travelExpenseAttachment.storageKey,
			});

		if (!createdAttachment) {
			return NextResponse.json({ error: "Failed to create attachment record" }, { status: 500 });
		}

		await s3Client.send(
			new DeleteObjectCommand({
				Bucket: S3_BUCKET,
				Key: tusFileKey,
			}),
		);

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
