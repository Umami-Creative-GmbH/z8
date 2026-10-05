import { randomUUID } from "node:crypto";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { env } from "@/env";
import { getAuthContext } from "@/lib/auth-helpers";
import { deletePrivateObject, uploadPrivateObject } from "@/lib/storage/export-s3-client";
import { deleteTusUpload, readUploadedReceipt } from "@/lib/travel-expenses/receipt-processing";
import {
	runTravelExpenseReceiptCleanup,
	type StoredReceiptObject,
} from "@/lib/travel-expenses/receipt-upload";
import {
	finalizeReportReceiptUpload,
	markReportReceiptUploadFailed,
	stageReportReceiptUpload,
	travelExpenseReportReceiptStorageKey,
} from "@/lib/travel-expenses/report-receipt-upload";
import { isOwnDraftReportItem } from "@/lib/travel-expenses/report-store";
import { sanitizeTusFileKey } from "@/lib/upload/tus-ownership";

const MAX_FILE_SIZE_BYTES = Number(env.TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES);

const requestSchema = z.object({
	tusFileKey: z.string().min(1),
	reportId: z.uuid(),
	itemId: z.uuid(),
	fileName: z.string().max(255).optional(),
});

/** Attaches a finished TUS upload to an item of the caller's draft report (#600). */
export async function POST(request: NextRequest) {
	await connection();

	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}

		const parsed = requestSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
		}
		const { tusFileKey, reportId, itemId, fileName } = parsed.data;

		const safeTusFileKey = sanitizeTusFileKey(tusFileKey, authContext.user.id);
		if (!safeTusFileKey) {
			return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
		}

		const owner = {
			organizationId: authContext.employee.organizationId,
			employeeId: authContext.employee.id,
		};
		if (!(await isOwnDraftReportItem(db, owner, { reportId, itemId }))) {
			return NextResponse.json({ error: "Expense report not found" }, { status: 404 });
		}

		const upload = await readUploadedReceipt({
			tusFileKey: safeTusFileKey,
			fileName,
			maxBytes: MAX_FILE_SIZE_BYTES,
		});
		if (!upload.ok) {
			return NextResponse.json({ error: upload.error }, { status: upload.status });
		}

		const receiptId = randomUUID();
		const staged = {
			receiptId,
			organizationId: owner.organizationId,
			reportId,
			itemId,
			uploadedBy: owner.employeeId,
			userId: authContext.user.id,
			storageKey: travelExpenseReportReceiptStorageKey({
				organizationId: owner.organizationId,
				reportId,
				itemId,
				receiptId,
				fileName: upload.fileName,
			}),
		};

		// Durable before the object exists, so any later failure leaves cleanup work.
		await stageReportReceiptUpload(db, staged);

		let stored: StoredReceiptObject | null = null;
		let finalized: Awaited<ReturnType<typeof finalizeReportReceiptUpload>>;
		try {
			stored = await uploadPrivateObject(
				owner.organizationId,
				staged.storageKey,
				upload.buffer,
				upload.mimeType,
				{
					"uploaded-by": owner.employeeId,
					"original-key": safeTusFileKey,
					"upload-timestamp": new Date().toISOString(),
					"content-sha256": upload.checksumSha256,
				},
			);
			finalized = await finalizeReportReceiptUpload(db, {
				...staged,
				stored,
				fileName: upload.fileName,
				mimeType: upload.mimeType,
				sizeBytes: upload.buffer.length,
				checksumSha256: upload.checksumSha256,
			});
		} catch (error) {
			await markReportReceiptUploadFailed(db, {
				...staged,
				stored,
				reason: "finalization_failed",
			}).catch((markError) =>
				console.error("Failed to record report receipt upload cleanup", markError),
			);
			throw error;
		}

		await deleteTusUpload(safeTusFileKey);

		if (finalized.kind === "report_not_draft") {
			// The report changed while this file was uploading. The stored object
			// stays recorded for cleanup; try to remove it right away.
			await runTravelExpenseReceiptCleanup(db, {
				deleteObject: deletePrivateObject,
				only: { attachmentId: receiptId, organizationId: owner.organizationId },
			}).catch((error) => console.error("Deferred report receipt upload cleanup", error));
			return NextResponse.json(
				{ error: "This expense can no longer be edited, so the file was not attached." },
				{ status: 409 },
			);
		}

		return NextResponse.json({ success: true, receipt: finalized.receipt });
	} catch (error) {
		console.error("Report receipt upload processing failed", error);
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
