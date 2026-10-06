import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedFacts } from "@/lib/approvals/evidence/travel-expense-report-facts";
import {
	buildTravelExpenseExportFiles,
	csvDecimal,
	csvText,
	TravelExpenseExportContentError,
} from "../export-csv";
import type {
	TravelExpenseExportManifest,
	TravelExpenseExportManifestRevision,
} from "../export-manifest";

const SHA = "a".repeat(64);

function receipt(receiptId: string, itemId: string) {
	return {
		receiptId,
		itemId,
		object: {
			provider: "s3-private",
			bucket: "private",
			key: `travel-expenses/org/reports/r/${itemId}/${receiptId}-x.pdf`,
			versionId: "v1",
		},
		checksumSha256: SHA,
		sizeBytes: 10,
		mimeType: "application/pdf",
	};
}

function tripRevision(): TravelExpenseExportManifestRevision {
	const facts: TravelExpenseReportSubmittedFacts = {
		schemaVersion: 1,
		kind: "travel_expense_report",
		organizationId: "org",
		reportId: "report-trip",
		submissionCycle: 2,
		subjectEmployeeId: "emp-1",
		requesterEmployeeId: "emp-1",
		reportKind: "trip",
		reimbursementCurrency: "EUR",
		trip: {
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "Pacific/Auckland",
			destinations: [
				{ place: "Hamburg", countryCode: "DE" },
				{ place: "Paris", countryCode: "FR" },
			],
		},
		items: [
			{
				itemId: "item-train",
				position: 1,
				type: "receipt",
				expenseDate: "2026-09-14",
				category: "transport",
				description: '=HYPERLINK("http://evil","click")',
				original: { amount: "89.90", currency: "EUR" },
				paidBy: "employee",
				accountingReference: "@CC-100",
				receipts: [receipt("rcpt-train", "item-train")],
			},
			{
				itemId: "item-hotel",
				position: 2,
				type: "receipt",
				expenseDate: "2026-09-15",
				category: "accommodation",
				description: "Hotel, 2 nights",
				original: { amount: "240.00", currency: "EUR" },
				paidBy: "company",
				accountingReference: null,
				receipts: [receipt("rcpt-hotel", "item-hotel")],
			},
		],
		totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "240.00" },
	};
	return {
		reportId: "report-trip",
		revisionId: "rev-trip",
		submissionCycle: 2,
		materialFingerprint: "travel_expense_report:v1:abc",
		approvedAt: "2026-09-20T08:00:00Z",
		employeeId: "emp-1",
		employeeName: "Ada",
		facts,
		receiptFileNames: { "rcpt-train": "train ticket.pdf", "rcpt-hotel": "../../hotel.pdf" },
	};
}

function standaloneRevision(): TravelExpenseExportManifestRevision {
	return {
		reportId: "report-solo",
		revisionId: "rev-solo",
		submissionCycle: 1,
		materialFingerprint: "travel_expense_report:v1:def",
		approvedAt: "2026-09-21T09:30:00Z",
		employeeId: "emp-2",
		employeeName: "-Bob",
		receiptFileNames: { "rcpt-taxi": "taxi.pdf" },
		facts: {
			schemaVersion: 1,
			kind: "travel_expense_report",
			organizationId: "org",
			reportId: "report-solo",
			submissionCycle: 1,
			subjectEmployeeId: "emp-2",
			requesterEmployeeId: "emp-2",
			reportKind: "standalone",
			reimbursementCurrency: "CHF",
			trip: null,
			items: [
				{
					itemId: "item-taxi",
					position: 1,
					type: "receipt",
					expenseDate: "2026-09-01",
					category: "transport",
					description: "Taxi",
					original: { amount: "35.50", currency: "CHF" },
					paidBy: "employee",
					accountingReference: null,
					receipts: [receipt("rcpt-taxi", "item-taxi")],
				},
			],
			totals: { currency: "CHF", reimbursable: "35.50", companyPaid: "0.00" },
		},
	};
}

function manifest(
	revisions: TravelExpenseExportManifestRevision[] = [tripRevision(), standaloneRevision()],
): TravelExpenseExportManifest {
	return {
		kind: "travel_expense_export",
		version: 1,
		organizationId: "org",
		batchId: "batch-1",
		createdAt: "2026-10-01T12:00:00Z",
		revisions,
	};
}

/** Minimal RFC 4180 reader for assertions. */
function parseCsv(content: string): string[][] {
	expect(content.startsWith("﻿")).toBe(true);
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const text = content.slice(1);
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				cell += '"';
				index++;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(cell);
			cell = "";
		} else if (char === "\r" && text[index + 1] === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			index++;
		} else {
			cell += char;
		}
	}
	return rows;
}

function records(content: string): Record<string, string>[] {
	const [header, ...rows] = parseCsv(content);
	return rows.map((row) =>
		Object.fromEntries((header ?? []).map((name, i) => [name, row[i] ?? ""])),
	);
}

function file(path: string, input = manifest()) {
	const found = buildTravelExpenseExportFiles(input).find((candidate) => candidate.path === path);
	if (!found) throw new Error(`missing ${path}`);
	return found.content;
}

