import { and, asc, desc, eq } from "drizzle-orm";
import {
	APPROVAL_EVIDENCE_MODES,
	type ApprovalEvidenceMode,
	approvalDecisionEvidence,
	approvalEvidenceControl,
	approvalReviewBinding,
	approvalStageAssignment,
	approvalSubmittedRevision,
	employee,
} from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import type { ApprovalDatabase } from "../server/types";
import type {
	ApprovalActorKind,
	ApprovalWorkflowStatus,
	ApprovalWorkflowType,
	JsonObject,
} from "../workflow/ports";
import {
	ABSENCE_EVIDENCE_SCHEMA_VERSION,
	type AbsenceSubmittedFacts,
	type AbsenceSubmittedLabels,
	fingerprintAbsenceMaterialFacts,
} from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";

/**
 * Evidence capture is additive and inactive by default. The mode is read in the
 * caller's approval transaction after its write gate holds the shared rollout
 * lock, so an adoption writer holding the exclusive lock cannot interleave.
 */
export async function readApprovalEvidenceMode(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowType: ApprovalWorkflowType },
): Promise<ApprovalEvidenceMode> {
	const rows = await database
		.select({ mode: approvalEvidenceControl.mode })
		.from(approvalEvidenceControl)
		.where(
			and(
				eq(approvalEvidenceControl.organizationId, input.organizationId),
				eq(approvalEvidenceControl.workflowType, input.workflowType),
			),
		)
		.limit(1);
	const mode = rows[0]?.mode ?? "inactive";
	if (!APPROVAL_EVIDENCE_MODES.includes(mode)) {
		throw new ApprovalEvidenceError("invariant", { field: "evidence_mode" });
	}
	return mode;
}

export interface SubmitterIdentity {
	kind: Extract<ApprovalActorKind, "employee" | "system">;
	employeeId: string | null;
	userId: string | null;
}

export interface AbsenceSubmittedRevisionRecord {
	id: string;
	organizationId: string;
	workflowId: string;
	sourceId: string;
	requestCycleKey: string;
	revision: number;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	submitter: SubmitterIdentity;
	materialFingerprint: string;
	facts: AbsenceSubmittedFacts;
	labels: AbsenceSubmittedLabels;
	provenance: "captured_at_submission";
	submittedAt: Instant;
}

type SubmittedRevisionRow = typeof approvalSubmittedRevision.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function parseAbsenceRevision(
	row: SubmittedRevisionRow,
	scope: { organizationId: string; workflowId: string },
): AbsenceSubmittedRevisionRecord {
	const facts = row.facts;
	const labels = row.labels;
	if (
		row.organizationId !== scope.organizationId ||
		row.workflowId !== scope.workflowId ||
		row.workflowType !== "absence" ||
		row.sourceType !== "absence_entry" ||
		row.schemaVersion !== ABSENCE_EVIDENCE_SCHEMA_VERSION ||
		row.provenance !== "captured_at_submission" ||
		(row.submitterActorKind !== "employee" &&
			row.submitterActorKind !== "system") ||
		!isRecord(facts) ||
		facts.kind !== "absence" ||
		facts.schemaVersion !== ABSENCE_EVIDENCE_SCHEMA_VERSION ||
		facts.organizationId !== row.organizationId ||
		facts.absenceId !== row.sourceId ||
		facts.subjectEmployeeId !== row.subjectEmployeeId ||
		facts.requesterEmployeeId !== row.requesterEmployeeId ||
		!isRecord(facts.coverage) ||
		!isRecord(facts.compatibility) ||
		!isRecord(labels) ||
		!nullableString(labels.subjectName) ||
		!nullableString(labels.requesterName) ||
		!nullableString(labels.submitterName) ||
		!nullableString(labels.categoryName)
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "submitted_revision",
		});
	}
	const parsedFacts = facts as unknown as AbsenceSubmittedFacts;
	if (
		fingerprintAbsenceMaterialFacts(parsedFacts) !== row.materialFingerprint
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "material_fingerprint",
		});
	}
	return {
		id: row.id,
		organizationId: row.organizationId,
		workflowId: row.workflowId,
		sourceId: row.sourceId,
		requestCycleKey: row.requestCycleKey,
		revision: row.revision,
		subjectEmployeeId: row.subjectEmployeeId,
		requesterEmployeeId: row.requesterEmployeeId,
		submitter: {
			kind: row.submitterActorKind,
			employeeId: row.submitterEmployeeId,
			userId: row.submitterUserId,
		},
		materialFingerprint: row.materialFingerprint,
		facts: parsedFacts,
		labels: labels as unknown as AbsenceSubmittedLabels,
		provenance: "captured_at_submission",
		submittedAt: instantFromDate(row.submittedAt),
	};
}

