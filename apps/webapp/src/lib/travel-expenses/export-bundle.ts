import { createHash } from "node:crypto";
import JSZip from "jszip";
import { TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER } from "./attachment-validation";
import { buildTravelExpenseExportFiles, TravelExpenseExportContentError } from "./export-csv";
import { bundleReceiptPath, type TravelExpenseExportManifest } from "./export-manifest";

/**
 * Assembles the ZIP of one export batch (#613) from its manifest: the CSV
 * files plus every frozen receipt object, read by its recorded bucket, key and
 * version and verified against its recorded size and SHA-256 before it is
 * bundled. Entries are sorted and dated to a fixed instant, so the same
 * manifest always yields the same bytes.
 */

const ZIP_ENTRY_DATE = new Date("1980-01-01T00:00:00.000Z");

export type ReadExportReceiptObject = (object: {
	bucket: string | null;
	key: string;
	versionId: string | null;
}) => Promise<Uint8Array>;

export async function assembleTravelExpenseExportZip(
	manifest: TravelExpenseExportManifest,
	readObject: ReadExportReceiptObject,
): Promise<Buffer> {
	const entries: Array<{ path: string; content: string | Uint8Array }> =
		buildTravelExpenseExportFiles(manifest);
	for (const revision of manifest.revisions) {
		for (const item of revision.facts.items) {
			for (const receipt of item.receipts) {
				if (receipt.object.provider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER) {
					throw new TravelExpenseExportContentError("receipt_unavailable", "Unsupported provider");
				}
				let content: Uint8Array;
				try {
					// One object at a time on purpose: it keeps storage load bounded for large batches.
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					content = await readObject({
						bucket: receipt.object.bucket,
						key: receipt.object.key,
						versionId: receipt.object.versionId,
					});
				} catch {
					throw new TravelExpenseExportContentError(
						"receipt_unavailable",
						`Receipt ${receipt.receiptId} could not be read`,
					);
				}
				if (
					content.byteLength !== receipt.sizeBytes ||
					createHash("sha256").update(content).digest("hex") !== receipt.checksumSha256
				) {
					throw new TravelExpenseExportContentError(
						"receipt_mismatch",
						`Receipt ${receipt.receiptId} does not match its recorded identity`,
					);
				}
				entries.push({
					path: bundleReceiptPath({
						reportId: revision.reportId,
						itemPosition: item.position,
						receiptId: receipt.receiptId,
						fileName: revision.receiptFileNames[receipt.receiptId],
						mimeType: receipt.mimeType,
					}),
					content,
				});
			}
		}
	}
	const zip = new JSZip();
	for (const entry of entries.toSorted((left, right) => (left.path < right.path ? -1 : 1))) {
		zip.file(entry.path, entry.content, {
			createFolders: false,
			date: ZIP_ENTRY_DATE,
			compression: "DEFLATE",
			compressionOptions: { level: 6 },
		});
	}
	return zip.generateAsync({ type: "nodebuffer", platform: "DOS" });
}
