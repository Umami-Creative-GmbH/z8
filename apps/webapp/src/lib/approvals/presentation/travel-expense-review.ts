import { db } from "@/db";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import {
	type LegacyDecisionEvidenceRecord,
	type LegacyTravelExpenseSubmittedRevisionRecord,
	listLegacyDecisionEvidence,
	loadLegacyTravelExpenseSubmittedRevision,
	readApprovalEvidenceMode,
} from "../evidence/store";
import type { TravelExpenseRevisionComparison } from "../evidence/travel-expense-facts";
import { compareTravelExpenseWithSubmittedRevision } from "../evidence/travel-expense-submission";
import type { ApprovalInboxDetailSection } from "../inbox/types";
import type { ApprovalDatabase } from "../server/types";

export type TravelExpenseReviewEvidence =
	| {
			/** No frozen submission exists. While capture is active this is a hold. */
			status: "not_captured";
			held: boolean;
	  }
	| {
			status: "evidenced";
			revision: LegacyTravelExpenseSubmittedRevisionRecord;
			comparison: TravelExpenseRevisionComparison;
			decisions: LegacyDecisionEvidenceRecord[];
	  };

/**
 * Scoped review preparation for an expense claim (#296): its frozen
 * submission (#295), whether the live claim and receipts still match it, and
 * each committed decision's original evidence. Mirrors the decision owner's
 * holds exactly. Infrastructure errors throw.
 */
export async function prepareTravelExpenseReviewEvidence(
	input: { organizationId: string; claimId: string },
	database: ApprovalDatabase = db,
): Promise<TravelExpenseReviewEvidence> {
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: "travel_expense",
		}),
		loadLegacyTravelExpenseSubmittedRevision(database, input),
	]);
	if (!revision) return { status: "not_captured", held: mode === "capture" };
	const [comparison, decisions] = await Promise.all([
		compareTravelExpenseWithSubmittedRevision(database, revision),
		listLegacyDecisionEvidence(database, {
			organizationId: input.organizationId,
			submittedRevisionId: revision.id,
		}),
	]);
	return { status: "evidenced", revision, comparison, decisions };
}

const UNAVAILABLE = {
	key: "approvals:approvals.evidence.unavailable",
	fallback: "Unavailable",
};

const CLAIM_TYPES = {
	receipt: { key: "approvals:approvals.evidence.claimTypeReceipt", fallback: "Receipt" },
	mileage: { key: "approvals:approvals.evidence.claimTypeMileage", fallback: "Mileage" },
	per_diem: { key: "approvals:approvals.evidence.claimTypePerDiem", fallback: "Per diem" },
} as const;

function decisionLabel(decision: LegacyDecisionEvidenceRecord): string {
	if (decision.operationKind === "submission_activation") {
		return decision.requestOutcome === "approved"
			? "Approved automatically during submission"
			: "Resolved automatically during submission";
	}
	if (decision.requestOutcome === "approved") return "Claim approved";
	if (decision.requestOutcome === "rejected") return "Claim rejected";
	if (decision.assignmentOutcome === "approved") {
		return "Approval recorded — awaiting further approval";
	}
	return "Decision recorded";
}

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

/**
 * Renders a claim's frozen submission into authenticated review sections.
 * Logical trip dates are shown exactly as entered with the zone they were
 * entered in; amounts are the persisted values, never recalculated. Notes and
 * receipt contents stay where they are; receipt file names are review-only.
 */
export function buildTravelExpenseReviewSections(evidence: TravelExpenseReviewEvidence): {
	sections: ApprovalInboxDetailSection[];
	decisionsBlocked: boolean;
} {
	if (evidence.status === "not_captured") {
		return evidence.held
			? {
					sections: [
						{
							type: "callout",
							title: "Submitted facts unavailable",
							body: "The facts submitted for this claim were not recorded, so a decision cannot be bound to them. The claim is held for review.",
							tone: "warning",
						},
					],
					decisionsBlocked: true,
				}
			: { sections: [], decisionsBlocked: false };
	}
	const { revision, comparison, decisions } = evidence;
	const { facts, labels } = revision;
	const rows: Row[] = [
		{
			label: { key: "approvals:approvals.employee", fallback: "Employee" },
			value: labels.subjectName ?? UNAVAILABLE,
		},
	];
	if (
		revision.submitter.kind !== "employee" ||
		revision.submitter.employeeId !== revision.requesterEmployeeId
	) {
		rows.push({
			label: { key: "approvals:approvals.evidence.submittedBy", fallback: "Submitted by" },
			value: labels.submitterName ?? UNAVAILABLE,
		});
	}
	const { startDate, endDate, interpretation } = facts.tripDates;
	rows.push(
		{
			label: { key: "approvals:approvals.evidence.claimType", fallback: "Claim type" },
			value: CLAIM_TYPES[facts.claimType] ?? UNAVAILABLE,
		},
		{
			label: { key: "approvals:approvals.evidence.tripDates", fallback: "Trip dates" },
			// Logical dates as entered; they never shift by zone.
			value: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
		},
		{
			label: {
				key: "approvals:approvals.evidence.tripDatesZone",
				fallback: "Dates entered in",
			},
			value: interpretation.zone,
		},
		{
			label: { key: "approvals:approvals.evidence.claimAmount", fallback: "Claim amount" },
			value: `${facts.money.calculated.amount} ${facts.money.calculated.currency}`,
		},
	);
	const { original, calculated } = facts.money;
	if (original.amount !== calculated.amount || original.currency !== calculated.currency) {
		rows.push({
			label: {
				key: "approvals:approvals.evidence.originalAmount",
				fallback: "Original amount",
			},
			value: `${original.amount} ${original.currency}`,
		});
	}
	const destination = [facts.destination.city, facts.destination.country]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join(", ");
	if (destination) {
		rows.push({
			label: { key: "approvals:approvals.evidence.destination", fallback: "Destination" },
			value: destination,
		});
	}
	if (facts.projectId) {
		rows.push({
			label: { key: "approvals:approvals.evidence.project", fallback: "Project" },
			value: labels.projectName ?? UNAVAILABLE,
		});
	}
	if (facts.receipts.required || facts.receipts.manifest.length > 0) {
		const names = facts.receipts.manifest.map(
			(item) => labels.receiptFileNames[item.attachmentId] ?? item.attachmentId,
		);
		rows.push({
			label: { key: "approvals:approvals.evidence.receipts", fallback: "Receipts" },
			value: names.length > 0 ? `${names.length}: ${names.join(", ")}` : "0",
		});
	}

	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: {
				key: "approvals:approvals.evidence.submittedClaimTitle",
				fallback: "Submitted claim",
			},
			rows,
		},
	];
	if (comparison.kind === "material_change") {
		sections.push({
			type: "callout",
			title: "Claim changed after submission",
			body: `The live claim no longer matches what was submitted for approval (changed: ${comparison.changedFields.join(", ")}). A decision cannot be recorded; the employee must submit a new claim.`,
			tone: "danger",
		});
	}
	sections.push({
		type: "timeline",
		title: "Evidence history",
		events: [
			{
				id: `evidence-submitted-${revision.id}`,
				label: "Submitted",
				at: instantToCanonicalString(revision.submittedAt),
				actorName: labels.submitterName,
			},
			...decisions.map((decision) => ({
				id: `evidence-decision-${decision.id}`,
				label: decisionLabel(decision),
				// Persisted decision time; never the render or retry time.
				at: instantToCanonicalString(decision.decidedAt),
				actorName: decision.labels.actorName,
			})),
		],
	});
	return { sections, decisionsBlocked: comparison.kind === "material_change" };
}
