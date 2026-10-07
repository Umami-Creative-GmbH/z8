import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { travelExpenseClaim } from "@/db/schema";
import { env } from "@/env";
import { getAuthContext } from "@/lib/auth-helpers";
import { uploadPrivateObject } from "@/lib/storage/export-s3-client";
import { deleteTravelExpenseReceiptObject } from "@/lib/travel-expenses/receipt-preview";
import {
	deleteTusUpload,
	readUploadedReceipt,
} from "@/lib/travel-expenses/receipt-processing";
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

interface ProcessTravelExpenseUploadRequest {
	tusFileKey: string;
	claimId: string;
	fileName?: string;
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

		const upload = await readUploadedReceipt({
			tusFileKey: safeTusFileKey,
			fileName,
			maxBytes: MAX_FILE_SIZE_BYTES,
		});
		if (!upload.ok) {
			return NextResponse.json({ error: upload.error }, { status: upload.status });
		}
		const { buffer, checksumSha256, fileName: finalName, mimeType } = upload;
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
				mimeType,
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
				mimeType,
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

		await deleteTusUpload(safeTusFileKey);

		if (finalized.kind === "claim_not_draft") {
			// The claim was submitted while this file was uploading. The stored
			// object stays recorded for cleanup; try to remove it right away.
			await runTravelExpenseReceiptCleanup(db, {
				deleteObject: deleteTravelExpenseReceiptObject,
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
				mimeType: createdAttachment.mimeType ?? mimeType,
				sizeBytes: createdAttachment.sizeBytes ?? buffer.length,
				storageKey: createdAttachment.storageKey,
			},
		});
	} catch (error) {
		console.error("Travel expense upload processing failed", error);
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
