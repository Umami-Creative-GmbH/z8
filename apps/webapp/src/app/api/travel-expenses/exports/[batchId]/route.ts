import { createHash } from "node:crypto";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import { readPrivateObject } from "@/lib/storage/export-s3-client";
import { loadCompletedTravelExpenseExportFile } from "@/lib/travel-expenses/export-store";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";

const logger = createLogger("TravelExpenseExportDownload");
const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
};

function notFound() {
	return NextResponse.json({ error: "Export not found" }, { status: 404, headers: privateHeaders });
}

/**
 * Streams the stored ZIP of a completed travel expense export batch (#613) to
 * a user with the export and finance read permissions in the batch's organization, after
 * verifying the recorded size and SHA-256. Downloading again returns the same
 * file and records nothing but an audit entry: it is never a reimbursement.
 */
export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ batchId: string }> },
) {
	await connection();
	try {
		const { batchId } = await params;
		if (!z.uuid().safeParse(batchId).success) return notFound();
		const actor = await loadFinanceActor();
		if (!actor) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
		}
		// Export and finance read: the ZIP holds the organization's receipts.
		if (!actor.canExport || !actor.canRead) return notFound();
		const file = await loadCompletedTravelExpenseExportFile(db, {
			organizationId: actor.organizationId,
			batchId,
		});
		if (!file) return notFound();
		const bytes = await readPrivateObject({
			organizationId: actor.organizationId,
			key: file.key,
			bucket: file.bucket,
			versionId: file.versionId,
		});
		if (
			bytes.byteLength !== file.sizeBytes ||
			createHash("sha256").update(bytes).digest("hex") !== file.checksumSha256
		) {
			throw new Error("Stored export does not match its recorded identity");
		}
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_EXPORT_DOWNLOADED,
			actorId: actor.userId,
			targetId: batchId,
			targetType: "travel_expense_export",
			organizationId: actor.organizationId,
			metadata: { checksumSha256: file.checksumSha256 },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to audit an export download"));
		const encodedName = encodeURIComponent(file.fileName);
		return new Response(new Uint8Array(bytes), {
			headers: {
				...privateHeaders,
				"Content-Type": "application/zip",
				"Content-Length": String(bytes.byteLength),
				"Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
				ETag: `"${file.checksumSha256}"`,
			},
		});
	} catch (error) {
		logger.error({ error }, "Failed to download a travel expense export");
		return NextResponse.json(
			{ error: "Export unavailable. Please retry." },
			{ status: 503, headers: privateHeaders },
		);
	}
}