/**
 * Written by the submission owner inside its transaction. A failure throws and
 * rolls back the submission; there is no success-shaped request without it.
 */
export async function captureAbsenceSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflowId: string;
		requestCycleKey: string;
		submittedAt: Instant;
		facts: AbsenceSubmittedFacts;
		labels: AbsenceSubmittedLabels;
		submitter: SubmitterIdentity;
	},
): Promise<AbsenceSubmittedRevisionRecord> {
	if (input.facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const materialFingerprint = fingerprintAbsenceMaterialFacts(input.facts);
	await database
		.insert(approvalSubmittedRevision)
		.values({
			organizationId: input.organizationId,
			workflowId: input.workflowId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: input.facts.absenceId,
			requestCycleKey: input.requestCycleKey,
			revision: 1,
			subjectEmployeeId: input.facts.subjectEmployeeId,
			requesterEmployeeId: input.facts.requesterEmployeeId,
			submitterActorKind: input.submitter.kind,
			submitterEmployeeId: input.submitter.employeeId,
			submitterUserId: input.submitter.userId,
			schemaVersion: ABSENCE_EVIDENCE_SCHEMA_VERSION,
			materialFingerprint,
			facts: input.facts as unknown as JsonObject,
			labels: input.labels as unknown as JsonObject,
			provenance: "captured_at_submission",
			submittedAt: dateFromInstant(input.submittedAt),
		})
		.onConflictDoNothing();
	const revision = await loadCurrentAbsenceSubmittedRevision(database, input);
	if (
		revision?.revision !== 1 ||
		revision.requestCycleKey !== input.requestCycleKey ||
		revision.materialFingerprint !== materialFingerprint
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "submitted_revision",
		});
	}
	return revision;
}

export async function loadCurrentAbsenceSubmittedRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowId: string },
): Promise<AbsenceSubmittedRevisionRecord | null> {
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.workflowId, input.workflowId),
			),
		)
		.orderBy(desc(approvalSubmittedRevision.revision))
		.limit(1);
	const row = rows[0];
	return row ? parseAbsenceRevision(row, input) : null;
}

export interface DecisionEvidenceInput {
	organizationId: string;
	workflowId: string;
	submittedRevisionId: string;
	operationKind: "command" | "submission_activation";
	receipt: {
		idempotencyKey: string;
		actorFingerprint: string;
		commandFingerprint: string;
	};
	action: "approve" | "reject";
	stageId: string | null;
	assignmentId: string | null;
	assignmentOutcome: "approved" | "rejected" | null;
	requestOutcome: ApprovalWorkflowStatus;
	actor: {
		kind: ApprovalActorKind;
		employeeId: string | null;
		userId: string | null;
	};
	decidedAt: Instant;
	eventIds: string[];
	result: JsonObject;
	labels: { actorName: string | null };
	reviewedBindingId: string | null;
}

export interface DecisionEvidenceRecord extends DecisionEvidenceInput {
	id: string;
}

type DecisionEvidenceRow = typeof approvalDecisionEvidence.$inferSelect;

