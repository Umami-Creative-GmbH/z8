import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	LegacyDecisionEvidenceRecord,
	LegacyTravelExpenseSubmittedRevisionRecord,
} from "../evidence/store";
import type { ApprovalInboxDetailSection } from "../inbox/types";
import { buildTravelExpenseReviewSections } from "./travel-expense-review";

function revision(): LegacyTravelExpenseSubmittedRevisionRecord {
	return {
		id: "rev-1",
		authority: "legacy",
		organizationId: "org-1",
		claimId: "claim-1",
		requestCycleKey: "travel_expense_claim:claim-1:submission",
		revision: 1,
		subjectEmployeeId: "e-subject",
		requesterEmployeeId: "e-subject",
		submitter: { kind: "employee", employeeId: "e-subject", userId: "u" },
		materialFingerprint: "travel_expense:v1:x",
		facts: {
			schemaVersion: 1,
			kind: "travel_expense",
			organizationId: "org-1",
			claimId: "claim-1",
			subjectEmployeeId: "e-subject",
			requesterEmployeeId: "e-subject",
			claimType: "receipt",
			tripDates: {
				startDate: "2026-03-29",
				endDate: "2026-03-31",
				interpretation: { source: "entered_logical_dates", zone: "Europe/Berlin" },
			},
			money: {
				original: { amount: "95.00", currency: "GBP" },
				calculated: { amount: "110.20", currency: "EUR" },
			},
			destination: { city: "Hamburg", country: null },
			receipts: {
				required: true,
				manifest: [
					{
						attachmentId: "att-1",
						claimId: "claim-1",
						object: { provider: "s3-private", bucket: "b", key: "k", versionId: null },
						checksumSha256: "a".repeat(64),
						sizeBytes: 1,
						mimeType: "application/pdf",
					},
				],
			},
			projectId: null,
			compatibility: {
				encoding: "effective_zone_day_bounds",
				tripStartAt: "2026-03-28T23:00:00Z",
				tripEndAt: "2026-03-31T21:59:59.999Z",
			},
		},
		labels: {
			subjectName: "Avery Requester",
			requesterName: "Avery Requester",
			submitterName: "Avery Requester",
			projectName: null,
			receiptFileNames: { "att-1": "hotel.pdf" },
		},
		provenance: "captured_at_submission",
		submittedAt: parseInstant("2026-07-01T08:00:00Z"),
		legacy: { approvalRequestId: "request-1", chainInstanceId: null, observedWorkflowId: null },
	};
}

function decision(
	overrides: Partial<LegacyDecisionEvidenceRecord>,
): LegacyDecisionEvidenceRecord {
	return {
		id: "decision-1",
		authority: "legacy",
		organizationId: "org-1",
		submittedRevisionId: "rev-1",
		operationKind: "command",
		receipt: { idempotencyKey: "k", actorFingerprint: "a", commandFingerprint: "c" },
		action: "approve",
		legacy: { approvalRequestId: "request-1", chainStageId: "stage-1", observedWorkflowId: null },
		assignmentOutcome: "approved",
		requestOutcome: "pending",
		actor: { kind: "employee", employeeId: "e-manager", userId: "u-manager" },
		decidedAt: parseInstant("2026-07-02T09:00:00Z"),
		result: {},
		labels: { actorName: "Morgan Manager" },
		reviewedBindingId: null,
		...overrides,
	};
}

function keyValues(sections: ApprovalInboxDetailSection[]) {
	const section = sections.find((candidate) => candidate.type === "key_value");
	if (section?.type !== "key_value") throw new Error("no submitted section");
	return Object.fromEntries(
		section.rows.map((row) => [
			typeof row.label === "string" ? row.label : row.label.fallback,
			typeof row.value === "string"
				? row.value
				: "fallback" in row.value
					? row.value.fallback
					: "change",
		]),
	);
}

describe("buildTravelExpenseReviewSections", () => {
	it("shows the frozen claim, the entry zone of its logical dates and its receipts", () => {
		const review = buildTravelExpenseReviewSections({
			status: "evidenced",
			revision: revision(),
			comparison: { kind: "current" },
			decisions: [],
		});
		expect(review.decisionsBlocked).toBe(false);
		expect(keyValues(review.sections)).toEqual({
			Employee: "Avery Requester",
			"Claim type": "Receipt",
			"Trip dates": "2026-03-29 – 2026-03-31",
			"Dates entered in": "Europe/Berlin",
			"Claim amount": "110.20 EUR",
			"Original amount": "95.00 GBP",
			Destination: "Hamburg",
			Receipts: "1: hotel.pdf",
		});
	});

	it("separates an intermediate approval from the claim outcome in the history", () => {
		const review = buildTravelExpenseReviewSections({
			status: "evidenced",
			revision: revision(),
			comparison: { kind: "current" },
			decisions: [
				decision({}),
				decision({
					id: "decision-2",
					requestOutcome: "approved",
					decidedAt: parseInstant("2026-07-03T09:00:00Z"),
				}),
			],
		});
		const timeline = review.sections.find((section) => section.type === "timeline");
		expect(timeline?.type === "timeline" && timeline.events).toEqual([
			{
				id: "evidence-submitted-rev-1",
				label: "Submitted",
				at: "2026-07-01T08:00:00Z",
				actorName: "Avery Requester",
			},
			{
				id: "evidence-decision-decision-1",
				label: "Approval recorded — awaiting further approval",
				at: "2026-07-02T09:00:00Z",
				actorName: "Morgan Manager",
			},
			{
				id: "evidence-decision-decision-2",
				label: "Claim approved",
				at: "2026-07-03T09:00:00Z",
				actorName: "Morgan Manager",
			},
		]);
	});

	it("holds decisions on a claim that changed after submission", () => {
		const review = buildTravelExpenseReviewSections({
			status: "evidenced",
			revision: revision(),
			comparison: { kind: "material_change", changedFields: ["receipts"] },
			decisions: [],
		});
		expect(review.decisionsBlocked).toBe(true);
		expect(review.sections).toContainEqual(
			expect.objectContaining({
				type: "callout",
				tone: "danger",
				title: "Claim changed after submission",
			}),
		);
	});

	it("holds claims without a frozen submission only while capture is active", () => {
		expect(buildTravelExpenseReviewSections({ status: "not_captured", held: false })).toEqual({
			sections: [],
			decisionsBlocked: false,
		});
		const held = buildTravelExpenseReviewSections({ status: "not_captured", held: true });
		expect(held.decisionsBlocked).toBe(true);
		expect(held.sections[0]).toMatchObject({ type: "callout", tone: "warning" });
	});
});
