import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { travelExpenseReport, travelExpenseReportReceipt } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { readPrivateObject } from "@/lib/storage/export-s3-client";
import {
	isAllowedTravelExpenseMime,
	TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER,
} from "@/lib/travel-expenses/attachment-validation";

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

/** Streams a private report receipt to the report owner after verifying its recorded identity. */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ reportId: string; receiptId: string }> },
) {
	await connection();
	try {
		const actor = await getAuthContext();
		if (!actor?.employee) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
		}
		const { reportId, receiptId } = await params;
		if (!z.uuid().safeParse(reportId).success || !z.uuid().safeParse(receiptId).success) {
			return notFound();
		}
		const organizationId = actor.employee.organizationId;
		const [receipt] = await db
			.select({ receipt: travelExpenseReportReceipt })
			.from(travelExpenseReportReceipt)
			.innerJoin(
				travelExpenseReport,
				and(
					eq(travelExpenseReport.id, travelExpenseReportReceipt.reportId),
					eq(travelExpenseReport.organizationId, travelExpenseReportReceipt.organizationId),
				),
			)
			.where(
				and(
					eq(travelExpenseReportReceipt.id, receiptId),
					eq(travelExpenseReportReceipt.reportId, reportId),
					eq(travelExpenseReportReceipt.organizationId, organizationId),
					eq(travelExpenseReport.employeeId, actor.employee.id),
				),
			)
			.limit(1);
		if (!receipt) return notFound();
		const attachment = receipt.receipt;
		if (attachment.storageProvider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER) {
			throw new Error("Unsupported recorded receipt storage provider");
		}
		const bytes = await readPrivateObject({
			organizationId,
			key: attachment.storageKey,
			bucket: attachment.storageBucket,
			versionId: attachment.storageVersionId,
		});
		if (
			bytes.byteLength !== attachment.sizeBytes ||
			createHash("sha256").update(bytes).digest("hex") !== attachment.checksumSha256
		) {
			throw new Error("Stored receipt content does not match its recorded identity");
		}
		const mimeType = isAllowedTravelExpenseMime(attachment.mimeType)
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
		logger.error({ error }, "Failed to retrieve report receipt");
		return NextResponse.json(
			{ error: "Receipt unavailable. Please retry." },
			{ status: 503, headers: privateHeaders },
		);
	}
}
