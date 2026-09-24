import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalWorkflowRollout } from "@/db/schema";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import {
	type AbsenceRevisionComparison,
	type AbsenceSubmittedCoverage,
	compareLiveAbsenceWithRevision,
} from "../evidence/absence-facts";
import {
	type AbsenceSubmittedRevisionRecord,
	type DecisionEvidenceRecord,
	listDecisionEvidence,
	loadCurrentAbsenceSubmittedRevision,
	readApprovalEvidenceMode,
} from "../evidence/store";
import type { ApprovalInboxDetailSection } from "../inbox/types";
import type { ApprovalDatabase } from "../server/types";

type DayPeriod = "full_day" | "am" | "pm";

export type AbsenceReviewEvidence =
	| {
			/** No submitted revision exists. While capture is active this is a hold. */
			status: "not_captured";
			held: boolean;
	  }
	| {
			status: "evidenced";
			revision: AbsenceSubmittedRevisionRecord;
			comparison: AbsenceRevisionComparison;
			decisions: DecisionEvidenceRecord[];
	  };

interface LiveAbsenceEntity {
	id: string;
	organizationId: string;
	employeeId: string;
	categoryId: string;
	approvalWorkflowId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	category: { name: string | null } | null;
}

const PERIODS = new Set<unknown>(["full_day", "am", "pm"]);

function canonicalAbsenceEntity(entity: unknown): LiveAbsenceEntity | null {
	if (typeof entity !== "object" || entity === null) return null;
	const value = entity as Record<string, unknown>;
	if (typeof value.approvalWorkflowId !== "string") return null;
	const category =
		typeof value.category === "object" && value.category !== null
			? (value.category as Record<string, unknown>)
			: null;
	if (
		typeof value.id !== "string" ||
		typeof value.organizationId !== "string" ||
		typeof value.employeeId !== "string" ||
		typeof value.categoryId !== "string" ||
		typeof value.startDate !== "string" ||
		typeof value.endDate !== "string" ||
		!PERIODS.has(value.startPeriod) ||
		!PERIODS.has(value.endPeriod)
	) {
		return null;
	}
	return {
		id: value.id,
		organizationId: value.organizationId,
		employeeId: value.employeeId,
		categoryId: value.categoryId,
		approvalWorkflowId: value.approvalWorkflowId,
		startDate: value.startDate,
		startPeriod: value.startPeriod as DayPeriod,
		endDate: value.endDate,
		endPeriod: value.endPeriod as DayPeriod,
		category: {
			name: typeof category?.name === "string" ? category.name : null,
		},
	};
}

/**
 * Scoped review preparation for a canonical absence: the immutable submitted
 * revision, whether live facts still match it (label-only versus material
 * change), and each committed decision's original evidence. Returns null for
 * requests outside canonical absence authority. Infrastructure errors throw.
 */
export async function prepareAbsenceReviewEvidence(
	input: { organizationId: string; entity: unknown },
	database: ApprovalDatabase = db,
): Promise<AbsenceReviewEvidence | null> {
	const live = canonicalAbsenceEntity(input.entity);
	if (!live || live.organizationId !== input.organizationId) return null;
	const scope = {
		organizationId: input.organizationId,
		workflowId: live.approvalWorkflowId,
	};
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: "absence",
		}),
		loadCurrentAbsenceSubmittedRevision(database, scope),
	]);
	if (!revision) {
		if (mode !== "capture") return { status: "not_captured", held: false };
		// Only canonical authority enforces the hold; mirror the server exactly.
		const rollout = await database
			.select({ mode: approvalWorkflowRollout.lifecycleMode })
			.from(approvalWorkflowRollout)
			.where(
				and(
					eq(approvalWorkflowRollout.organizationId, input.organizationId),
					eq(approvalWorkflowRollout.workflowType, "absence"),
				),
			)
			.limit(1);
		const lifecycle = rollout[0]?.mode;
		return {
			status: "not_captured",
			held: lifecycle === "canonical" || lifecycle === "complete",
		};
	}
	if (revision.sourceId !== live.id) return null;
	const comparison = compareLiveAbsenceWithRevision(
		revision.facts,
		revision.labels,
		{
			organizationId: live.organizationId,
			absenceId: live.id,
			employeeId: live.employeeId,
			categoryId: live.categoryId,
			startDate: live.startDate,
			startPeriod: live.startPeriod,
			endDate: live.endDate,
			endPeriod: live.endPeriod,
			categoryName: live.category?.name ?? null,
		},
	);
	const decisions = await listDecisionEvidence(database, scope);
	return { status: "evidenced", revision, comparison, decisions };
}

const UNAVAILABLE = {
	key: "approvals:approvals.evidence.unavailable",
	fallback: "Unavailable",
};

