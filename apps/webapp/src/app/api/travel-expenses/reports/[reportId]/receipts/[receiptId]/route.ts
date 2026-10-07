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
	loadReceiptPreview,
	RECEIPT_PREVIEW_MIME_TYPE,
} from "@/lib/travel-expenses/receipt-preview";
import {
	authorizedReportCycle,
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

/** The recorded object, refused when its content no longer matches the recorded identity. */
async function readVerifiedReceipt(organizationId: string, stored: StoredReceipt) {
	const bytes = await readPrivateObject({
		organizationId,
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
	return bytes;
}

/**
 * Streams a private report receipt after verifying its recorded identity: to
 * the report owner, or to a reviewer the Approvals inbox authorizes (#602), who
 * receives only the exact object frozen in the current submission.
 * `?variant=thumb` serves a small preview of an image instead (#690).
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
		const { searchParams } = new URL(request.url);
		const variant = searchParams.get("variant");
		if (variant !== null && variant !== "thumb") return notFound();
		// `cycle` names a frozen submission (#603): its exact receipt, also after
		// the owner corrected or removed it in a returned or withdrawn report.
		const cycleParam = searchParams.get("cycle");
		const cycle = cycleParam === null ? undefined : Number(cycleParam);
		if (cycle !== undefined && (!Number.isInteger(cycle) || cycle < 1)) return notFound();
		let stored: StoredReceipt | null = null;
		// Finance (#612) is authorized for the approved current submission only.
		const otherCycle = cycle !== undefined && cycle !== report.submissionCount;
		if (authorized.access === "finance" && otherCycle) return notFound();
		// A reviewer receives only the receipts of cycles they may review.
		const readableCycle = authorized.reviewerCycles
			? authorizedReportCycle(authorized, cycle ?? report.submissionCount)
			: cycle;
		if (readableCycle === null) return notFound();
		if (authorized.access !== "owner" || cycle !== undefined) {
			// Reviewers and finance only ever receive the frozen evidence.
			const frozen = await loadSubmittedReportReceipt(report, receiptId, readableCycle);
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
		// A closure loses the narrowing of the reassignable `stored`.
		const found = stored;
		const readOriginal = () => readVerifiedReceipt(report.organizationId, found);
		const mimeType = isAllowedTravelExpenseMime(stored.mimeType)
			? stored.mimeType
			: "application/octet-stream";
		if (variant === "thumb") {
			// The small preview an expense tile shows (#690), under the same access as the original.
			const preview = await loadReceiptPreview({
				organizationId: report.organizationId,
				key: stored.key,
				mimeType,
				readOriginal,
			});
			if (preview) {
				return new Response(new Uint8Array(preview), {
					headers: {
						...privateHeaders,
						"Content-Type": RECEIPT_PREVIEW_MIME_TYPE,
						"Content-Disposition": "inline",
						"Content-Security-Policy": "sandbox",
					},
				});
			}
			if (!mimeType.startsWith("image/")) return notFound();
			// An image the preview cannot be rendered from is shown as its original.
		}
		const bytes = await readOriginal();
		const disposition =
			searchParams.get("download") === "1" || mimeType === "application/octet-stream"
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
