import { describe, expect, it } from "vitest";
import {
	TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION,
	type TravelExpenseReportSubmittedFacts,
	type TravelExpenseReportSubmittedItem,
} from "@/lib/approvals/evidence/travel-expense-report-facts";
import {
	buildTravelExpenseExportFiles,
	csvDecimal,
	csvText,
	TRAVEL_EXPENSE_EXPORT_EXPENSE_COLUMNS,
	TravelExpenseExportContentError,
} from "../export-csv";
import type {
	TravelExpenseExportManifest,
	TravelExpenseExportManifestRevision,
} from "../export-manifest";
import { calculatePerDiem, perDiemPolicyResolver } from "../per-diem";
import { GERMAN_DOMESTIC_PER_DIEM_DEFAULT } from "../statutory-per-diem-defaults";

const SHA = "a".repeat(64);

/** Project (v4), conversion (v3, v6), mileage (v5) and per diem (v7) columns, empty for a v1 receipt. */
const EMPTY_LATER_FACTS = Object.fromEntries(
	TRAVEL_EXPENSE_EXPORT_EXPENSE_COLUMNS.filter((column) =>
		/^(project|conversion|mileage|per_diem|allowance_override)_/.test(column),
	).map((column) => [column, ""]),
);

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

function soloRevision(
	reportId: string,
	schemaVersion: number,
	items: TravelExpenseReportSubmittedItem[],
	totals: { reimbursable: string; companyPaid: string },
	receiptFileNames: Record<string, string> = {},
): TravelExpenseExportManifestRevision {
	return {
		reportId,
		revisionId: `rev-${reportId}`,
		submissionCycle: 1,
		materialFingerprint: `travel_expense_report:v${schemaVersion}:${reportId}`,
		approvedAt: "2026-09-21T09:30:00Z",
		employeeId: "emp-2",
		employeeName: "Bob",
		receiptFileNames,
		facts: {
			schemaVersion,
			kind: "travel_expense_report",
			organizationId: "org",
			reportId,
			submissionCycle: 1,
			subjectEmployeeId: "emp-2",
			requesterEmployeeId: "emp-2",
			reportKind: "trip",
			reimbursementCurrency: "EUR",
			trip: {
				purpose: "Conference",
				startDate: "2026-09-14",
				endDate: "2026-09-15",
				timeZone: "America/New_York",
				destinations: [{ place: "New York", countryCode: "US" }],
			},
			items,
			totals: { currency: "EUR", ...totals },
		},
	};
}

/** v3: a card charge (employee) and an authorized manual rate (company) into EUR. */
function foreignRevision(): TravelExpenseExportManifestRevision {
	return soloRevision(
		"report-fx",
		3,
		[
			{
				itemId: "item-card",
				position: 1,
				type: "receipt",
				expenseDate: "2026-09-14",
				category: "meals",
				description: "Dinner",
				original: { amount: "100.00", currency: "USD" },
				paidBy: "employee",
				accountingReference: null,
				receipts: [receipt("rcpt-card", "item-card")],
				conversion: {
					basis: "card_charge",
					evidenceReceiptId: "rcpt-card",
					reimbursement: { amount: "92.17", currency: "EUR" },
				},
			},
			{
				itemId: "item-rate",
				position: 2,
				type: "receipt",
				expenseDate: "2026-09-14",
				category: "transport",
				description: "Subway",
				original: { amount: "50.00", currency: "USD" },
				paidBy: "company",
				accountingReference: null,
				receipts: [receipt("rcpt-rate", "item-rate")],
				conversion: {
					basis: "manual_rate",
					rate: { base: "USD", quote: "EUR", value: "0.92" },
					rateDate: "2026-09-14",
					reason: "=ECB reference rate",
					authorizedBy: { employeeId: "emp-admin", name: "+Finance Admin" },
					authorizedAt: "2026-09-15T07:30:00Z",
					rounding: { mode: "half_up", minorUnitDigits: 2 },
					reimbursement: { amount: "46.00", currency: "EUR" },
				},
			},
		],
		{ reimbursable: "92.17", companyPaid: "46.00" },
		{ "rcpt-card": "statement.pdf", "rcpt-rate": "subway.pdf" },
	);
}

