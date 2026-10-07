import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { TravelExpenseReportSubmittedRevisionRecord } from "../evidence/travel-expense-report-store";
import {
	buildTravelExpenseReportReviewSections,
	travelExpenseReportDecisionLabel,
} from "./travel-expense-report-review";

function revision(): TravelExpenseReportSubmittedRevisionRecord {
	const receipt = (receiptId: string, itemId: string) => ({
		receiptId,
		itemId,
		object: { provider: "s3-private", bucket: "b", key: `k-${receiptId}`, versionId: null },
		checksumSha256: "a".repeat(64),
		sizeBytes: 10,
		mimeType: "application/pdf",
	});
	return {
		id: "rev-1",
		authority: "legacy",
		organizationId: "org-1",
		reportId: "report-1",
		submissionCycle: 1,
		requestCycleKey: "travel_expense_report:report-1:submission:1",
		revision: 1,
		subjectEmployeeId: "e-1",
		requesterEmployeeId: "e-1",
		submitter: { kind: "employee", employeeId: "e-1", userId: "u-1" },
		materialFingerprint: "travel_expense_report:v1:x",
		facts: {
			schemaVersion: 1,
			kind: "travel_expense_report",
			organizationId: "org-1",
			reportId: "report-1",
			submissionCycle: 1,
			subjectEmployeeId: "e-1",
			requesterEmployeeId: "e-1",
			reportKind: "trip",
			reimbursementCurrency: "EUR",
			trip: {
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "Asia/Tokyo",
				destinations: [{ place: "Osaka", countryCode: "JP" }],
			},
			items: [
				{
					itemId: "train",
					position: 0,
					type: "receipt",
					expenseDate: "2026-09-14",
					category: "transport",
					description: "Shinkansen",
					original: { amount: "89.90", currency: "EUR" },
					paidBy: "employee",
					accountingReference: "PRJ-7",
					receipts: [receipt("r-1", "train")],
				},
				{
					itemId: "hotel",
					position: 1,
					type: "receipt",
					expenseDate: "2026-09-15",
					category: "accommodation",
					description: "Hotel",
					original: { amount: "240.00", currency: "EUR" },
					paidBy: "company",
					accountingReference: null,
					receipts: [receipt("r-2", "hotel"), receipt("r-3", "hotel")],
				},
			],
			totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "240.00" },
		},
		labels: {
			subjectName: "Avery Requester",
			submitterName: "Avery Requester",
			receiptFileNames: { "r-1": "ticket.pdf", "r-2": "hotel.pdf", "r-3": "folio.pdf" },
		},
		submittedAt: parseInstant("2026-09-17T08:00:00Z"),
		legacy: { approvalRequestId: "req-1", chainInstanceId: null, observedWorkflowId: null },
	};
}

