import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { ApprovalDatabase } from "../server/types";
import { ApprovalEvidenceError } from "./errors";
import {
	buildTravelExpenseReportSubmittedFacts,
	TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION,
	type TravelExpenseReportFactsInput,
	type TravelExpenseReportSubmittedFacts,
} from "./travel-expense-report-facts";
import {
	captureTravelExpenseReportSubmittedRevision,
	loadTravelExpenseReportSubmittedRevision,
} from "./travel-expense-report-store";

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

type Row = Record<string, unknown>;

/** Stores inserted revision rows and serves them back, like the evidence table. */
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

async function expectInvariant(promise: Promise<unknown>) {
	await expect(promise).rejects.toBeInstanceOf(ApprovalEvidenceError);
	await expect(promise).rejects.toMatchObject({ code: "invariant" });
}

describe("travel expense report revisions", () => {
	it("reads a captured schema version 1 revision back unchanged", async () => {
		const { database, rows } = fakeRevisionTable();
		// Later versions only add optional facts this report does not have.
		const facts = { ...buildTravelExpenseReportSubmittedFacts(factsInput), schemaVersion: 1 };
		await capture(database, facts);

		const loaded = await loadTravelExpenseReportSubmittedRevision(database, scope);

		expect(rows[0]?.schemaVersion).toBe(1);
		expect(loaded?.facts).toEqual(facts);
		expect(loaded?.materialFingerprint).toMatch(/^travel_expense_report:v1:[0-9a-f]{64}$/);
	});

	it("refuses a revision of a version this build does not know", async () => {
		for (const version of [0, TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION + 1, 1.5]) {
			const { database, rows } = fakeRevisionTable();
			await capture(database, buildTravelExpenseReportSubmittedFacts(factsInput));
			const row = rows[0] as Row;
			row.schemaVersion = version;
			row.facts = { ...(row.facts as Row), schemaVersion: version };
			await expectInvariant(loadTravelExpenseReportSubmittedRevision(database, scope));
		}
	});

	it("refuses facts whose version disagrees with their row", async () => {
		const { database, rows } = fakeRevisionTable();
		await capture(database, buildTravelExpenseReportSubmittedFacts(factsInput));
		(rows[0] as Row).schemaVersion = 1;
		await expectInvariant(loadTravelExpenseReportSubmittedRevision(database, scope));
	});
});