describe("travel expense export CSV cells", () => {
	it("neutralizes text a spreadsheet would run as a formula", () => {
		expect(csvText("=1+2")).toBe(`"'=1+2"`);
		expect(csvText("+49 30 1234")).toBe(`"'+49 30 1234"`);
		expect(csvText("-cmd")).toBe(`"'-cmd"`);
		expect(csvText("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
		expect(csvText("  =1")).toBe(`"'  =1"`);
		expect(csvText("\tvalue")).toBe(`"'\tvalue"`);
		expect(csvText("\rvalue")).toBe(`"'\rvalue"`);
		expect(csvText("＝1+2")).toBe(`"'＝1+2"`);
		expect(csvText('say "hi", then')).toBe(`"say ""hi"", then"`);
		expect(csvText("Hotel")).toBe(`"Hotel"`);
		expect(csvText(null)).toBe(`""`);
	});

	it("writes money as plain signed decimals and refuses anything else", () => {
		expect(csvDecimal("89.90")).toBe("89.90");
		expect(csvDecimal("-50.00")).toBe("-50.00");
		expect(() => csvDecimal("=1+2")).toThrow(TravelExpenseExportContentError);
		expect(() => csvDecimal("1e3")).toThrow(TravelExpenseExportContentError);
		expect(() => csvDecimal("12.5")).toThrow(TravelExpenseExportContentError);
	});
});

describe("travel expense export files", () => {
	it("bundles the expense, report and receipt CSVs and the manifest", () => {
		expect(
			buildTravelExpenseExportFiles(manifest())
				.map((candidate) => candidate.path)
				.toSorted(),
		).toEqual(["expenses.csv", "manifest.json", "receipts.csv", "reports.csv"]);
		expect(JSON.parse(file("manifest.json"))).toEqual(manifest());
	});

	it("lists one row per expense with explicit money, logical dates, attribution and basis", () => {
		const rows = records(file("expenses.csv"));
		expect(rows).toHaveLength(3);
		expect(rows[0]).toEqual({
			batch_id: "batch-1",
			report_id: "report-trip",
			revision_id: "rev-trip",
			submission_cycle: "2",
			revision_fingerprint: "travel_expense_report:v1:abc",
			approved_at: "2026-09-20T08:00:00Z",
			employee_id: "emp-1",
			employee_name: "Ada",
			report_kind: "trip",
			trip_purpose: "Customer workshop",
			trip_start_date: "2026-09-14",
			trip_end_date: "2026-09-16",
			trip_time_zone: "Pacific/Auckland",
			trip_destinations: "Hamburg (DE); Paris (FR)",
			item_id: "item-train",
			item_position: "1",
			item_type: "receipt",
			expense_date: "2026-09-14",
			category: "transport",
			description: `'=HYPERLINK("http://evil","click")`,
			paid_by: "employee",
			original_amount: "89.90",
			original_currency: "EUR",
			reimbursement_amount: "89.90",
			company_paid_amount: "0.00",
			reimbursement_currency: "EUR",
			calculation_basis: "receipt_amount",
			exception_basis: "",
			accounting_reference: "'@CC-100",
			project_id: "",
			project_name: "",
			receipt_count: "1",
			receipt_files: "receipts/report-trip/001-rcpt-train-train ticket.pdf",
		});
		// Company-paid costs stay visible but never count toward reimbursement.
		expect(rows[1]).toMatchObject({
			item_id: "item-hotel",
			paid_by: "company",
			reimbursement_amount: "0.00",
			company_paid_amount: "240.00",
			receipt_files: "receipts/report-trip/002-rcpt-hotel-hotel.pdf",
		});
		// A standalone report in another currency keeps its own currency and no trip.
		expect(rows[2]).toMatchObject({
			report_id: "report-solo",
			employee_name: "'-Bob",
			report_kind: "standalone",
			trip_purpose: "",
			trip_time_zone: "",
			expense_date: "2026-09-01",
			reimbursement_amount: "35.50",
			reimbursement_currency: "CHF",
		});
	});

	it("totals each revision in its own currency and never mixes currencies", () => {
		expect(records(file("reports.csv"))).toEqual([
			expect.objectContaining({
				report_id: "report-trip",
				revision_id: "rev-trip",
				currency: "EUR",
				reimbursable_total: "89.90",
				company_paid_total: "240.00",
				item_count: "2",
				receipt_count: "2",
			}),
			expect.objectContaining({
				report_id: "report-solo",
				currency: "CHF",
				reimbursable_total: "35.50",
				company_paid_total: "0.00",
				item_count: "1",
			}),
		]);
	});

	it("names every bundled receipt object with its preserved identity", () => {
		const rows = records(file("receipts.csv"));
		expect(rows).toHaveLength(3);
		expect(rows[0]).toEqual({
			report_id: "report-trip",
			revision_id: "rev-trip",
			item_id: "item-train",
			receipt_id: "rcpt-train",
			bundle_path: "receipts/report-trip/001-rcpt-train-train ticket.pdf",
			file_name: "train ticket.pdf",
			mime_type: "application/pdf",
			size_bytes: "10",
			checksum_sha256: SHA,
			storage_key: "travel-expenses/org/reports/r/item-train/rcpt-train-x.pdf",
			storage_version_id: "v1",
		});
	});

	it("refuses a revision whose items do not add up to its frozen totals", () => {
		const broken = tripRevision();
		broken.facts.totals = { ...broken.facts.totals, reimbursable: "100.00" };
		expect(() => buildTravelExpenseExportFiles(manifest([broken]))).toThrow(
			expect.objectContaining({ code: "totals_mismatch" }),
		);
	});

	it("is byte-identical for the same manifest", () => {
		expect(buildTravelExpenseExportFiles(manifest())).toEqual(
			buildTravelExpenseExportFiles(manifest()),
		);
	});
});
