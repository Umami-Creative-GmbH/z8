import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalDatabase } from "../server/types";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	type TravelExpenseReportFactsInput,
	type TravelExpenseReportSubmittedFacts,
} from "./travel-expense-report-facts";
import {
	captureTravelExpenseReportSubmittedRevision,
	loadTravelExpenseReportSubmittedRevision,
} from "./travel-expense-report-store";

// Simulates the build after a later ticket bumps the schema version: the
// builder still freezes today's (v3, #607) facts, but the reader knows v1..v4.
vi.mock("./travel-expense-report-facts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./travel-expense-report-facts")>()),
	TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION: 4,
}));

const scope = { organizationId: "org-1", reportId: "report-1" };

const factsInput: TravelExpenseReportFactsInput = {
	report: {
		id: "report-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		kind: "standalone",
		reimbursementCurrency: "EUR",
		submissionCount: 1,
		tripPurpose: null,
		tripStartDate: null,
		tripEndDate: null,
		tripTimeZone: null,
		tripDestinations: [],
	},
	items: [
		{
			id: "train",
			organizationId: "org-1",
			reportId: "report-1",
			type: "receipt",
			position: 0,
			expenseDate: "2026-09-14",
			category: "transport",
			description: "Train to Hamburg",
			originalAmount: "89.90",
			originalCurrency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	],
	receipts: [
		{
			id: "r-1",
			organizationId: "org-1",
			reportId: "report-1",
			itemId: "train",
			storageProvider: "s3-private",
			storageBucket: "private-bucket",
			storageKey: "travel-expenses/org-1/reports/report-1/train/r-1-receipt.pdf",
			storageVersionId: "v1",
			checksumSha256: "a".repeat(64),
			sizeBytes: 2048,
			mimeType: "application/pdf",
		},
	],
};

const tripFields = {
	tripPurpose: "Customer workshop",
	tripStartDate: "2026-09-14",
	tripEndDate: "2026-09-16",
	tripTimeZone: "Europe/Berlin",
	tripDestinations: [{ place: "Hamburg", countryCode: "DE" }],
};

type Row = Record<string, unknown>;

function fakeRevisionTable() {
	const rows: Row[] = [];
	const database = {
		insert: () => ({
			values: (values: Row) => ({
				returning: async () => {
					const row = { id: `rev-${rows.length + 1}`, createdAt: new Date(), ...values };
					rows.push(row);
					return [row];
				},
			}),
		}),
		select: () => ({
			from: () => ({
				where: () => ({ orderBy: () => ({ limit: async () => rows.slice(-1) }) }),
			}),
		}),
	} as unknown as ApprovalDatabase;
	return { database, rows };
}

async function capture(database: ApprovalDatabase, facts: TravelExpenseReportSubmittedFacts) {
	return captureTravelExpenseReportSubmittedRevision(database, {
		organizationId: "org-1",
		submittedAt: Temporal.Instant.from("2026-09-20T08:00:00Z"),
		facts,
		labels: { subjectName: "Ada", submitterName: "Ada", receiptFileNames: {} },
		submitter: { employeeId: "employee-1", userId: "user-1" },
		legacy: { approvalRequestId: "request-1", chainInstanceId: null, observedWorkflowId: null },
	});
}

describe("after a schema version bump", () => {
	it("still reads a v1 revision with its v1 fingerprint", async () => {
		const { database } = fakeRevisionTable();
		// A report without later optional facts froze the same facts as version 1.
		const facts = { ...buildTravelExpenseReportSubmittedFacts(factsInput), schemaVersion: 1 };
		await capture(database, facts);

		const loaded = await loadTravelExpenseReportSubmittedRevision(database, scope);

		expect(loaded?.facts).toEqual(facts);
		expect(loaded?.materialFingerprint).toMatch(/^travel_expense_report:v1:/);
	});

	it("still reads a v2 revision with its missing-receipt exception (#604)", async () => {
		const { database } = fakeRevisionTable();
		const withException: TravelExpenseReportFactsInput = {
			...factsInput,
			items: [
				...factsInput.items,
				{
					...factsInput.items[0],
					id: "dinner",
					position: 1,
					category: "meals",
					description: "Customer dinner",
					originalAmount: "64.20",
					receiptExceptionReason: "The restaurant printer was broken",
				},
			],
			report: { ...factsInput.report, kind: "trip", ...tripFields },
			receiptExceptionsAllowed: true,
		};
		const facts = { ...buildTravelExpenseReportSubmittedFacts(withException), schemaVersion: 2 };
		await capture(database, facts);

		const loaded = await loadTravelExpenseReportSubmittedRevision(database, scope);

		expect(loaded?.facts).toEqual(facts);
		expect(loaded?.facts.items[1]?.receiptException).toEqual({
			reason: "The restaurant printer was broken",
		});
		expect(loaded?.materialFingerprint).toMatch(/^travel_expense_report:v2:/);
		expect(compareLiveTravelExpenseReportWithRevision(facts, withException)).toEqual({
			kind: "current",
		});
	});

	it("reads a revision of the new version under its own fingerprint prefix", async () => {
		const { database } = fakeRevisionTable();
		const facts = { ...buildTravelExpenseReportSubmittedFacts(factsInput), schemaVersion: 4 };
		await capture(database, facts);

		const loaded = await loadTravelExpenseReportSubmittedRevision(database, scope);

		expect(loaded?.materialFingerprint).toMatch(/^travel_expense_report:v4:/);
	});

	it("refuses a revision newer than the build", async () => {
		const { database } = fakeRevisionTable();
		const facts = { ...buildTravelExpenseReportSubmittedFacts(factsInput), schemaVersion: 5 };
		await expect(capture(database, facts)).rejects.toMatchObject({ code: "invariant" });
	});

	it("does not hold an unchanged v1 report as a material change", () => {
		const submitted = { ...buildTravelExpenseReportSubmittedFacts(factsInput), schemaVersion: 1 };
		expect(compareLiveTravelExpenseReportWithRevision(submitted, factsInput)).toEqual({
			kind: "current",
		});
	});
});