describe("buildTravelExpenseReportReviewSections", () => {
	it("shows the frozen trip, its totals and every expense with its receipts", () => {
		const { sections, decisionsBlocked } = buildTravelExpenseReportReviewSections({
			status: "evidenced",
			revision: revision(),
			comparison: { kind: "current" },
			decisions: [],
		});

		expect(decisionsBlocked).toBe(false);
		const [report, train, hotel] = sections;
		expect(report).toMatchObject({
			type: "key_value",
			rows: expect.arrayContaining([
				expect.objectContaining({ value: "Customer workshop" }),
				// Travel dates as entered, with the zone they are calendar days in.
				expect.objectContaining({
					value: { kind: "plain_date_range", start: "2026-09-14", end: "2026-09-16" },
				}),
				expect.objectContaining({ value: "Asia/Tokyo" }),
				// Typed values the viewer formats in their locale (#687).
				expect.objectContaining({
					value: expect.objectContaining({
						params: {
							destinations: [
								{
									key: "approvals:approvals.evidence.destinationPlace",
									fallback: "{place}, {country}",
									params: { place: "Osaka", country: { kind: "country", code: "JP" } },
								},
							],
						},
					}),
				}),
				expect.objectContaining({ value: { kind: "money", amount: "89.90", currency: "EUR" } }),
				expect.objectContaining({ value: { kind: "money", amount: "240.00", currency: "EUR" } }),
			]),
		});
		expect(train).toMatchObject({
			type: "key_value",
			title: "1. Shinkansen",
			// The description as the employee wrote it, never restyled as a heading label.
			titleAsEntered: true,
			rows: expect.arrayContaining([
				expect.objectContaining({ value: { kind: "plain_date", date: "2026-09-14" } }),
				expect.objectContaining({ value: { kind: "money", amount: "89.90", currency: "EUR" } }),
				expect.objectContaining({ value: "PRJ-7" }),
				expect.objectContaining({ value: "1: ticket.pdf" }),
			]),
		});
		expect(hotel).toMatchObject({
			title: "2. Hotel",
			rows: expect.arrayContaining([
				expect.objectContaining({
					value: { key: "approvals:approvals.evidence.paidByCompany", fallback: "Company" },
				}),
				expect.objectContaining({ value: "2: hotel.pdf, folio.pdf" }),
			]),
		});
		expect(sections.at(-1)).toMatchObject({
			type: "timeline",
			events: [
				expect.objectContaining({
					label: { key: "approvals:approvals.evidence.submitted", fallback: "Submitted" },
					at: "2026-09-17T08:00:00Z",
				}),
			],
		});
	});

	it("labels a return as a return, never as a rejection (#603)", () => {
		expect(
			travelExpenseReportDecisionLabel({
				requestOutcome: "rejected",
				assignmentOutcome: "rejected",
				result: { reportStatus: "returned", disposition: "returned" },
			}),
		).toEqual({
			key: "approvals:approvals.evidence.reportReturnedForChanges",
			fallback: "Report returned for changes",
		});
		expect(
			travelExpenseReportDecisionLabel({
				requestOutcome: "rejected",
				assignmentOutcome: "rejected",
				result: { reportStatus: "rejected" },
			}).fallback,
		).toBe("Report rejected");
	});

	it("shows an earlier cycle as history with the earlier cycles' return notes", () => {
		const earlier = revision();
		const { sections, decisionsBlocked } = buildTravelExpenseReportReviewSections({
			status: "evidenced",
			revision: { ...earlier, facts: { ...earlier.facts, submissionCycle: 2 } },
			comparison: { kind: "current" },
			decisions: [],
			latestCycle: false,
			earlierCycles: [
				{
					submissionCycle: 1,
					kind: "returned",
					note: "Please attach the hotel folio",
					actorName: "Riley Reviewer",
					closedAt: parseInstant("2026-09-16T10:00:00Z"),
					itemComments: [
						{ itemId: "item-2", itemLabel: "Hotel", body: "Folio missing" },
						{ itemId: "item-gone", itemLabel: null, body: "Duplicate" },
					],
				},
			],
		});
		expect(decisionsBlocked).toBe(false);
		expect(sections[0]).toMatchObject({
			type: "callout",
			tone: "info",
			title: { key: "approvals:approvals.evidence.reportEarlierCycleTitle", params: { cycle: 2 } },
		});
		expect(sections).toContainEqual(
			expect.objectContaining({
				type: "key_value",
				title: expect.objectContaining({
					key: "approvals:approvals.evidence.reportCycleReturned",
					params: { cycle: 1 },
				}),
				rows: expect.arrayContaining([
					expect.objectContaining({ value: "Riley Reviewer" }),
					expect.objectContaining({ value: "Please attach the hotel folio" }),
					expect.objectContaining({
						label: expect.objectContaining({ params: { item: "Hotel" } }),
						value: "Folio missing",
					}),
					expect.objectContaining({
						label: expect.objectContaining({
							key: "approvals:approvals.evidence.reportCycleRemovedItemComment",
						}),
						value: "Duplicate",
					}),
				]),
			}),
		);
	});

	it("blocks decisions when the live report no longer matches its submission", () => {
		const { sections, decisionsBlocked } = buildTravelExpenseReportReviewSections({
			status: "evidenced",
			revision: revision(),
			comparison: { kind: "material_change", changedFields: ["items"] },
			decisions: [],
		});
		expect(decisionsBlocked).toBe(true);
		expect(sections).toContainEqual(expect.objectContaining({ type: "callout", tone: "danger" }));
	});

	it("blocks decisions when no frozen submission exists", () => {
		expect(buildTravelExpenseReportReviewSections({ status: "not_captured" })).toEqual({
			sections: [expect.objectContaining({ type: "callout", tone: "warning" })],
			decisionsBlocked: true,
		});
	});
});
