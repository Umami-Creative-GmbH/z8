import { randomUUID } from "node:crypto";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import {
	canManageDocument,
	canUploadOwnDocument,
	isOwnDocument,
	managedCategoriesFor,
} from "@/lib/personnel-file/access";
import { loadEmployeeRef } from "@/lib/personnel-file/access-store";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { DEFAULT_VISIBILITY, isDocumentCategory } from "@/lib/personnel-file/document.types";
import { validateDocumentMetadata } from "@/lib/personnel-file/document-rules";
import {
	finalizePersonnelDocumentUpload,
	personnelDocumentStorageKey,
} from "@/lib/personnel-file/document-store";
import { notifyDocumentShared, notifyEmployeeUpload } from "@/lib/personnel-file/notifications";
import {
	deletePersonnelDocumentObject,
	deleteTusUpload,
	readUploadedPersonnelDocument,
} from "@/lib/personnel-file/storage";
import {
	markPersonnelFileUploadFailed,
	runPersonnelFileCleanup,
	type StoredPersonnelFileObject,
	stagePersonnelFileUpload,
} from "@/lib/personnel-file/upload-ledger";
import { uploadPrivateObject } from "@/lib/storage/export-s3-client";
import { sanitizeTusFileKey } from "@/lib/upload/tus-ownership";

const logger = createLogger("PersonnelFileUpload");

const requestSchema = z.object({
	tusFileKey: z.string().min(1),
	employeeId: z.uuid(),
	/** "own": the employee uploads into their own file (#867). */
	source: z.literal("own").optional(),
	fileName: z.string().max(255).optional(),
	metadata: z.object({
		category: z.unknown(),
		title: z.unknown(),
		documentDate: z.unknown(),
		payPeriod: z.unknown().optional(),
		visibility: z.unknown().optional(),
		expiryDate: z.unknown().optional(),
	}),
});

function notFound() {
	return NextResponse.json({ error: "Employee not found" }, { status: 404 });
}

/**
 * Records a finished TUS upload as an employee document in a personnel file
 * (#865). Only actors the personnel file access resolver lets manage the
 * document's category for that employee may upload; everyone else, and
 * everyone while personnel files are off, gets a not-found.
 *
 * With `source: "own"` the employee uploads into their own file (#867): only
 * certificates and other documents, always shared, and the covering officers
 * (or owners and admins) are notified instead of the employee.
 */
export async function POST(request: NextRequest) {
	await connection();

	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status === "unauthenticated") {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}
		if (current.status !== "resolved") return notFound();
		const { access } = current;

		const parsed = requestSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
		}
		const { tusFileKey, employeeId, fileName, metadata } = parsed.data;
		const own = parsed.data.source === "own";

		const employee = await loadEmployeeRef(db, {
			organizationId: access.organizationId,
			employeeId,
		});
		// Nothing tells someone without access whether the employee exists.
		if (!employee) return notFound();
		if (
			own ? !isOwnDocument(access, employee.id) : managedCategoriesFor(access, employee).size === 0
		)
			return notFound();

		const validated = validateDocumentMetadata({
			...metadata,
			payPeriod: metadata.payPeriod ?? null,
			expiryDate: metadata.expiryDate ?? null,
			// Employee uploads are always shared; the employee chooses no visibility.
			visibility: own
				? "shared"
				: (metadata.visibility ??
					(isDocumentCategory(metadata.category) ? DEFAULT_VISIBILITY[metadata.category] : null)),
		});
		if (!validated.ok) {
			return NextResponse.json(
				{ error: validated.message, field: validated.field },
				{ status: 400 },
			);
		}
		if (own) {
			if (!canUploadOwnDocument(access, employee.id, validated.value.category)) {
				return NextResponse.json(
					{ error: "You can upload only certificates and other documents.", field: "category" },
					{ status: 403 },
				);
			}
		} else if (!canManageDocument(access, employee, validated.value.category)) {
			return notFound();
		}

		const safeTusFileKey = sanitizeTusFileKey(tusFileKey, access.userId);
		if (!safeTusFileKey) {
			return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
		}

		const upload = await readUploadedPersonnelDocument({ tusFileKey: safeTusFileKey, fileName });
		if (!upload.ok) {
			return NextResponse.json({ error: upload.error }, { status: upload.status });
		}

		const documentId = randomUUID();
		const staged = {
			documentId,
			organizationId: access.organizationId,
			employeeId: employee.id,
			uploadedBy: access.userId,
			storageKey: personnelDocumentStorageKey({
				organizationId: access.organizationId,
				employeeId: employee.id,
				documentId,
				fileName: upload.fileName,
			}),
		};

		// Durable before the object exists, so any later failure leaves cleanup work.
		await stagePersonnelFileUpload(db, staged);

		let stored: StoredPersonnelFileObject | null = null;
		let finalized: Awaited<ReturnType<typeof finalizePersonnelDocumentUpload>>;
		try {
			stored = await uploadPrivateObject(
				access.organizationId,
				staged.storageKey,
				upload.buffer,
				upload.mimeType,
				{
					"uploaded-by": access.userId,
					"original-key": safeTusFileKey,
					"upload-timestamp": new Date().toISOString(),
					"content-sha256": upload.checksumSha256,
				},
			);
			finalized = await finalizePersonnelDocumentUpload(db, {
				...staged,
				metadata: validated.value,
				stored,
				fileName: upload.fileName,
				mimeType: upload.mimeType,
				sizeBytes: upload.buffer.length,
				checksumSha256: upload.checksumSha256,
				...(own ? { source: "employee" as const } : {}),
			});
		} catch (error) {
			await markPersonnelFileUploadFailed(db, {
				...staged,
				stored,
				reason: "finalization_failed",
			}).catch((markError) =>
				logger.error({ error: markError }, "Failed to record personnel file upload cleanup"),
			);
			throw error;
		}

		await deleteTusUpload(safeTusFileKey);

		if (finalized.kind === "not_pending") {
			// Cleanup claimed the staged object meanwhile (a very slow upload).
			await runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
				only: { documentId, organizationId: access.organizationId },
			}).catch((error) => logger.error({ error }, "Deferred personnel file upload cleanup"));
			return NextResponse.json(
				{ error: "The upload took too long. Please upload the file again." },
				{ status: 409 },
			);
		}

		if (own) {
			await notifyEmployeeUpload(db, {
				organizationId: access.organizationId,
				document: finalized.document,
			});
		} else if (finalized.shareEventId) {
			await notifyDocumentShared(db, {
				organizationId: access.organizationId,
				shareEventId: finalized.shareEventId,
				document: finalized.document,
			});
		}

		return NextResponse.json({ success: true, document: finalized.document });
	} catch (error) {
		logger.error({ error }, "Personnel file upload processing failed");
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