function parseDecisionEvidence(
	row: DecisionEvidenceRow,
	scope: { organizationId: string; workflowId: string },
): DecisionEvidenceRecord {
	if (
		row.organizationId !== scope.organizationId ||
		row.workflowId !== scope.workflowId ||
		row.schemaVersion !== ABSENCE_EVIDENCE_SCHEMA_VERSION ||
		!Array.isArray(row.eventIds) ||
		!row.eventIds.every((id) => typeof id === "string") ||
		!isRecord(row.result) ||
		!isRecord(row.labels) ||
		!nullableString(row.labels.actorName)
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "decision_evidence",
		});
	}
	return {
		id: row.id,
		organizationId: row.organizationId,
		workflowId: row.workflowId,
		submittedRevisionId: row.submittedRevisionId,
		operationKind: row.operationKind,
		receipt: {
			idempotencyKey: row.receiptIdempotencyKey,
			actorFingerprint: row.receiptActorFingerprint,
			commandFingerprint: row.receiptCommandFingerprint,
		},
		action: row.action,
		stageId: row.stageId,
		assignmentId: row.assignmentId,
		assignmentOutcome: row.assignmentOutcome,
		requestOutcome: row.requestOutcome,
		actor: {
			kind: row.actorKind,
			employeeId: row.actorEmployeeId,
			userId: row.actorUserId,
		},
		decidedAt: instantFromDate(row.decidedAt),
		eventIds: [...row.eventIds],
		result: row.result as JsonObject,
		labels: { actorName: row.labels.actorName },
		reviewedBindingId: row.reviewedBindingId,
	};
}

/**
 * Written by the authoritative decision owner in the transaction that commits
 * the transition and its receipt. Exact replays return before reaching this.
 */
export async function recordDecisionEvidence(
	database: ApprovalDatabase,
	input: DecisionEvidenceInput,
): Promise<DecisionEvidenceRecord> {
	const inserted = await database
		.insert(approvalDecisionEvidence)
		.values({
			organizationId: input.organizationId,
			workflowId: input.workflowId,
			submittedRevisionId: input.submittedRevisionId,
			operationKind: input.operationKind,
			receiptIdempotencyKey: input.receipt.idempotencyKey,
			receiptActorFingerprint: input.receipt.actorFingerprint,
			receiptCommandFingerprint: input.receipt.commandFingerprint,
			action: input.action,
			stageId: input.stageId,
			assignmentId: input.assignmentId,
			assignmentOutcome: input.assignmentOutcome,
			requestOutcome: input.requestOutcome,
			actorKind: input.actor.kind,
			actorEmployeeId: input.actor.employeeId,
			actorUserId: input.actor.userId,
			decidedAt: dateFromInstant(input.decidedAt),
			eventIds: [...input.eventIds],
			result: input.result,
			labels: input.labels,
			reviewedBindingId: input.reviewedBindingId,
			schemaVersion: ABSENCE_EVIDENCE_SCHEMA_VERSION,
		})
		.returning();
	const row = inserted[0];
	if (inserted.length !== 1 || !row) {
		throw new ApprovalEvidenceError("invariant", {
			field: "decision_evidence",
		});
	}
	return parseDecisionEvidence(row, input);
}

export async function listDecisionEvidence(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowId: string },
): Promise<DecisionEvidenceRecord[]> {
	const rows = await database
		.select()
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, input.organizationId),
				eq(approvalDecisionEvidence.workflowId, input.workflowId),
			),
		)
		.orderBy(
			asc(approvalDecisionEvidence.decidedAt),
			asc(approvalDecisionEvidence.id),
		)
		.limit(64);
	return rows.map((row) => parseDecisionEvidence(row, input));
}

