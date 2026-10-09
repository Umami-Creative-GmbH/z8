import { randomUUID } from "node:crypto";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { PAYSLIP_BATCH_MAX_FILES } from "@/lib/personnel-file/payslip-batch.types";
import {
	canRunPayslipBatches,
	payslipBatchStorageKey,
	recordPayslipBatchFile,
	reservePayslipBatchFile,
} from "@/lib/personnel-file/payslip-batch-store";
import {
	deletePersonnelDocumentObject,
	deleteTusUpload,
	readUploadedPayslip,
} from "@/lib/personnel-file/storage";
import {
	markPersonnelFileUploadFailed,
	runPersonnelFileCleanup,
	type StoredPersonnelFileObject,
} from "@/lib/personnel-file/upload-ledger";
import { uploadPrivateObject } from "@/lib/storage/export-s3-client";
import { sanitizeTusFileKey } from "@/lib/upload/tus-ownership";

const logger = createLogger("PayslipBatchUpload");

const FILE_NAME_MAX_LENGTH = 255;

const requestSchema = z.object({
	batchId: z.uuid(),
	tusFileKey: z.string().min(1),
	fileName: z.string().max(FILE_NAME_MAX_LENGTH).optional(),
});

function notFound() {
	return NextResponse.json({ error: "Payslip batch not found" }, { status: 404 });
}

/**
 * Stages a finished TUS upload as a file of a payslip batch (#868) and matches
 * it to an employee by personnel number. The file is stored privately but is
 * no employee document until the officer confirms the batch; its pending
 * upload ledger row makes sure an unconfirmed file is cleaned up.
 */
export async function POST(request: NextRequest) {
	await connection();

	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status === "unauthenticated") {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}
		if (current.status !== "resolved" || !canRunPayslipBatches(current.access)) return notFound();
		const { access } = current;

		const parsed = requestSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
		}
		const { batchId, tusFileKey } = parsed.data;

		const safeTusFileKey = sanitizeTusFileKey(tusFileKey, access.userId);
		if (!safeTusFileKey) {
			return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
		}

		const upload = await readUploadedPayslip({
			tusFileKey: safeTusFileKey,
			fileName: parsed.data.fileName,
		});
		if (!upload.ok) {
			return NextResponse.json({ error: upload.error }, { status: upload.status });
		}
		const originalFileName =
			(parsed.data.fileName?.split(/[/\\]/).pop() ?? "").trim() || upload.fileName;

		const fileId = randomUUID();
		const storageKey = payslipBatchStorageKey({
			organizationId: access.organizationId,
			batchId,
			fileId,
			fileName: upload.fileName,
		});

		// Durable before the object exists, so any later failure leaves cleanup work.
		const reserved = await reservePayslipBatchFile(db, access, { batchId, fileId, storageKey });
		switch (reserved.kind) {
			case "not_found":
				return notFound();
			case "closed":
				return NextResponse.json(
					{ error: "This payslip batch was already confirmed." },
					{ status: 409 },
				);
			case "full":
				return NextResponse.json(
					{ error: `A payslip batch holds at most ${PAYSLIP_BATCH_MAX_FILES} files.` },
					{ status: 409 },
				);
			case "reserved":
				break;
		}

		const staged = {
			documentId: fileId,
			organizationId: access.organizationId,
			employeeId: null,
			batchId,
			uploadedBy: access.userId,
			storageKey,
		};
		let stored: StoredPersonnelFileObject | null = null;
		let recorded: Awaited<ReturnType<typeof recordPayslipBatchFile>>;
		try {
			stored = await uploadPrivateObject(
				access.organizationId,
				storageKey,
				upload.buffer,
				upload.mimeType,
				{
					"uploaded-by": access.userId,
					"original-key": safeTusFileKey,
					"upload-timestamp": new Date().toISOString(),
					"content-sha256": upload.checksumSha256,
				},
			);
			recorded = await recordPayslipBatchFile(db, access, {
				batchId,
				fileId,
				storageKey,
				originalFileName,
				fileName: upload.fileName,
				mimeType: upload.mimeType,
				sizeBytes: upload.buffer.length,
				checksumSha256: upload.checksumSha256,
				stored,
			});
		} catch (error) {
			await markPersonnelFileUploadFailed(db, {
				...staged,
				stored,
				reason: "finalization_failed",
			}).catch((markError) =>
				logger.error({ error: markError }, "Failed to record payslip batch upload cleanup"),
			);
			throw error;
		}

		await deleteTusUpload(safeTusFileKey);

		if (recorded.kind === "not_pending") {
			// Cleanup claimed the staged object meanwhile (a very slow upload).
			await runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
				only: { documentId: fileId, organizationId: access.organizationId },
			}).catch((error) => logger.error({ error }, "Deferred payslip batch upload cleanup"));
			return NextResponse.json(
				{ error: "The upload took too long. Please upload the file again." },
				{ status: 409 },
			);
		}

		return NextResponse.json({
			success: true,
			file: { id: recorded.fileId, matchKind: recorded.matchKind },
		});
	} catch (error) {
		logger.error({ error }, "Payslip batch upload processing failed");
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
