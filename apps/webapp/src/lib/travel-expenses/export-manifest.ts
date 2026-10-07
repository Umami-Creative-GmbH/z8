import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/approvals/evidence/absence-facts";
import type { TravelExpenseReportSubmittedFacts } from "@/lib/approvals/evidence/travel-expense-report-facts";
import type {
	TravelExpenseExportManifestRecord,
	TravelExpenseExportManifestRevisionRecord,
} from "./export-manifest.types";

/**
 * The manifest of one travel expense export batch (#613): the exact approved
 * frozen revisions finance selected, captured when the batch was created. The
 * export file is built from this manifest only, never from live report rows,
 * so a retried job produces the same CSV and the same receipt objects, and a
 * later change to a report cannot leak into a batch that already exists.
 */

export const TRAVEL_EXPENSE_EXPORT_MANIFEST_VERSION = 1;

export type TravelExpenseExportManifestRevision =
	TravelExpenseExportManifestRevisionRecord<TravelExpenseReportSubmittedFacts>;

export type TravelExpenseExportManifest =
	TravelExpenseExportManifestRecord<TravelExpenseReportSubmittedFacts>;

/**
 * A manifest read back from `travel_expense_export_batch.manifest`. The batch
 * stored exactly what `TravelExpenseExportManifest` built, so the frozen facts
 * keep their type; the schema only declares the facts-agnostic record.
 */
export function storedTravelExpenseExportManifest(
	record: TravelExpenseExportManifestRecord,
): TravelExpenseExportManifest {
	return record as TravelExpenseExportManifest;
}

export function sortManifestRevisions(
	revisions: readonly TravelExpenseExportManifestRevision[],
): TravelExpenseExportManifestRevision[] {
	return revisions.toSorted((left, right) =>
		left.reportId < right.reportId ? -1 : left.reportId > right.reportId ? 1 : 0,
	);
}

/** Stable content identity of a manifest; survives a jsonb round trip. */
export function travelExpenseExportManifestDigest(manifest: TravelExpenseExportManifest): string {
	return `travel_expense_export:v${manifest.version}:${createHash("sha256")
		.update(canonicalJson(manifest))
		.digest("hex")}`;
}

/** Identity of a selection: the same revisions in any order give the same value. */
export function travelExpenseExportSelectionFingerprint(
	selection: ReadonlyArray<{ reportId: string; revisionId: string }>,
): string {
	const canonical = selection
		.map(({ reportId, revisionId }) => `${reportId}:${revisionId}`)
		.toSorted()
		.join("\n");
	return `travel_expense_export_selection:v1:${createHash("sha256").update(canonical).digest("hex")}`;
}

const UNSAFE_FILE_NAME_CHARACTERS = /[^\p{L}\p{N}._ -]+/gu;

/** A receipt's file name inside the bundle: path-safe, never empty. */
export function bundleReceiptFileName(fileName: string | undefined, mimeType: string): string {
	const cleaned = (fileName ?? "")
		.normalize("NFC")
		.replace(UNSAFE_FILE_NAME_CHARACTERS, "_")
		.replace(/^[.\s_]+/, "")
		.trim()
		.slice(0, 120);
	if (cleaned.length > 0) return cleaned;
	const extension =
		mimeType === "application/pdf"
			? ".pdf"
			: mimeType === "image/png"
				? ".png"
				: mimeType === "image/jpeg"
					? ".jpg"
					: "";
	return `receipt${extension}`;
}

/** Where one frozen receipt object is stored inside the export ZIP. */
export function bundleReceiptPath(input: {
	reportId: string;
	itemPosition: number;
	receiptId: string;
	fileName: string | undefined;
	mimeType: string;
}): string {
	const position = String(input.itemPosition).padStart(3, "0");
	return `receipts/${input.reportId}/${position}-${input.receiptId}-${bundleReceiptFileName(
		input.fileName,
		input.mimeType,
	)}`;
}

/** The ZIP's file name: creation date (UTC) and the batch id prefix. */
export function travelExpenseExportFileName(manifest: TravelExpenseExportManifest): string {
	return `travel-expenses-${manifest.createdAt.slice(0, 10)}-${manifest.batchId.slice(0, 8)}.zip`;
}