/** v5: a policy-priced mileage expense, attributed to the trip's project. */
function mileageRevision(): TravelExpenseExportManifestRevision {
	return soloRevision(
		"report-km",
		5,
		[
			{
				itemId: "item-km",
				position: 1,
				type: "mileage",
				expenseDate: "2026-09-14",
				category: "transport",
				description: "-Berlin to Potsdam",
				original: { amount: "37.02", currency: "EUR" },
				paidBy: "employee",
				accountingReference: null,
				receipts: [],
				mileage: {
					route: "-Berlin to Potsdam",
					distanceKm: "123.40",
					vehicle: "car",
					ratePerKm: "0.3000",
					currency: "EUR",
					exactAmount: "37.020000",
					amount: "37.02",
					rounding: "half_up",
					policy: {
						policyId: "policy-1",
						versionId: "version-1",
						effectiveFrom: "2026-01-01",
						source: {
							kind: "statutory_default",
							reference: "§ 9 EStG",
							version: "LStH 2026",
							defaultKey: "de-mileage-2026",
						},
					},
				},
				project: {
					projectId: "project-1",
					name: "Relaunch",
					customerId: null,
					customerName: null,
					inheritedFromTrip: true,
					basis: "employee_assignment",
				},
			},
		],
		{ reimbursable: "37.02", companyPaid: "0.00" },
	);
}

/**
 * v7: a two-day domestic per diem with an overnight stay (14 € + 14 €) and
 * the hotel breakfast provided on the second day (- 5.60 €), as frozen.
 */
function perDiemRevision(): TravelExpenseExportManifestRevision {
	const calculation = calculatePerDiem(
		{
			startDate: "2026-09-14",
			startTime: "07:15",
			startTimeZone: "Europe/Berlin",
			endDate: "2026-09-15",
			endTime: "19:40",
			endTimeZone: "Europe/Berlin",
			overnight: "away",
			prolongedWorkplace: false,
			meals: ["2026-09-14", "2026-09-15"].map((date) => ({
				date,
				breakfast: { provided: date === "2026-09-15", employeePayment: null },
				lunch: { provided: false, employeePayment: null },
				dinner: { provided: false, employeePayment: null },
			})),
		},
		{
			trip: { destinations: [{ place: "Hamburg", countryCode: "DE" }] },
			reimbursementCurrency: "EUR",
			resolvePolicy: perDiemPolicyResolver([
				{
					id: "pd-version-1",
					policyId: "pd-policy",
					effectiveFrom: "2026-01-01",
					currency: "EUR",
					source: {
						kind: "statutory_default",
						reference: "§ 9 Abs. 4a EStG",
						version: "LStH 2026",
						defaultKey: "de-per-diem",
					},
					withdrawnAt: null,
					rates: { DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates } },
				},
			]),
		},
	);
	if (calculation.status !== "calculated") throw new Error("per diem not calculated");
	return soloRevision(
		"report-pd",
		7,
		[
			{
				itemId: "item-pd",
				position: 1,
				type: "per_diem",
				expenseDate: "2026-09-14",
				category: "meals",
				description: "Per diem",
				original: { amount: calculation.amount, currency: "EUR" },
				paidBy: "employee",
				accountingReference: null,
				receipts: [],
				perDiem: {
					start: {
						date: "2026-09-14",
						time: "07:15",
						timeZone: "Europe/Berlin",
						at: calculation.absence.startAt,
					},
					end: {
						date: "2026-09-15",
						time: "19:40",
						timeZone: "Europe/Berlin",
						at: calculation.absence.endAt,
					},
					overnight: "away",
					absenceMinutes: calculation.absence.minutes,
					meals: [],
					days: calculation.days,
					currency: calculation.currency,
					amount: calculation.amount,
					rules: calculation.rules,
					policies: calculation.policies,
				},
			},
		],
		{ reimbursable: "22.40", companyPaid: "0.00" },
	);
}