export async function findDecisionEvidenceByReceipt(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowId: string; idempotencyKey: string },
): Promise<DecisionEvidenceRecord | null> {
	const rows = await database
		.select()
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, input.organizationId),
				eq(approvalDecisionEvidence.workflowId, input.workflowId),
				eq(
					approvalDecisionEvidence.receiptIdempotencyKey,
					input.idempotencyKey,
				),
			),
		)
		.limit(1);
	const row = rows[0];
	return row ? parseDecisionEvidence(row, input) : null;
}

export interface ReviewBindingTarget {
	organizationId: string;
	recipientEmployeeId: string;
	workflowId: string;
	stageId: string;
	assignmentId: string;
	submittedRevisionId: string;
}

/**
 * Issues (or reuses) the opaque handle for one recipient's review of an exact
 * pending assignment and current submitted revision. Possession of the handle
 * never grants authority; the decision transaction revalidates everything.
 */
export async function issueReviewBinding(
	database: ApprovalDatabase,
	target: ReviewBindingTarget,
): Promise<string> {
	const assignments = await database
		.select({ id: approvalStageAssignment.id })
		.from(approvalStageAssignment)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, target.organizationId),
				eq(approvalStageAssignment.workflowId, target.workflowId),
				eq(approvalStageAssignment.stageId, target.stageId),
				eq(approvalStageAssignment.id, target.assignmentId),
				eq(
					approvalStageAssignment.approverEmployeeId,
					target.recipientEmployeeId,
				),
				eq(approvalStageAssignment.status, "pending"),
			),
		)
		.limit(1);
	const current = await loadCurrentAbsenceSubmittedRevision(database, target);
	if (assignments.length !== 1 || current?.id !== target.submittedRevisionId) {
		throw new ApprovalEvidenceError("binding_mismatch", { field: "target" });
	}
	await database
		.insert(approvalReviewBinding)
		.values(target)
		.onConflictDoNothing();
	const rows = await database
		.select({ id: approvalReviewBinding.id })
		.from(approvalReviewBinding)
		.where(
			and(
				eq(approvalReviewBinding.organizationId, target.organizationId),
				eq(
					approvalReviewBinding.recipientEmployeeId,
					target.recipientEmployeeId,
				),
				eq(approvalReviewBinding.assignmentId, target.assignmentId),
				eq(
					approvalReviewBinding.submittedRevisionId,
					target.submittedRevisionId,
				),
			),
		)
		.limit(1);
	const id = rows[0]?.id;
	if (!id)
		throw new ApprovalEvidenceError("invariant", { field: "review_binding" });
	return id;
}

/** Transaction-time check that a supplied handle names exactly this target. */
export async function assertReviewBindingMatches(
	database: ApprovalDatabase,
	bindingId: string,
	target: ReviewBindingTarget,
): Promise<void> {
	const rows = await database
		.select()
		.from(approvalReviewBinding)
		.where(
			and(
				eq(approvalReviewBinding.id, bindingId),
				eq(approvalReviewBinding.organizationId, target.organizationId),
			),
		)
		.limit(1);
	const row = rows[0];
	if (
		!row ||
		row.recipientEmployeeId !== target.recipientEmployeeId ||
		row.workflowId !== target.workflowId ||
		row.stageId !== target.stageId ||
		row.assignmentId !== target.assignmentId ||
		row.submittedRevisionId !== target.submittedRevisionId
	) {
		throw new ApprovalEvidenceError("binding_mismatch");
	}
}

/** Organization-scoped actor label as of the decision; identity stays separate. */
export async function loadEvidenceActorLabel(
	database: ApprovalDatabase,
	input: { organizationId: string; employeeId: string },
): Promise<{ name: string | null } | null> {
	const actor = await database.query.employee.findFirst({
		where: and(
			eq(employee.id, input.employeeId),
			eq(employee.organizationId, input.organizationId),
		),
		columns: { id: true, organizationId: true },
		with: { user: { columns: { name: true } } },
	});
	if (!actor || actor.organizationId !== input.organizationId) return null;
	return { name: actor.user?.name ?? null };
}