const PERIOD_TEXT: Record<DayPeriod, { key: string; fallback: string }> = {
	full_day: {
		key: "approvals:approvals.evidence.fullDay",
		fallback: "Full day",
	},
	am: { key: "approvals:approvals.evidence.morning", fallback: "Morning" },
	pm: { key: "approvals:approvals.evidence.afternoon", fallback: "Afternoon" },
};

function coverageRows(coverage: AbsenceSubmittedCoverage) {
	// Logical dates are shown exactly as submitted; they never shift by zone.
	const dates =
		coverage.startDate === coverage.endDate
			? coverage.startDate
			: `${coverage.startDate} – ${coverage.endDate}`;
	const rows: Array<{
		label: { key: string; fallback: string };
		value: string | { key: string; fallback: string };
	}> = [
		{
			label: { key: "approvals:approvals.dates", fallback: "Dates" },
			value: dates,
		},
	];
	switch (coverage.kind) {
		case "full_day":
			rows.push({
				label: {
					key: "approvals:approvals.evidence.coverage",
					fallback: "Coverage",
				},
				value: {
					key: "approvals:approvals.evidence.fullDays",
					fallback: "Full days",
				},
			});
			break;
		case "half_day_periods":
			rows.push(
				{
					label: {
						key: "approvals:approvals.evidence.startsWith",
						fallback: "Starts with",
					},
					value: PERIOD_TEXT[coverage.startPeriod],
				},
				{
					label: {
						key: "approvals:approvals.evidence.endsWith",
						fallback: "Ends with",
					},
					value: PERIOD_TEXT[coverage.endPeriod],
				},
			);
			break;
		case "explicit_partial":
			rows.push({
				label: {
					key: "approvals:approvals.evidence.requestedTimes",
					fallback: "Requested times (local, zone not recorded)",
				},
				value: coverage.overnight
					? `${coverage.startDate} ${coverage.startTime} – ${coverage.endDate} ${coverage.endTime}`
					: `${coverage.startTime} – ${coverage.endTime}`,
			});
			break;
	}
	return rows;
}

function decisionLabel(decision: DecisionEvidenceRecord): string {
	if (decision.operationKind === "submission_activation") {
		return decision.requestOutcome === "approved"
			? "Approved automatically during submission"
			: "Resolved automatically during submission";
	}
	if (decision.requestOutcome === "approved") return "Request approved";
	if (decision.requestOutcome === "rejected") return "Request rejected";
	if (decision.assignmentOutcome === "approved") {
		return "Approval recorded — awaiting further approval";
	}
	return "Decision recorded";
}

/**
 * Renders prepared evidence into authenticated review sections. Free-text
 * notes stay where they are; nothing here is copied from mutable live rows
 * except the explicitly labelled current category name.
 */
export function buildAbsenceReviewSections(evidence: AbsenceReviewEvidence): {
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
							body: "The facts submitted for this request were not captured, so a decision cannot be bound to them. The request is held for review.",
							tone: "warning",
						},
					],
					decisionsBlocked: true,
				}
			: { sections: [], decisionsBlocked: false };
	}
	const { revision, comparison, decisions } = evidence;
	const labels = revision.labels;
	const rows: Extract<
		ApprovalInboxDetailSection,
		{ type: "key_value" }
	>["rows"] = [
		{
			label: { key: "approvals:approvals.employee", fallback: "Employee" },
			value: labels.subjectName ?? UNAVAILABLE,
		},
	];
	if (revision.requesterEmployeeId !== revision.subjectEmployeeId) {
		rows.push({
			label: {
				key: "approvals:approvals.evidence.requestedBy",
				fallback: "Requested by",
			},
			value: labels.requesterName ?? UNAVAILABLE,
		});
	}
	if (
		revision.submitter.kind !== "employee" ||
		revision.submitter.employeeId !== revision.requesterEmployeeId
	) {
		rows.push({
			label: {
				key: "approvals:approvals.evidence.submittedBy",
				fallback: "Submitted by",
			},
			value: labels.submitterName ?? UNAVAILABLE,
		});
	}
	rows.push({
		label: {
			key: "approvals:approvals.evidence.category",
			fallback: "Category",
		},
		value: labels.categoryName ?? UNAVAILABLE,
	});
	if (comparison.kind === "current") {
		for (const change of comparison.labelChanges) {
			rows.push({
				label: {
					key: "approvals:approvals.evidence.currentCategoryName",
					fallback: "Current category name",
				},
				value: change.current ?? UNAVAILABLE,
			});
		}
	}
	rows.push(...coverageRows(revision.facts.coverage));

	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: {
				key: "approvals:approvals.evidence.submittedTitle",
				fallback: "Submitted request",
			},
			rows,
		},
	];
	if (comparison.kind === "material_change") {
		sections.push({
			type: "callout",
			title: "Request changed after submission",
			body: `The live request no longer matches what was submitted for approval (changed: ${comparison.changedFields.join(", ")}). A decision cannot be recorded; the request must be cancelled and resubmitted.`,
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
	return {
		sections,
		decisionsBlocked: comparison.kind === "material_change",
	};
}