/** v9 (#610): an international per diem an expense administrator calculated manually. */
function perDiemOverrideRevision(): TravelExpenseExportManifestRevision {
	const itinerary = {
		startDate: "2026-09-14",
		startTime: "07:00",
		startTimeZone: "Europe/Paris",
		endDate: "2026-09-16",
		endTime: "18:00",
		endTimeZone: "Europe/Paris",
		overnight: "away" as const,
		prolongedWorkplace: false,
		meals: [],
	};
	return soloRevision(
		"report-pd-override",
		9,
		[
			{
				itemId: "item-pd",
				position: 1,
				type: "per_diem",
				expenseDate: "2026-09-14",
				category: "meals",
				description: "Per diem",
				original: { amount: "112.80", currency: "EUR" },
				paidBy: "employee",
				accountingReference: null,
				receipts: [],
				allowanceOverride: {
					overrideId: "override-pd",
					kind: "per_diem",
					amount: "112.80",
					currency: "EUR",
					reason: "=International trip",
					evidence: "BMF 2026, France: Paris",
					calculationBasis: "2 × 39.00 + 58.00 − 23.20",
					situation: { kind: "unsupported_case", reasons: ["international", "foreign_time_zone"] },
					scope: {
						kind: "per_diem",
						itinerary,
						destinations: [{ place: "Paris", countryCode: "FR" }],
					},
					authorizedBy: { employeeId: "admin-1", name: "Ada Admin" },
					authorizedAt: "2026-09-20T08:00:00Z",
				},
			},
		],
		{ reimbursable: "112.80", companyPaid: "0.00" },
	);
}

/**
 * v6: an ECB reference rate (`1 EUR = 1.1269 USD`) for an Easter Sunday
 * expense, taken from the Maundy Thursday publication as the fallback.
 */
