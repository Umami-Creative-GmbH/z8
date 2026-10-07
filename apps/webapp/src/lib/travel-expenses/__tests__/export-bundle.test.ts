import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { assembleTravelExpenseExportZip } from "../export-bundle";
import type { TravelExpenseExportManifest } from "../export-manifest";

const bytes = Buffer.from("%PDF-1.4 receipt");
const sha = createHash("sha256").update(bytes).digest("hex");

function manifest(): TravelExpenseExportManifest {
	return {
		kind: "travel_expense_export",
		version: 1,
		organizationId: "org",
		batchId: "batch-1",
		createdAt: "2026-10-01T12:00:00Z",
		revisions: [
			{
				reportId: "report-1",
				revisionId: "rev-1",
				submissionCycle: 1,
				materialFingerprint: "travel_expense_report:v1:abc",
				approvedAt: "2026-09-20T08:00:00Z",
				employeeId: "emp-1",
				employeeName: "Ada",
				receiptFileNames: { r1: "taxi.pdf" },
				facts: {
					schemaVersion: 1,
					kind: "travel_expense_report",
					organizationId: "org",
					reportId: "report-1",
					submissionCycle: 1,
					subjectEmployeeId: "emp-1",
					requesterEmployeeId: "emp-1",
					reportKind: "standalone",
					reimbursementCurrency: "EUR",
					trip: null,
					items: [
						{
							itemId: "i1",
							position: 1,
							type: "receipt",
							expenseDate: "2026-09-01",
							category: "transport",
							description: "Taxi",
							original: { amount: "12.00", currency: "EUR" },
							paidBy: "employee",
							accountingReference: null,
							receipts: [
								{
									receiptId: "r1",
									itemId: "i1",
									object: { provider: "s3-private", bucket: "b", key: "k1", versionId: "v7" },
									checksumSha256: sha,
									sizeBytes: bytes.length,
									mimeType: "application/pdf",
								},
							],
						},
					],
					totals: { currency: "EUR", reimbursable: "12.00", companyPaid: "0.00" },
				},
			},
		],
	};
}

describe("travel expense export bundle", () => {
	it("bundles the CSVs and the exact frozen receipt object version", async () => {
		const requested: unknown[] = [];
		const zip = await assembleTravelExpenseExportZip(manifest(), async (object) => {
			requested.push(object);
			return bytes;
		});
		expect(requested).toEqual([{ bucket: "b", key: "k1", versionId: "v7" }]);
		const opened = await JSZip.loadAsync(zip);
		expect(Object.keys(opened.files).toSorted()).toEqual([
			"expenses.csv",
			"manifest.json",
			"receipts.csv",
			"receipts/report-1/001-r1-taxi.pdf",
			"reports.csv",
		]);
		const receipt = await opened.file("receipts/report-1/001-r1-taxi.pdf")?.async("nodebuffer");
		expect(receipt?.equals(bytes)).toBe(true);
	});

	it("refuses bytes that are not the recorded receipt", async () => {
		await expect(
			assembleTravelExpenseExportZip(manifest(), async () => Buffer.from("tampered content")),
		).rejects.toMatchObject({ code: "receipt_mismatch" });
	});

	it("reports an unreadable receipt object", async () => {
		await expect(
			assembleTravelExpenseExportZip(manifest(), async () => {
				throw new Error("NoSuchVersion");
			}),
		).rejects.toMatchObject({ code: "receipt_unavailable" });
	});

	it("produces identical bytes on a retry", async () => {
		const read = async () => bytes;
		const first = await assembleTravelExpenseExportZip(manifest(), read);
		const second = await assembleTravelExpenseExportZip(manifest(), read);
		expect(first.equals(second)).toBe(true);
	});
});
