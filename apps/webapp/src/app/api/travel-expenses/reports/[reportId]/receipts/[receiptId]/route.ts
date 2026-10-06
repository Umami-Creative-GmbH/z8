import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { travelExpenseReportReceipt } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { readPrivateObject } from "@/lib/storage/export-s3-client";
import {
	isAllowedTravelExpenseMime,
	TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER,
} from "@/lib/travel-expenses/attachment-validation";
import {
	loadAuthorizedTravelExpenseReport,
	loadSubmittedReportReceipt,
} from "@/lib/travel-expenses/report-read";

const logger = createLogger("TravelExpenseReportReceipt");
const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
};

function notFound() {
	return NextResponse.json(
		{ error: "Receipt not found" },
		{ status: 404, headers: privateHeaders },
	);
}

interface StoredReceipt {
	provider: string;
	bucket: string | null;
	key: string;
	versionId: string | null;
	fileName: string;
	mimeType: string;
	sizeBytes: number;
	checksumSha256: string;
}

/**
 * Streams a private report receipt after verifying its recorded identity: to
 * the report owner, or to a reviewer the Approvals inbox authorizes (#602), who
 * receives only the exact object frozen in the current submission.
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ reportId: string; receiptId: string }> },
) {
	await connection();
	try {
		const { reportId, receiptId } = await params;
		if (!z.uuid().safeParse(reportId).success || !z.uuid().safeParse(receiptId).success) {
			return notFound();
		}
		const authorized = await loadAuthorizedTravelExpenseReport(reportId);
		if (authorized.status === "unauthorized") {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
		}
		if (authorized.status !== "found") return notFound();
		const { report } = authorized;
		let stored: StoredReceipt | null = null;
		if (authorized.access !== "owner") {
			// Reviewers and finance (#612) only ever receive the frozen evidence.
			const frozen = await loadSubmittedReportReceipt(report, receiptId);
			stored = frozen && {
				...frozen.object,
				fileName: frozen.fileName,
				mimeType: frozen.mimeType,
				sizeBytes: frozen.sizeBytes,
				checksumSha256: frozen.checksumSha256,
			};
		} else {
			const [receipt] = await db
				.select()
				.from(travelExpenseReportReceipt)
				.where(
					and(
						eq(travelExpenseReportReceipt.id, receiptId),
						eq(travelExpenseReportReceipt.reportId, report.id),
						eq(travelExpenseReportReceipt.organizationId, report.organizationId),
					),
				)
				.limit(1);
			stored = receipt
				? {
						provider: receipt.storageProvider,
						bucket: receipt.storageBucket,
						key: receipt.storageKey,
						versionId: receipt.storageVersionId,
						fileName: receipt.fileName,
						mimeType: receipt.mimeType,
						sizeBytes: receipt.sizeBytes,
						checksumSha256: receipt.checksumSha256,
					}
				: null;
		}
		if (!stored) return notFound();
		if (stored.provider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER) {
			throw new Error("Unsupported recorded receipt storage provider");
		}
		const bytes = await readPrivateObject({
			organizationId: report.organizationId,
			key: stored.key,
			bucket: stored.bucket,
			versionId: stored.versionId,
		});
		if (
			bytes.byteLength !== stored.sizeBytes ||
			createHash("sha256").update(bytes).digest("hex") !== stored.checksumSha256
		) {
			throw new Error("Stored receipt content does not match its recorded identity");
		}
		const mimeType = isAllowedTravelExpenseMime(stored.mimeType)
			? stored.mimeType
			: "application/octet-stream";
		const disposition =
			new URL(request.url).searchParams.get("download") === "1" ||
			mimeType === "application/octet-stream"
				? "attachment"
				: "inline";
		const encodedName = encodeURIComponent(stored.fileName).replace(
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
		logger.error({ error }, "Failed to retrieve report receipt");
		return NextResponse.json(
			{ error: "Receipt unavailable. Please retry." },
			{ status: 503, headers: privateHeaders },
		);
	}
}
