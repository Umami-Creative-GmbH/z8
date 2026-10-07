import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { travelExpenseAttachment } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { readPrivateObject } from "@/lib/storage/export-s3-client";
import {
	isAllowedTravelExpenseMime,
	TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER,
} from "@/lib/travel-expenses/attachment-validation";
import { loadAuthorizedTravelExpenseClaim } from "@/lib/travel-expenses/claim-read";

const logger = createLogger("TravelExpenseReceipt");
const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
};
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ claimId: string; attachmentId: string }> },
) {
	try {
		const { claimId, attachmentId } = await params;
		const result = await loadAuthorizedTravelExpenseClaim(claimId);
		if (result.status !== "found")
			return NextResponse.json(
				{
					error:
						result.status === "unauthorized"
							? "Unauthorized"
							: "Receipt not found",
				},
				{
					status: result.status === "unauthorized" ? 401 : 404,
					headers: privateHeaders,
				},
			);
		if (!z.uuid().safeParse(attachmentId).success)
			return NextResponse.json(
				{ error: "Receipt not found" },
				{ status: 404, headers: privateHeaders },
			);
		const attachment = await db.query.travelExpenseAttachment.findFirst({
			where: and(
				eq(travelExpenseAttachment.id, attachmentId),
				eq(travelExpenseAttachment.claimId, result.claim.id),
				eq(travelExpenseAttachment.organizationId, result.claim.organizationId),
			),
		});
		if (!attachment)
			return NextResponse.json(
				{ error: "Receipt not found" },
				{ status: 404, headers: privateHeaders },
			);
		if (attachment.storageProvider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER)
			throw new Error("Unsupported recorded receipt storage provider");
		const bytes = await readPrivateObject({
			organizationId: result.claim.organizationId,
			key: attachment.storageKey,
			bucket: attachment.storageBucket,
			versionId: attachment.storageVersionId,
		});
		if (
			(attachment.sizeBytes !== null &&
				bytes.byteLength !== attachment.sizeBytes) ||
			(attachment.checksumSha256 &&
				createHash("sha256").update(bytes).digest("hex") !==
					attachment.checksumSha256)
		) {
			throw new Error(
				"Stored receipt content does not match its recorded identity",
			);
		}
		const mimeType =
			attachment.mimeType && isAllowedTravelExpenseMime(attachment.mimeType)
				? attachment.mimeType
				: "application/octet-stream";
		const disposition =
			new URL(request.url).searchParams.get("download") === "1" ||
			mimeType === "application/octet-stream"
				? "attachment"
				: "inline";
		const encodedName = encodeURIComponent(attachment.fileName).replace(
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
		logger.error({ error }, "Failed to retrieve recorded receipt");
		return NextResponse.json(
			{
				error:
					"Receipt unavailable. Please retry or ask your administrator to restore the recorded receipt.",
			},
			{ status: 503, headers: privateHeaders },
		);
	}
}