function referenceRateRevision(): TravelExpenseExportManifestRevision {
	return soloRevision(
		"report-ecb",
		6,
		[
			{
				itemId: "item-ecb",
				position: 1,
				type: "receipt",
				expenseDate: "2026-04-05",
				category: "meals",
				description: "Dinner",
				original: { amount: "100.00", currency: "USD" },
				paidBy: "employee",
				accountingReference: null,
				receipts: [receipt("rcpt-ecb", "item-ecb")],
				conversion: {
					basis: "reference_rate",
					rate: { base: "EUR", quote: "USD", value: "1.1269" },
					rateDate: "2026-04-02",
					expenseDate: "2026-04-05",
					source: {
						provider: "ecb",
						publicationId: "publication-1",
						publicationVersion: 2,
						contentSha256: SHA,
						retrievedAt: "2026-04-02T15:05:00Z",
						policyApprovedAt: "2026-03-01T09:00:00Z",
					},
					rounding: { mode: "half_up", minorUnitDigits: 2 },
					reimbursement: { amount: "88.74", currency: "EUR" },
				},
			},
		],
		{ reimbursable: "88.74", companyPaid: "0.00" },
		{ "rcpt-ecb": "dinner.pdf" },
	);
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
			facts_schema_version: "1",
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
			...EMPTY_LATER_FACTS,
			receipt_count: "1",
			receipt_files: "receipts/report-trip/001-rcpt-train-train ticket.pdf",
			record_type: "original",
			adjusts_report_id: "",
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

	it("names an accepted missing-receipt exception as the item's evidence basis", () => {
		const revision = standaloneRevision();
		revision.facts.schemaVersion = 2;
		const [item] = revision.facts.items;
		if (!item) throw new Error("no item");
		item.receipts = [];
		item.receiptException = { reason: "=Lost in taxi" };
		const [row] = records(file("expenses.csv", manifest([revision])));
		expect(row).toMatchObject({
			exception_basis: "missing_receipt_exception: =Lost in taxi",
			receipt_count: "0",
			receipt_files: "",
			reimbursement_amount: "35.50",
		});
	});

	it("exports a v3 conversion's basis, inputs and result and reconciles converted totals", () => {
		const revision = foreignRevision();
		const rows = records(file("expenses.csv", manifest([revision])));
		expect(rows[0]).toMatchObject({
			facts_schema_version: "3",
			original_amount: "100.00",
			original_currency: "USD",
			reimbursement_amount: "92.17",
			company_paid_amount: "0.00",
			reimbursement_currency: "EUR",
			calculation_basis: "converted_amount",
			conversion_basis: "card_charge",
			conversion_result_amount: "92.17",
			conversion_result_currency: "EUR",
			conversion_rate: "",
			conversion_rate_date: "",
			conversion_evidence_receipt_id: "rcpt-card",
			conversion_evidence_file: "receipts/report-fx/001-rcpt-card-statement.pdf",
			conversion_reason: "",
		});
		expect(rows[1]).toMatchObject({
			original_amount: "50.00",
			original_currency: "USD",
			reimbursement_amount: "0.00",
			company_paid_amount: "46.00",
			calculation_basis: "converted_amount",
			conversion_basis: "manual_rate",
			conversion_result_amount: "46.00",
			conversion_result_currency: "EUR",
			conversion_rate_base: "USD",
			conversion_rate_quote: "EUR",
			conversion_rate: "0.92",
			// The documented calendar date, never shifted through a zone.
			conversion_rate_date: "2026-09-14",
			conversion_rounding: "half_up",
			conversion_evidence_receipt_id: "",
			conversion_authorized_by_employee_id: "emp-admin",
			conversion_authorized_by_name: "'+Finance Admin",
			conversion_authorized_at: "2026-09-15T07:30:00Z",
			conversion_reason: "'=ECB reference rate",
			mileage_route: "",
		});
		// The money cells are unquoted numbers; the formula-like reason is quoted text.
		const raw = file("expenses.csv", manifest([revision]));
		expect(raw).toContain(',0.92,"2026-09-14","half_up"');
		expect(raw).toContain('"\'=ECB reference rate"');
		expect(records(file("reports.csv", manifest([revision])))).toEqual([
			expect.objectContaining({ reimbursable_total: "92.17", company_paid_total: "46.00" }),
		]);
	});

	it("refuses a conversion whose frozen result does not follow from its frozen rate", () => {
		const revision = foreignRevision();
		const manual = revision.facts.items[1]?.conversion;
		if (manual?.basis !== "manual_rate") throw new Error("no manual rate");
		manual.reimbursement = { amount: "47.00", currency: "EUR" };
		revision.facts.totals = { ...revision.facts.totals, companyPaid: "47.00" };
		expect(() => buildTravelExpenseExportFiles(manifest([revision]))).toThrow(
			expect.objectContaining({ code: "totals_mismatch" }),
		);
	});

	it("exports a v6 reference rate with its publication and reconciles converted totals", () => {
		const revision = referenceRateRevision();
		const [row] = records(file("expenses.csv", manifest([revision])));
		expect(row).toMatchObject({
			facts_schema_version: "6",
			expense_date: "2026-04-05",
			original_amount: "100.00",
			original_currency: "USD",
			reimbursement_amount: "88.74",
			company_paid_amount: "0.00",
			reimbursement_currency: "EUR",
			calculation_basis: "converted_amount",
			conversion_basis: "reference_rate",
			conversion_result_amount: "88.74",
			conversion_result_currency: "EUR",
			// As published (1 EUR = 1.1269 USD); the item's USD is divided by it.
			conversion_rate_base: "EUR",
			conversion_rate_quote: "USD",
			conversion_rate: "1.1269",
			// The fallback publication's own date, not the expense date.
			conversion_rate_date: "2026-04-02",
			conversion_rounding: "half_up",
			conversion_reference_provider: "ecb",
			conversion_reference_publication_date: "2026-04-02",
			conversion_reference_publication_id: "publication-1",
			conversion_reference_publication_version: "2",
			conversion_reference_content_sha256: SHA,
			conversion_reference_retrieved_at: "2026-04-02T15:05:00Z",
			conversion_reference_policy_approved_at: "2026-03-01T09:00:00Z",
			conversion_authorized_by_employee_id: "",
			conversion_authorized_by_name: "",
			conversion_authorized_at: "",
			conversion_reason: "",
			conversion_evidence_receipt_id: "",
		});
		expect(records(file("reports.csv", manifest([revision])))).toEqual([
			expect.objectContaining({ reimbursable_total: "88.74", facts_schema_version: "6" }),
		]);
	});

	it("refuses a reference rate whose frozen facts do not support its result", () => {
		const tampered = referenceRateRevision();
		const tamperedConversion = tampered.facts.items[0]?.conversion;
		if (tamperedConversion?.basis !== "reference_rate") throw new Error("no reference rate");
		tamperedConversion.reimbursement = { amount: "88.73", currency: "EUR" };
		tampered.facts.totals = { ...tampered.facts.totals, reimbursable: "88.73" };
		expect(() => buildTravelExpenseExportFiles(manifest([tampered]))).toThrow(
			expect.objectContaining({ code: "totals_mismatch" }),
		);

		// A publication later than the expense date can never have been chosen.
		const later = referenceRateRevision();
		const laterConversion = later.facts.items[0]?.conversion;
		if (laterConversion?.basis !== "reference_rate") throw new Error("no reference rate");
		laterConversion.rateDate = "2026-04-07";
		expect(() => buildTravelExpenseExportFiles(manifest([later]))).toThrow(
			expect.objectContaining({ code: "totals_mismatch" }),
		);

		// Below v6 a reference rate cannot have been frozen at all.
		const early = referenceRateRevision();
		early.facts.schemaVersion = 5;
		expect(() => buildTravelExpenseExportFiles(manifest([early]))).toThrow(
			expect.objectContaining({ code: "manifest_invalid" }),
		);
	});

	it("exports a v4 project attribution as approved", () => {
		const revision = standaloneRevision();
		revision.facts.schemaVersion = 4;
		const [item] = revision.facts.items;
		if (!item) throw new Error("no item");
		item.project = {
			projectId: "project-1",
			name: "=Website relaunch",
			customerId: "customer-1",
			customerName: "ACME",
			inheritedFromTrip: false,
			basis: "exception",
			exception: {
				exceptionId: "exception-1",
				validFrom: "2026-09-01",
				validTo: "2026-09-30",
				reason: "Ad-hoc support",
				evidence: "Ticket 42",
				authorizedByEmployeeId: "emp-admin",
				authorizedAt: "2026-08-31T10:00:00Z",
			},
		};
		const [row] = records(file("expenses.csv", manifest([revision])));
		expect(row).toMatchObject({
			facts_schema_version: "4",
			project_id: "project-1",
			project_name: "'=Website relaunch",
			project_customer_id: "customer-1",
			project_customer_name: "ACME",
			project_inherited_from_trip: "false",
			project_attribution_basis: "exception",
			project_exception_id: "exception-1",
			calculation_basis: "receipt_amount",
			reimbursement_amount: "35.50",
			conversion_basis: "",
			mileage_route: "",
		});
	});

	it("exports a v5 mileage calculation and reconciles it with the frozen totals", () => {
		const revision = mileageRevision();
		const [row] = records(file("expenses.csv", manifest([revision])));
		expect(row).toMatchObject({
			facts_schema_version: "5",
			item_type: "mileage",
			expense_date: "2026-09-14",
			original_amount: "37.02",
			original_currency: "EUR",
			reimbursement_amount: "37.02",
			reimbursement_currency: "EUR",
			calculation_basis: "mileage_rate",
			mileage_route: "'-Berlin to Potsdam",
			mileage_distance_km: "123.40",
			mileage_vehicle: "car",
			mileage_rate_per_km: "0.3000",
			mileage_rate_currency: "EUR",
			mileage_exact_amount: "37.020000",
			mileage_rounding: "half_up",
			mileage_policy_id: "policy-1",
			mileage_policy_version_id: "version-1",
			mileage_policy_effective_from: "2026-01-01",
			mileage_policy_source: "statutory_default",
			mileage_policy_source_reference: "§ 9 EStG",
			mileage_policy_source_version: "LStH 2026",
			// Mileage expenses are attributed like any other (#605).
			project_id: "project-1",
			project_inherited_from_trip: "true",
			project_attribution_basis: "employee_assignment",
			conversion_basis: "",
			receipt_count: "0",
		});
		expect(records(file("reports.csv", manifest([revision])))).toEqual([
			expect.objectContaining({ reimbursable_total: "37.02", facts_schema_version: "5" }),
		]);
	});

	it("refuses a mileage item whose frozen amount differs from its calculation", () => {
		const revision = mileageRevision();
		const [item] = revision.facts.items;
		if (!item?.mileage) throw new Error("no mileage");
		item.mileage.amount = "38.00";
		expect(() => buildTravelExpenseExportFiles(manifest([revision]))).toThrow(
			expect.objectContaining({ code: "totals_mismatch" }),
		);
	});

	it("exports a v7 per diem breakdown with logical dates and reconciles it", () => {
		const revision = perDiemRevision();
		const [row] = records(file("expenses.csv", manifest([revision])));
		expect(row).toMatchObject({
			facts_schema_version: "7",
			item_type: "per_diem",
			expense_date: "2026-09-14",
			category: "meals",
			original_amount: "22.40",
			reimbursement_amount: "22.40",
			calculation_basis: "per_diem_calculation",
			per_diem_start_date: "2026-09-14",
			per_diem_start_time: "07:15",
			per_diem_start_time_zone: "Europe/Berlin",
			per_diem_start_at: "2026-09-14T05:15:00Z",
			per_diem_end_date: "2026-09-15",
			per_diem_end_at: "2026-09-15T17:40:00Z",
			per_diem_overnight: "away",
			per_diem_absence_minutes: "2185",
			per_diem_full_days: "0",
			per_diem_partial_days: "2",
			per_diem_allowance_before_meals: "28.00",
			per_diem_meal_deductions: "5.60",
			per_diem_amount: "22.40",
			per_diem_currency: "EUR",
			per_diem_rules_key: "de-domestic-per-diem-estg-9-4a-2026",
			per_diem_policy_version_ids: "pd-version-1",
			per_diem_days:
				"2026-09-14 partial_day 14.00-0.00=14.00; 2026-09-15 partial_day 14.00-5.60=8.40",
			mileage_route: "",
		});
		expect(records(file("reports.csv", manifest([revision])))).toEqual([
			expect.objectContaining({ reimbursable_total: "22.40", facts_schema_version: "7" }),
		]);
	});

	it("exports a legitimate zero per diem and refuses a breakdown that does not add up", () => {
		const zero = perDiemRevision();
		const [item] = zero.facts.items;
		if (!item?.perDiem) throw new Error("no per diem");
		item.perDiem.days = item.perDiem.days.map((day) => ({ ...day, deductions: day.rate, amount: "0.00" }));
		item.perDiem.amount = "0.00";
		item.original.amount = "0.00";
		zero.facts.totals.reimbursable = "0.00";
		expect(records(file("expenses.csv", manifest([zero])))[0]).toMatchObject({
			reimbursement_amount: "0.00",
			per_diem_amount: "0.00",
		});

		const broken = perDiemRevision();
		const [brokenItem] = broken.facts.items;
		if (!brokenItem?.perDiem?.days[0]) throw new Error("no per diem");
		brokenItem.perDiem.days[0].amount = "13.00";
		expect(() => buildTravelExpenseExportFiles(manifest([broken]))).toThrow(
			expect.objectContaining({ code: "totals_mismatch" }),
		);
	});

	it("refuses per diem facts in a revision older than version 7", () => {
		const revision = perDiemRevision();
		revision.facts.schemaVersion = 6;
		expect(() => buildTravelExpenseExportFiles(manifest([revision]))).toThrow(
			expect.objectContaining({ code: "manifest_invalid" }),
		);
	});

	it("exports a v9 per diem override with its evidence, facts and authorizer (#610)", () => {
		const revision = perDiemOverrideRevision();
		const [row] = records(file("expenses.csv", manifest([revision])));
		expect(row).toMatchObject({
			facts_schema_version: "9",
			item_type: "per_diem",
			original_amount: "112.80",
			reimbursement_amount: "112.80",
			calculation_basis: "allowance_override",
			allowance_override_id: "override-pd",
			allowance_override_situation: "unsupported_case",
			allowance_override_reasons: "international; foreign_time_zone",
			allowance_override_amount: "112.80",
			allowance_override_currency: "EUR",
			allowance_override_reason: "'=International trip",
			allowance_override_evidence: "BMF 2026, France: Paris",
			allowance_override_calculation_basis: "2 × 39.00 + 58.00 − 23.20",
			allowance_override_authorized_by_employee_id: "admin-1",
			allowance_override_authorized_by_name: "Ada Admin",
			allowance_override_authorized_at: "2026-09-20T08:00:00Z",
			allowance_override_start: "2026-09-14 07:00 Europe/Paris",
			allowance_override_end: "2026-09-16 18:00 Europe/Paris",
			allowance_override_route: "",
			// No ordinary result exists for an unsupported itinerary.
			per_diem_amount: "",
		});
		expect(records(file("reports.csv", manifest([revision])))[0]).toMatchObject({
			reimbursable_total: "112.80",
		});
	});

	it("exports a mileage override next to the ordinary policy result", () => {
		const revision = mileageRevision();
		revision.facts.schemaVersion = 9;
		const [item] = revision.facts.items;
		if (!item) throw new Error("no item");
		item.original.amount = "40.00";
		item.allowanceOverride = {
			overrideId: "override-km",
			kind: "mileage",
			amount: "40.00",
			currency: "EUR",
			reason: "Detour ordered by the customer",
			evidence: "Customer e-mail",
			calculationBasis: "133.33 km × 0.30",
			situation: { kind: "missing_coverage", reasons: ["policy_missing"] },
			scope: {
				kind: "mileage",
				expenseDate: "2026-09-14",
				route: "-Berlin to Potsdam",
				distanceKm: "123.40",
				vehicle: "car",
			},
			authorizedBy: { employeeId: "admin-1", name: "Ada Admin" },
			authorizedAt: "2026-09-20T08:00:00Z",
		};
		revision.facts.totals.reimbursable = "40.00";
		expect(records(file("expenses.csv", manifest([revision])))[0]).toMatchObject({
			reimbursement_amount: "40.00",
			calculation_basis: "allowance_override",
			mileage_rate_per_km: "0.3000",
			mileage_exact_amount: "37.020000",
			allowance_override_route: "'-Berlin to Potsdam",
			allowance_override_distance_km: "123.40",
			allowance_override_vehicle: "car",
		});
	});

	it("refuses an override that does not match the frozen amount or version", () => {
		const mismatch = perDiemOverrideRevision();
		const [item] = mismatch.facts.items;
		if (!item?.allowanceOverride) throw new Error("no override");
		item.allowanceOverride.amount = "100.00";
		expect(() => buildTravelExpenseExportFiles(manifest([mismatch]))).toThrow(
			expect.objectContaining({ code: "totals_mismatch" }),
		);
		const old = perDiemOverrideRevision();
		old.facts.schemaVersion = 8;
		expect(() => buildTravelExpenseExportFiles(manifest([old]))).toThrow(
			expect.objectContaining({ code: "manifest_invalid" }),
		);
	});

	it("exports revisions of every frozen facts version and refuses unknown ones", () => {
		// A new version must be mapped by the export contract before it is exported.
		expect(TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION).toBe(9);
		for (let version = 1; version <= TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION; version++) {
			const revision = standaloneRevision();
			revision.facts.schemaVersion = version;
			expect(records(file("reports.csv", manifest([revision])))).toEqual([
				expect.objectContaining({ facts_schema_version: String(version) }),
			]);
		}
		for (const version of [0, 10]) {
			const revision = standaloneRevision();
			revision.facts.schemaVersion = version;
			expect(() => buildTravelExpenseExportFiles(manifest([revision]))).toThrow(
				expect.objectContaining({ code: "manifest_invalid" }),
			);
		}
	});

	it("identifies an adjustment, the report it corrects and its signed delta (#615)", () => {
		const revision = standaloneRevision();
		revision.reportId = "report-adjustment";
		revision.facts.reportId = "report-adjustment";
		revision.facts.schemaVersion = 8;
		revision.facts.adjustment = {
			originalReportId: "report-solo-original",
			reason: "=Taxi refunded part of the fare",
			baseline: {
				originalReportId: "report-solo-original",
				revisionId: "rev-original",
				submissionCycle: 1,
				currency: "CHF",
				approvedAmount: "50.00",
				adjustments: [],
				entitlement: "50.00",
			},
			delta: { amount: "-14.50", currency: "CHF" },
		};
		const input = manifest([standaloneRevision(), revision]);
		expect(records(file("reports.csv", input))).toEqual([
			expect.objectContaining({
				report_id: "report-solo",
				record_type: "original",
				adjusts_report_id: "",
				adjustment_delta: "",
			}),
			expect.objectContaining({
				report_id: "report-adjustment",
				reimbursable_total: "35.50",
				record_type: "adjustment",
				adjusts_report_id: "report-solo-original",
				adjustment_reason: "'=Taxi refunded part of the fare",
				adjustment_baseline_revision_id: "rev-original",
				adjustment_baseline_entitlement: "50.00",
				// A negative delta stays a number, not an escaped formula.
				adjustment_delta: "-14.50",
			}),
		]);
		expect(records(file("expenses.csv", input)).map((row) => row.record_type)).toEqual([
			"original",
			"adjustment",
		]);

		// A delta that does not follow from its baseline is never exported.
		const inconsistent = structuredClone(revision);
		if (inconsistent.facts.adjustment) inconsistent.facts.adjustment.delta.amount = "-10.00";
		expect(() => buildTravelExpenseExportFiles(manifest([inconsistent]))).toThrow(
			expect.objectContaining({ code: "manifest_invalid" }),
		);
		const early = structuredClone(revision);
		early.facts.schemaVersion = 7;
		expect(() => buildTravelExpenseExportFiles(manifest([early]))).toThrow(
			expect.objectContaining({ code: "manifest_invalid" }),
		);
	});

	it("is byte-identical for the same manifest", () => {
		expect(buildTravelExpenseExportFiles(manifest())).toEqual(
			buildTravelExpenseExportFiles(manifest()),
		);
	});
});
