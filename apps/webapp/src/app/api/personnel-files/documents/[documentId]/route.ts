import { createHash } from "node:crypto";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import { getAuditContextFromRequest } from "@/lib/middleware/audit-context";
import { isOwnDocument } from "@/lib/personnel-file/access";
import { writeDocumentAudit } from "@/lib/personnel-file/audit";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { isPersonnelDocumentMime } from "@/lib/personnel-file/document.types";
import {
	loadVisibleDocument,
	PERSONNEL_DOCUMENT_STORAGE_PROVIDER,
} from "@/lib/personnel-file/document-store";
import {
	loadPersonnelDocumentPreview,
	PERSONNEL_DOCUMENT_PREVIEW_MIME_TYPE,
} from "@/lib/personnel-file/storage";
import { readPrivateObject } from "@/lib/storage/export-s3-client";

const logger = createLogger("PersonnelFileDocument");
const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
};

function notFound() {
	return NextResponse.json(
		{ error: "Document not found" },
		{ status: 404, headers: privateHeaders },
	);
}

/**
 * Serves an employee document (#865) like the hardened receipt route: only to
 * actors the personnel file access resolver lets see it (owners and admins,
 * and the employee for their shared documents); everyone else, and everyone
 * while personnel files are off, gets a not-found. The stored object is
 * refused unless its size and sha256 still match the recorded identity.
 * Every view or download by someone other than the employee is audited
 * before the content leaves. `?variant=thumb` serves a small image preview,
 * `?download=1` an attachment.
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ documentId: string }> },
) {
	await connection();
	try {
		const { documentId } = await params;
		if (!z.uuid().safeParse(documentId).success) return notFound();
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status === "unauthenticated") {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
		}
		if (current.status !== "resolved") return notFound();
		const { access } = current;
		const { searchParams } = new URL(request.url);
		const variant = searchParams.get("variant");
		if (variant !== null && variant !== "thumb") return notFound();

		const document = await loadVisibleDocument(db, access, documentId);
		if (!document) return notFound();
		if (document.storageProvider !== PERSONNEL_DOCUMENT_STORAGE_PROVIDER) {
			throw new Error("Unsupported recorded document storage provider");
		}

		const readOriginal = async () => {
			const bytes = await readPrivateObject({
				organizationId: document.organizationId,
				key: document.storageKey,
				bucket: document.storageBucket,
				versionId: document.storageVersionId,
			});
			if (
				bytes.byteLength !== document.sizeBytes ||
				createHash("sha256").update(bytes).digest("hex") !== document.checksumSha256
			) {
				throw new Error("Stored document content does not match its recorded identity");
			}
			return bytes;
		};
		const mimeType = isPersonnelDocumentMime(document.mimeType)
			? document.mimeType
			: "application/octet-stream";
		const download = searchParams.get("download") === "1";

		// Verified before the audit record, so a refused file is not logged as served.
		const original = variant === "thumb" ? null : await readOriginal();

		if (!isOwnDocument(access, document.employeeId)) {
			const auditContext = getAuditContextFromRequest(request);
			await writeDocumentAudit(db, {
				action: download
					? AuditAction.PERSONNEL_FILE_DOCUMENT_DOWNLOADED
					: AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED,
				actorUserId: access.userId,
				document,
				metadata: { variant: variant ?? "original" },
				ipAddress: auditContext.ipAddress,
				userAgent: auditContext.userAgent,
			});
		}

		if (variant === "thumb") {
			const preview = await loadPersonnelDocumentPreview({
				organizationId: document.organizationId,
				key: document.storageKey,
				bucket: document.storageBucket,
				versionId: document.storageVersionId,
				mimeType,
				readOriginal,
			});
			if (!preview) return notFound();
			return new Response(new Uint8Array(preview), {
				headers: {
					...privateHeaders,
					"Content-Type": PERSONNEL_DOCUMENT_PREVIEW_MIME_TYPE,
					"Content-Disposition": "inline",
					"Content-Security-Policy": "sandbox",
				},
			});
		}

		const bytes = original ?? (await readOriginal());
		const disposition =
			download || mimeType === "application/octet-stream" ? "attachment" : "inline";
		const encodedName = encodeURIComponent(document.fileName).replace(
			/['()*]/g,
			(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
		);
		return new Response(new Uint8Array(bytes), {
			headers: {
				...privateHeaders,
				"Content-Type": mimeType,
				"Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
				"Content-Security-Policy": "sandbox",
			},
		});
	} catch (error) {
		logger.error({ error }, "Failed to retrieve employee document");
		return NextResponse.json(
			{ error: "Document unavailable. Please retry." },
			{ status: 503, headers: privateHeaders },
		);
	}
}
