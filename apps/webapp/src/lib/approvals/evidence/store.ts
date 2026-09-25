import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
	APPROVAL_EVIDENCE_MODES,
	type ApprovalEvidenceMode,
	approvalChainStageInstance,
	approvalDecisionEvidence,
	approvalEvidenceControl,
	approvalRequest,
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
import {
	fingerprintTravelExpenseMaterialFacts,
	TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION,
	type TravelExpenseSubmittedFacts,
	type TravelExpenseSubmittedLabels,
} from "./travel-expense-facts";
import {
	fingerprintTimeCorrectionFacts,
	TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION,
	type TimeCorrectionSubmittedFacts,
} from "./time-correction-facts";
import {
	fingerprintWorkPeriodMaterialFacts,
	WORK_PERIOD_EVIDENCE_SCHEMA_VERSION,
	type WorkPeriodEvidenceKind,
	type WorkPeriodSubmittedFacts,
	type WorkPeriodSubmittedLabels,
} from "./work-period-facts";

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
	if (row.authority !== "canonical" || row.workflowId !== scope.workflowId) {
		throw new ApprovalEvidenceError("invariant", {
			field: "submitted_revision",
		});
	}
	return {
		...parseAbsenceRevisionBody(row, scope.organizationId),
		workflowId: scope.workflowId,
	};
}

/** Authority-independent request facts shared by canonical and legacy rows. */
function parseAbsenceRevisionBody(
	row: SubmittedRevisionRow,
	organizationId: string,
): Omit<AbsenceSubmittedRevisionRecord, "workflowId"> {
	const facts = row.facts;
	const labels = row.labels;
	if (
		row.organizationId !== organizationId ||
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
		row.authority !== "canonical" ||
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
		workflowId: scope.workflowId,
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

export async function findDecisionEvidenceById(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowId: string; id: string },
): Promise<DecisionEvidenceRecord | null> {
	const rows = await database
		.select()
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, input.organizationId),
				eq(approvalDecisionEvidence.workflowId, input.workflowId),
				eq(approvalDecisionEvidence.id, input.id),
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

export interface ReviewBindingRecord extends ReviewBindingTarget {
	id: string;
}

/**
 * Organization-scoped handle lookup. The handle names a target; it is neither
 * authority nor invocation identity, and every field is revalidated under the
 * decision transaction.
 */
export async function loadReviewBinding(
	database: ApprovalDatabase,
	input: { organizationId: string; bindingId: string },
): Promise<ReviewBindingRecord | null> {
	const rows = await database
		.select()
		.from(approvalReviewBinding)
		.where(
			and(
				eq(approvalReviewBinding.id, input.bindingId),
				eq(approvalReviewBinding.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row || row.organizationId !== input.organizationId) return null;
	// A legacy binding never names a canonical target (#296).
	if (
		row.authority !== "canonical" ||
		!row.workflowId ||
		!row.stageId ||
		!row.assignmentId
	) {
		return null;
	}
	return {
		id: row.id,
		organizationId: row.organizationId,
		recipientEmployeeId: row.recipientEmployeeId,
		workflowId: row.workflowId,
		stageId: row.stageId,
		assignmentId: row.assignmentId,
		submittedRevisionId: row.submittedRevisionId,
	};
}

/**
 * Which authority a binding handle belongs to, so a card action reaches only
 * that authority's decision owner. Organization-scoped; null when unknown.
 */
export async function loadReviewBindingAuthority(
	database: ApprovalDatabase,
	input: { organizationId: string; bindingId: string },
): Promise<"canonical" | "legacy" | null> {
	const rows = await database
		.select({ authority: approvalReviewBinding.authority })
		.from(approvalReviewBinding)
		.where(
			and(
				eq(approvalReviewBinding.id, input.bindingId),
				eq(approvalReviewBinding.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const authority = rows[0]?.authority;
	return authority === "canonical" || authority === "legacy" ? authority : null;
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

// ---------------------------------------------------------------------------
// Legacy authority (#288). Same immutable tables, discriminated by authority.
// A legacy lifecycle is identified by its request cycle and the legacy rows it
// created, never by a canonical workflow: an observed shadow workflow is stored
// only as an observation reference.
// ---------------------------------------------------------------------------

export interface LegacyLifecycleReference {
	/** The legacy request created by the submission (its first assignment). */
	approvalRequestId: string;
	chainInstanceId: string | null;
	/** Shadow observation of the lifecycle, if one was mirrored. Not authority. */
	observedWorkflowId: string | null;
}

export interface LegacyAbsenceSubmittedRevisionRecord
	extends Omit<AbsenceSubmittedRevisionRecord, "workflowId"> {
	authority: "legacy";
	legacy: LegacyLifecycleReference;
}

function parseLegacyAbsenceRevision(
	row: SubmittedRevisionRow,
	scope: { organizationId: string; absenceId: string },
): LegacyAbsenceSubmittedRevisionRecord {
	if (
		row.authority !== "legacy" ||
		row.workflowId !== null ||
		row.sourceId !== scope.absenceId ||
		!row.legacyApprovalRequestId
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "legacy_submitted_revision",
		});
	}
	return {
		...parseAbsenceRevisionBody(row, scope.organizationId),
		authority: "legacy",
		legacy: {
			approvalRequestId: row.legacyApprovalRequestId,
			chainInstanceId: row.legacyChainInstanceId,
			observedWorkflowId: row.observedWorkflowId,
		},
	};
}

export async function loadLegacyAbsenceSubmittedRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; absenceId: string },
): Promise<LegacyAbsenceSubmittedRevisionRecord | null> {
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
				eq(approvalSubmittedRevision.sourceType, "absence_entry"),
				eq(approvalSubmittedRevision.sourceId, input.absenceId),
			),
		)
		.orderBy(desc(approvalSubmittedRevision.revision))
		.limit(1);
	const row = rows[0];
	return row ? parseLegacyAbsenceRevision(row, input) : null;
}

/**
 * Written by the legacy submission owner inside its transaction, after the
 * legacy rows (and any shadow observation) exist. A failure rolls back the
 * whole submission.
 */
export async function captureLegacyAbsenceSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		requestCycleKey: string;
		submittedAt: Instant;
		facts: AbsenceSubmittedFacts;
		labels: AbsenceSubmittedLabels;
		submitter: SubmitterIdentity;
		legacy: LegacyLifecycleReference;
	},
): Promise<LegacyAbsenceSubmittedRevisionRecord> {
	if (input.facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const materialFingerprint = fingerprintAbsenceMaterialFacts(input.facts);
	await database
		.insert(approvalSubmittedRevision)
		.values({
			organizationId: input.organizationId,
			authority: "legacy",
			workflowId: null,
			legacyApprovalRequestId: input.legacy.approvalRequestId,
			legacyChainInstanceId: input.legacy.chainInstanceId,
			observedWorkflowId: input.legacy.observedWorkflowId,
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
	const revision = await loadLegacyAbsenceSubmittedRevision(database, {
		organizationId: input.organizationId,
		absenceId: input.facts.absenceId,
	});
	if (
		revision?.revision !== 1 ||
		revision.requestCycleKey !== input.requestCycleKey ||
		revision.materialFingerprint !== materialFingerprint ||
		revision.legacy.approvalRequestId !== input.legacy.approvalRequestId
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "legacy_submitted_revision",
		});
	}
	return revision;
}

export interface LegacyDecisionEvidenceInput
	extends Omit<
		DecisionEvidenceInput,
		"workflowId" | "stageId" | "assignmentId" | "eventIds" | "reviewedBindingId"
	> {
	legacy: {
		/** The one legacy request (assignment equivalent) this operation decided. */
		approvalRequestId: string;
		chainStageId: string | null;
		observedWorkflowId: string | null;
	};
	/** The legacy binding a bound card decision was reviewed through (#296). */
	reviewedBindingId?: string | null;
}

export interface LegacyDecisionEvidenceRecord
	extends LegacyDecisionEvidenceInput {
	id: string;
	authority: "legacy";
	reviewedBindingId: string | null;
}

function parseLegacyDecisionEvidence(
	row: DecisionEvidenceRow,
	organizationId: string,
): LegacyDecisionEvidenceRecord {
	if (
		row.organizationId !== organizationId ||
		row.authority !== "legacy" ||
		row.workflowId !== null ||
		!row.legacyApprovalRequestId ||
		row.stageId !== null ||
		row.assignmentId !== null ||
		row.schemaVersion !== ABSENCE_EVIDENCE_SCHEMA_VERSION ||
		!Array.isArray(row.eventIds) ||
		row.eventIds.length !== 0 ||
		!isRecord(row.result) ||
		!isRecord(row.labels) ||
		!nullableString(row.labels.actorName)
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "legacy_decision_evidence",
		});
	}
	return {
		id: row.id,
		authority: "legacy",
		organizationId: row.organizationId,
		submittedRevisionId: row.submittedRevisionId,
		operationKind: row.operationKind,
		receipt: {
			idempotencyKey: row.receiptIdempotencyKey,
			actorFingerprint: row.receiptActorFingerprint,
			commandFingerprint: row.receiptCommandFingerprint,
		},
		action: row.action,
		legacy: {
			approvalRequestId: row.legacyApprovalRequestId,
			chainStageId: row.legacyChainStageId,
			observedWorkflowId: row.observedWorkflowId,
		},
		assignmentOutcome: row.assignmentOutcome,
		requestOutcome: row.requestOutcome,
		actor: {
			kind: row.actorKind,
			employeeId: row.actorEmployeeId,
			userId: row.actorUserId,
		},
		decidedAt: instantFromDate(row.decidedAt),
		result: row.result as JsonObject,
		labels: { actorName: row.labels.actorName },
		reviewedBindingId: row.reviewedBindingId,
	};
}

/**
 * Written in the transaction that commits the legacy mutation (and its shadow
 * observation). The row doubles as the legacy operation receipt: one per
 * decided legacy request, so a concurrent second writer fails and rolls back.
 */
export async function recordLegacyDecisionEvidence(
	database: ApprovalDatabase,
	input: LegacyDecisionEvidenceInput,
): Promise<LegacyDecisionEvidenceRecord> {
	const inserted = await database
		.insert(approvalDecisionEvidence)
		.values({
			organizationId: input.organizationId,
			authority: "legacy",
			workflowId: null,
			legacyApprovalRequestId: input.legacy.approvalRequestId,
			legacyChainStageId: input.legacy.chainStageId,
			observedWorkflowId: input.legacy.observedWorkflowId,
			submittedRevisionId: input.submittedRevisionId,
			operationKind: input.operationKind,
			receiptIdempotencyKey: input.receipt.idempotencyKey,
			receiptActorFingerprint: input.receipt.actorFingerprint,
			receiptCommandFingerprint: input.receipt.commandFingerprint,
			action: input.action,
			stageId: null,
			assignmentId: null,
			assignmentOutcome: input.assignmentOutcome,
			requestOutcome: input.requestOutcome,
			actorKind: input.actor.kind,
			actorEmployeeId: input.actor.employeeId,
			actorUserId: input.actor.userId,
			decidedAt: dateFromInstant(input.decidedAt),
			eventIds: [],
			result: input.result,
			labels: input.labels,
			reviewedBindingId: input.reviewedBindingId ?? null,
			schemaVersion: ABSENCE_EVIDENCE_SCHEMA_VERSION,
		})
		.returning();
	const row = inserted[0];
	if (inserted.length !== 1 || !row) {
		throw new ApprovalEvidenceError("invariant", {
			field: "legacy_decision_evidence",
		});
	}
	return parseLegacyDecisionEvidence(row, input.organizationId);
}

export async function listLegacyDecisionEvidence(
	database: ApprovalDatabase,
	input: { organizationId: string; submittedRevisionId: string },
): Promise<LegacyDecisionEvidenceRecord[]> {
	const rows = await database
		.select()
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, input.organizationId),
				eq(approvalDecisionEvidence.authority, "legacy"),
				eq(
					approvalDecisionEvidence.submittedRevisionId,
					input.submittedRevisionId,
				),
			),
		)
		.orderBy(
			asc(approvalDecisionEvidence.decidedAt),
			asc(approvalDecisionEvidence.id),
		)
		.limit(64);
	return rows.map((row) =>
		parseLegacyDecisionEvidence(row, input.organizationId),
	);
}

/** The committed legacy operation for one exact legacy request, if any. */
export async function findLegacyDecisionEvidenceByRequest(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalRequestId: string },
): Promise<LegacyDecisionEvidenceRecord | null> {
	const rows = await database
		.select()
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, input.organizationId),
				eq(approvalDecisionEvidence.authority, "legacy"),
				eq(
					approvalDecisionEvidence.legacyApprovalRequestId,
					input.approvalRequestId,
				),
			),
		)
		.limit(2);
	if (rows.length > 1) {
		throw new ApprovalEvidenceError("invariant", {
			field: "legacy_decision_evidence",
		});
	}
	const row = rows[0];
	return row ? parseLegacyDecisionEvidence(row, input.organizationId) : null;
}

export async function findLegacyDecisionEvidenceById(
	database: ApprovalDatabase,
	input: { organizationId: string; id: string },
): Promise<LegacyDecisionEvidenceRecord | null> {
	const rows = await database
		.select()
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, input.organizationId),
				eq(approvalDecisionEvidence.authority, "legacy"),
				eq(approvalDecisionEvidence.id, input.id),
			),
		)
		.limit(1);
	const row = rows[0];
	return row ? parseLegacyDecisionEvidence(row, input.organizationId) : null;
}

// ---------------------------------------------------------------------------
// Legacy reviewed bindings (#296). A legacy binding names the exact legacy
// request a recipient reviewed (the assignment equivalent) and the legacy
// submitted revision the card showed. It is a handle, not authority: the legacy
// decision owner revalidates everything under its transaction.
// ---------------------------------------------------------------------------

export interface LegacyReviewBindingTarget {
	organizationId: string;
	recipientEmployeeId: string;
	legacyApprovalRequestId: string;
	submittedRevisionId: string;
}

export interface LegacyReviewBindingRecord extends LegacyReviewBindingTarget {
	id: string;
	authority: "legacy";
}

/**
 * Whether a legacy request belongs to the lifecycle a legacy revision was
 * captured for: the request routing created, or a stage request of the chain
 * it recorded. Verified links only, never a shared subject ID alone.
 */
export async function isLegacyRequestInRevisionLifecycle(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		approvalRequestId: string;
		revision: {
			sourceType: string;
			sourceId: string;
			legacy: LegacyLifecycleReference;
		};
	},
): Promise<boolean> {
	const requests = await database
		.select({
			entityType: approvalRequest.entityType,
			entityId: approvalRequest.entityId,
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const request = requests[0];
	if (
		!request ||
		request.entityType !== input.revision.sourceType ||
		request.entityId !== input.revision.sourceId
	) {
		return false;
	}
	if (input.approvalRequestId === input.revision.legacy.approvalRequestId) {
		return true;
	}
	const chainInstanceId = input.revision.legacy.chainInstanceId;
	if (!chainInstanceId) return false;
	const stages = await database
		.select({ id: approvalChainStageInstance.id })
		.from(approvalChainStageInstance)
		.where(
			and(
				eq(approvalChainStageInstance.organizationId, input.organizationId),
				eq(approvalChainStageInstance.chainInstanceId, chainInstanceId),
				eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
			),
		)
		.limit(1);
	return stages.length === 1;
}

/**
 * Issues (or reuses) the handle for one recipient's review of an exact pending
 * legacy request and the current legacy revision of its lifecycle. The caller
 * has verified that the revision still matches the live source.
 */
export async function issueLegacyReviewBinding(
	database: ApprovalDatabase,
	target: LegacyReviewBindingTarget & {
		revision: {
			sourceType: string;
			sourceId: string;
			legacy: LegacyLifecycleReference;
		};
	},
): Promise<string> {
	const pending = await database
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, target.legacyApprovalRequestId),
				eq(approvalRequest.organizationId, target.organizationId),
				eq(approvalRequest.approverId, target.recipientEmployeeId),
				eq(approvalRequest.status, "pending"),
			),
		)
		.limit(1);
	const revisions = await database
		.select({ id: approvalSubmittedRevision.id })
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.id, target.submittedRevisionId),
				eq(approvalSubmittedRevision.organizationId, target.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
				eq(approvalSubmittedRevision.sourceType, target.revision.sourceType),
				eq(approvalSubmittedRevision.sourceId, target.revision.sourceId),
			),
		)
		.limit(1);
	if (
		pending.length !== 1 ||
		revisions.length !== 1 ||
		!(await isLegacyRequestInRevisionLifecycle(database, {
			organizationId: target.organizationId,
			approvalRequestId: target.legacyApprovalRequestId,
			revision: target.revision,
		}))
	) {
		throw new ApprovalEvidenceError("binding_mismatch", { field: "target" });
	}
	const values = {
		organizationId: target.organizationId,
		authority: "legacy" as const,
		recipientEmployeeId: target.recipientEmployeeId,
		legacyApprovalRequestId: target.legacyApprovalRequestId,
		submittedRevisionId: target.submittedRevisionId,
	};
	await database.insert(approvalReviewBinding).values(values).onConflictDoNothing();
	const rows = await database
		.select({ id: approvalReviewBinding.id })
		.from(approvalReviewBinding)
		.where(
			and(
				eq(approvalReviewBinding.organizationId, target.organizationId),
				eq(approvalReviewBinding.authority, "legacy"),
				eq(approvalReviewBinding.recipientEmployeeId, target.recipientEmployeeId),
				eq(
					approvalReviewBinding.legacyApprovalRequestId,
					target.legacyApprovalRequestId,
				),
				eq(approvalReviewBinding.submittedRevisionId, target.submittedRevisionId),
			),
		)
		.limit(1);
	const id = rows[0]?.id;
	if (!id) {
		throw new ApprovalEvidenceError("invariant", { field: "review_binding" });
	}
	return id;
}

/** Organization-scoped legacy handle lookup; a canonical handle is not one. */
export async function loadLegacyReviewBinding(
	database: ApprovalDatabase,
	input: { organizationId: string; bindingId: string },
): Promise<LegacyReviewBindingRecord | null> {
	const rows = await database
		.select()
		.from(approvalReviewBinding)
		.where(
			and(
				eq(approvalReviewBinding.id, input.bindingId),
				eq(approvalReviewBinding.organizationId, input.organizationId),
				eq(approvalReviewBinding.authority, "legacy"),
			),
		)
		.limit(1);
	const row = rows[0];
	if (
		!row ||
		row.organizationId !== input.organizationId ||
		row.authority !== "legacy" ||
		!row.legacyApprovalRequestId ||
		row.workflowId !== null ||
		row.assignmentId !== null
	) {
		return null;
	}
	return {
		id: row.id,
		authority: "legacy",
		organizationId: row.organizationId,
		recipientEmployeeId: row.recipientEmployeeId,
		legacyApprovalRequestId: row.legacyApprovalRequestId,
		submittedRevisionId: row.submittedRevisionId,
	};
}

// ---------------------------------------------------------------------------
// Travel expense claims (#295). Expense approvals are legacy-authoritative
// only (no canonical adapter), so their submitted revision is a legacy row
// linked to the approval request routing created for the claim.
// ---------------------------------------------------------------------------

export interface LegacyTravelExpenseSubmittedRevisionRecord {
	id: string;
	authority: "legacy";
	organizationId: string;
	claimId: string;
	requestCycleKey: string;
	revision: number;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	submitter: SubmitterIdentity;
	materialFingerprint: string;
	facts: TravelExpenseSubmittedFacts;
	labels: TravelExpenseSubmittedLabels;
	provenance: "captured_at_submission";
	submittedAt: Instant;
	legacy: LegacyLifecycleReference;
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every((entry) => typeof entry === "string")
	);
}

function parseLegacyTravelExpenseRevision(
	row: SubmittedRevisionRow,
	scope: { organizationId: string; claimId: string },
): LegacyTravelExpenseSubmittedRevisionRecord {
	const facts = row.facts;
	const labels = row.labels;
	if (
		row.organizationId !== scope.organizationId ||
		row.authority !== "legacy" ||
		row.workflowId !== null ||
		!row.legacyApprovalRequestId ||
		row.workflowType !== "travel_expense" ||
		row.sourceType !== "travel_expense_claim" ||
		row.sourceId !== scope.claimId ||
		row.schemaVersion !== TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION ||
		row.provenance !== "captured_at_submission" ||
		(row.submitterActorKind !== "employee" &&
			row.submitterActorKind !== "system") ||
		!isRecord(facts) ||
		facts.kind !== "travel_expense" ||
		facts.schemaVersion !== TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION ||
		facts.organizationId !== row.organizationId ||
		facts.claimId !== row.sourceId ||
		facts.subjectEmployeeId !== row.subjectEmployeeId ||
		facts.requesterEmployeeId !== row.requesterEmployeeId ||
		!isRecord(facts.tripDates) ||
		!isRecord(facts.money) ||
		!isRecord(facts.receipts) ||
		!Array.isArray(facts.receipts.manifest) ||
		!isRecord(labels) ||
		!nullableString(labels.subjectName) ||
		!nullableString(labels.requesterName) ||
		!nullableString(labels.submitterName) ||
		!nullableString(labels.projectName) ||
		!isStringRecord(labels.receiptFileNames)
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "legacy_submitted_revision",
		});
	}
	const parsedFacts = facts as unknown as TravelExpenseSubmittedFacts;
	if (
		fingerprintTravelExpenseMaterialFacts(parsedFacts) !==
		row.materialFingerprint
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "material_fingerprint",
		});
	}
	return {
		id: row.id,
		authority: "legacy",
		organizationId: row.organizationId,
		claimId: row.sourceId,
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
		labels: labels as unknown as TravelExpenseSubmittedLabels,
		provenance: "captured_at_submission",
		submittedAt: instantFromDate(row.submittedAt),
		legacy: {
			approvalRequestId: row.legacyApprovalRequestId,
			chainInstanceId: row.legacyChainInstanceId,
			observedWorkflowId: row.observedWorkflowId,
		},
	};
}

/** The latest submitted revision of one claim, scoped to its organization. */
export async function loadLegacyTravelExpenseSubmittedRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; claimId: string },
): Promise<LegacyTravelExpenseSubmittedRevisionRecord | null> {
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
				eq(approvalSubmittedRevision.sourceType, "travel_expense_claim"),
				eq(approvalSubmittedRevision.sourceId, input.claimId),
			),
		)
		.orderBy(desc(approvalSubmittedRevision.revision))
		.limit(1);
	const row = rows[0];
	return row ? parseLegacyTravelExpenseRevision(row, input) : null;
}

/**
 * Written by the expense submission owner inside the transaction that submits
 * the claim and creates its legacy approval rows. A failure rolls back the
 * whole submission.
 */
export async function captureLegacyTravelExpenseSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		requestCycleKey: string;
		submittedAt: Instant;
		facts: TravelExpenseSubmittedFacts;
		labels: TravelExpenseSubmittedLabels;
		submitter: SubmitterIdentity;
		legacy: LegacyLifecycleReference;
	},
): Promise<LegacyTravelExpenseSubmittedRevisionRecord> {
	if (input.facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const materialFingerprint = fingerprintTravelExpenseMaterialFacts(
		input.facts,
	);
	await database
		.insert(approvalSubmittedRevision)
		.values({
			organizationId: input.organizationId,
			authority: "legacy",
			workflowId: null,
			legacyApprovalRequestId: input.legacy.approvalRequestId,
			legacyChainInstanceId: input.legacy.chainInstanceId,
			observedWorkflowId: input.legacy.observedWorkflowId,
			workflowType: "travel_expense",
			sourceType: "travel_expense_claim",
			sourceId: input.facts.claimId,
			requestCycleKey: input.requestCycleKey,
			revision: 1,
			subjectEmployeeId: input.facts.subjectEmployeeId,
			requesterEmployeeId: input.facts.requesterEmployeeId,
			submitterActorKind: input.submitter.kind,
			submitterEmployeeId: input.submitter.employeeId,
			submitterUserId: input.submitter.userId,
			schemaVersion: TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION,
			materialFingerprint,
			facts: input.facts as unknown as JsonObject,
			labels: input.labels as unknown as JsonObject,
			provenance: "captured_at_submission",
			submittedAt: dateFromInstant(input.submittedAt),
		})
		.onConflictDoNothing();
	const revision = await loadLegacyTravelExpenseSubmittedRevision(database, {
		organizationId: input.organizationId,
		claimId: input.facts.claimId,
	});
	if (
		revision?.revision !== 1 ||
		revision.requestCycleKey !== input.requestCycleKey ||
		revision.materialFingerprint !== materialFingerprint ||
		revision.legacy.approvalRequestId !== input.legacy.approvalRequestId
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "legacy_submitted_revision",
		});
	}
	return revision;
}

// ---------------------------------------------------------------------------
// Manual time submissions and policy clock-outs (#302). Canonical lifecycles
// reference their workflow; legacy lifecycles reference the legacy request or
// chain routing created, exactly as for absences.
// ---------------------------------------------------------------------------

export const WORK_PERIOD_EVIDENCE_WORKFLOW_TYPES = [
	"manual_time_submission",
	"policy_clock_out",
] as const satisfies readonly WorkPeriodEvidenceKind[];

export type WorkPeriodEvidenceLifecycle =
	| { authority: "canonical"; workflowId: string }
	| { authority: "legacy"; legacy: LegacyLifecycleReference };

export interface WorkPeriodSubmittedRevisionRecord {
	id: string;
	organizationId: string;
	lifecycle: WorkPeriodEvidenceLifecycle;
	workflowType: WorkPeriodEvidenceKind;
	workPeriodId: string;
	requestCycleKey: string;
	revision: number;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	submitter: SubmitterIdentity;
	materialFingerprint: string;
	facts: WorkPeriodSubmittedFacts;
	labels: WorkPeriodSubmittedLabels;
	provenance: "captured_at_submission";
	submittedAt: Instant;
}

function workPeriodLifecycle(row: SubmittedRevisionRow): WorkPeriodEvidenceLifecycle | null {
	if (row.authority === "canonical" && row.workflowId) {
		return { authority: "canonical", workflowId: row.workflowId };
	}
	if (row.authority === "legacy" && !row.workflowId && row.legacyApprovalRequestId) {
		return {
			authority: "legacy",
			legacy: {
				approvalRequestId: row.legacyApprovalRequestId,
				chainInstanceId: row.legacyChainInstanceId,
				observedWorkflowId: row.observedWorkflowId,
			},
		};
	}
	return null;
}

function parseWorkPeriodRevision(
	row: SubmittedRevisionRow,
	organizationId: string,
): WorkPeriodSubmittedRevisionRecord {
	const facts = row.facts;
	const labels = row.labels;
	const lifecycle = workPeriodLifecycle(row);
	if (
		!lifecycle ||
		row.organizationId !== organizationId ||
		(row.workflowType !== "manual_time_submission" &&
			row.workflowType !== "policy_clock_out") ||
		row.sourceType !== "time_entry" ||
		row.schemaVersion !== WORK_PERIOD_EVIDENCE_SCHEMA_VERSION ||
		row.provenance !== "captured_at_submission" ||
		row.submitterActorKind !== "employee" ||
		!isRecord(facts) ||
		facts.kind !== row.workflowType ||
		facts.schemaVersion !== WORK_PERIOD_EVIDENCE_SCHEMA_VERSION ||
		facts.organizationId !== row.organizationId ||
		facts.workPeriodId !== row.sourceId ||
		facts.subjectEmployeeId !== row.subjectEmployeeId ||
		facts.requesterEmployeeId !== row.requesterEmployeeId ||
		!isRecord(facts.interval) ||
		!isRecord(facts.policy) ||
		!isRecord(labels) ||
		!nullableString(labels.subjectName) ||
		!nullableString(labels.requesterName) ||
		!nullableString(labels.submitterName)
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "work_period_submitted_revision",
		});
	}
	const parsedFacts = facts as unknown as WorkPeriodSubmittedFacts;
	if (fingerprintWorkPeriodMaterialFacts(parsedFacts) !== row.materialFingerprint) {
		throw new ApprovalEvidenceError("invariant", {
			field: "material_fingerprint",
		});
	}
	return {
		id: row.id,
		organizationId: row.organizationId,
		lifecycle,
		workflowType: row.workflowType,
		workPeriodId: row.sourceId,
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
		labels: labels as unknown as WorkPeriodSubmittedLabels,
		provenance: "captured_at_submission",
		submittedAt: instantFromDate(row.submittedAt),
	};
}

/**
 * Written by the ordinary work-period submission owner inside its transaction,
 * after routing created the lifecycle. The insert is not idempotent: a second
 * capture for the same cycle is a contradiction and rolls the submission back.
 */
export async function captureWorkPeriodSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		lifecycle: WorkPeriodEvidenceLifecycle;
		requestCycleKey: string;
		submittedAt: Instant;
		facts: WorkPeriodSubmittedFacts;
		labels: WorkPeriodSubmittedLabels;
		submitter: { kind: "employee"; employeeId: string; userId: string };
	},
): Promise<WorkPeriodSubmittedRevisionRecord> {
	if (input.facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const legacy = input.lifecycle.authority === "legacy" ? input.lifecycle.legacy : null;
	const inserted = await database
		.insert(approvalSubmittedRevision)
		.values({
			organizationId: input.organizationId,
			authority: input.lifecycle.authority,
			workflowId:
				input.lifecycle.authority === "canonical" ? input.lifecycle.workflowId : null,
			legacyApprovalRequestId: legacy?.approvalRequestId ?? null,
			legacyChainInstanceId: legacy?.chainInstanceId ?? null,
			observedWorkflowId: legacy?.observedWorkflowId ?? null,
			workflowType: input.facts.kind,
			sourceType: "time_entry",
			sourceId: input.facts.workPeriodId,
			requestCycleKey: input.requestCycleKey,
			revision: 1,
			subjectEmployeeId: input.facts.subjectEmployeeId,
			requesterEmployeeId: input.facts.requesterEmployeeId,
			submitterActorKind: input.submitter.kind,
			submitterEmployeeId: input.submitter.employeeId,
			submitterUserId: input.submitter.userId,
			schemaVersion: WORK_PERIOD_EVIDENCE_SCHEMA_VERSION,
			materialFingerprint: fingerprintWorkPeriodMaterialFacts(input.facts),
			facts: input.facts as unknown as JsonObject,
			labels: input.labels as unknown as JsonObject,
			provenance: "captured_at_submission",
			submittedAt: dateFromInstant(input.submittedAt),
		})
		.returning();
	const row = inserted[0];
	if (inserted.length !== 1 || !row) {
		throw new ApprovalEvidenceError("invariant", {
			field: "work_period_submitted_revision",
		});
	}
	return parseWorkPeriodRevision(row, input.organizationId);
}

/** The canonical lifecycle revision, scoped to its organization and workflow. */
export async function loadCanonicalWorkPeriodSubmittedRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowId: string },
): Promise<WorkPeriodSubmittedRevisionRecord | null> {
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.workflowId, input.workflowId),
				inArray(approvalSubmittedRevision.workflowType, [
					...WORK_PERIOD_EVIDENCE_WORKFLOW_TYPES,
				]),
			),
		)
		.orderBy(desc(approvalSubmittedRevision.revision))
		.limit(1);
	const row = rows[0];
	return row ? parseWorkPeriodRevision(row, input.organizationId) : null;
}

/**
 * The legacy lifecycle a request belongs to: the request routing created, or
 * any stage request of the chain it created. A shared work-period ID alone
 * never links two cycles.
 */
export async function loadLegacyWorkPeriodSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workPeriodId: string;
		approvalRequestId: string;
		chainInstanceId: string | null;
	},
): Promise<WorkPeriodSubmittedRevisionRecord | null> {
	const lifecycle = input.chainInstanceId
		? or(
				eq(approvalSubmittedRevision.legacyApprovalRequestId, input.approvalRequestId),
				eq(approvalSubmittedRevision.legacyChainInstanceId, input.chainInstanceId),
			)
		: eq(approvalSubmittedRevision.legacyApprovalRequestId, input.approvalRequestId);
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
				eq(approvalSubmittedRevision.sourceType, "time_entry"),
				eq(approvalSubmittedRevision.sourceId, input.workPeriodId),
				lifecycle,
			),
		)
		.limit(2);
	if (rows.length > 1) {
		throw new ApprovalEvidenceError("invariant", {
			field: "work_period_submitted_revision",
		});
	}
	const row = rows[0];
	return row ? parseWorkPeriodRevision(row, input.organizationId) : null;
}

// ---------------------------------------------------------------------------
// Approval-based time corrections (#301). Canonical lifecycles reference their
// workflow; legacy lifecycles reference the request or chain routing created.
// ---------------------------------------------------------------------------

export interface TimeCorrectionSubmittedRevisionRecord {
	id: string;
	organizationId: string;
	lifecycle: WorkPeriodEvidenceLifecycle;
	workPeriodId: string;
	requestCycleKey: string;
	revision: number;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	submitter: SubmitterIdentity;
	materialFingerprint: string;
	facts: TimeCorrectionSubmittedFacts;
	labels: WorkPeriodSubmittedLabels;
	provenance: "captured_at_submission";
	submittedAt: Instant;
}

function parseTimeCorrectionRevision(
	row: SubmittedRevisionRow,
	organizationId: string,
): TimeCorrectionSubmittedRevisionRecord {
	const facts = row.facts;
	const labels = row.labels;
	const lifecycle = workPeriodLifecycle(row);
	if (
		!lifecycle ||
		row.organizationId !== organizationId ||
		row.workflowType !== "time_correction" ||
		row.sourceType !== "time_entry" ||
		row.schemaVersion !== TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION ||
		row.provenance !== "captured_at_submission" ||
		row.submitterActorKind !== "employee" ||
		!isRecord(facts) ||
		facts.kind !== "time_correction" ||
		facts.schemaVersion !== TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION ||
		facts.organizationId !== row.organizationId ||
		facts.workPeriodId !== row.sourceId ||
		facts.subjectEmployeeId !== row.subjectEmployeeId ||
		facts.requesterEmployeeId !== row.requesterEmployeeId ||
		!isRecord(facts.baseline) ||
		!isRecord(facts.requested) ||
		!isRecord(facts.changeMask) ||
		!isRecord(labels) ||
		!nullableString(labels.subjectName) ||
		!nullableString(labels.requesterName) ||
		!nullableString(labels.submitterName)
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "time_correction_submitted_revision",
		});
	}
	const parsedFacts = facts as unknown as TimeCorrectionSubmittedFacts;
	if (fingerprintTimeCorrectionFacts(parsedFacts) !== row.materialFingerprint) {
		throw new ApprovalEvidenceError("invariant", { field: "material_fingerprint" });
	}
	return {
		id: row.id,
		organizationId: row.organizationId,
		lifecycle,
		workPeriodId: row.sourceId,
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
		labels: labels as unknown as WorkPeriodSubmittedLabels,
		provenance: "captured_at_submission",
		submittedAt: instantFromDate(row.submittedAt),
	};
}

/**
 * Written by the correction submission owner inside its transaction, after
 * routing created the lifecycle. A second capture for the same cycle is a
 * contradiction and rolls the submission back.
 */
export async function captureTimeCorrectionSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		lifecycle: WorkPeriodEvidenceLifecycle;
		requestCycleKey: string;
		submittedAt: Instant;
		facts: TimeCorrectionSubmittedFacts;
		labels: WorkPeriodSubmittedLabels;
		submitter: { kind: "employee"; employeeId: string; userId: string };
	},
): Promise<TimeCorrectionSubmittedRevisionRecord> {
	if (input.facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const legacy = input.lifecycle.authority === "legacy" ? input.lifecycle.legacy : null;
	const inserted = await database
		.insert(approvalSubmittedRevision)
		.values({
			organizationId: input.organizationId,
			authority: input.lifecycle.authority,
			workflowId:
				input.lifecycle.authority === "canonical" ? input.lifecycle.workflowId : null,
			legacyApprovalRequestId: legacy?.approvalRequestId ?? null,
			legacyChainInstanceId: legacy?.chainInstanceId ?? null,
			observedWorkflowId: legacy?.observedWorkflowId ?? null,
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: input.facts.workPeriodId,
			requestCycleKey: input.requestCycleKey,
			revision: 1,
			subjectEmployeeId: input.facts.subjectEmployeeId,
			requesterEmployeeId: input.facts.requesterEmployeeId,
			submitterActorKind: input.submitter.kind,
			submitterEmployeeId: input.submitter.employeeId,
			submitterUserId: input.submitter.userId,
			schemaVersion: TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION,
			materialFingerprint: fingerprintTimeCorrectionFacts(input.facts),
			facts: input.facts as unknown as JsonObject,
			labels: input.labels as unknown as JsonObject,
			provenance: "captured_at_submission",
			submittedAt: dateFromInstant(input.submittedAt),
		})
		.returning();
	const row = inserted[0];
	if (inserted.length !== 1 || !row) {
		throw new ApprovalEvidenceError("invariant", {
			field: "time_correction_submitted_revision",
		});
	}
	return parseTimeCorrectionRevision(row, input.organizationId);
}

/** The canonical lifecycle revision, scoped to its organization and workflow. */
export async function loadCanonicalTimeCorrectionSubmittedRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowId: string },
): Promise<TimeCorrectionSubmittedRevisionRecord | null> {
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.workflowId, input.workflowId),
				eq(approvalSubmittedRevision.workflowType, "time_correction"),
			),
		)
		.orderBy(desc(approvalSubmittedRevision.revision))
		.limit(1);
	const row = rows[0];
	return row ? parseTimeCorrectionRevision(row, input.organizationId) : null;
}

/**
 * The legacy lifecycle a request belongs to: the request routing created, or
 * any stage request of the chain it created. A shared period ID alone never
 * links two cycles.
 */
export async function loadLegacyTimeCorrectionSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workPeriodId: string;
		approvalRequestId: string;
		chainInstanceId: string | null;
	},
): Promise<TimeCorrectionSubmittedRevisionRecord | null> {
	const lifecycle = input.chainInstanceId
		? or(
				eq(approvalSubmittedRevision.legacyApprovalRequestId, input.approvalRequestId),
				eq(approvalSubmittedRevision.legacyChainInstanceId, input.chainInstanceId),
			)
		: eq(approvalSubmittedRevision.legacyApprovalRequestId, input.approvalRequestId);
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
				eq(approvalSubmittedRevision.workflowType, "time_correction"),
				eq(approvalSubmittedRevision.sourceType, "time_entry"),
				eq(approvalSubmittedRevision.sourceId, input.workPeriodId),
				lifecycle,
			),
		)
		.limit(2);
	if (rows.length > 1) {
		throw new ApprovalEvidenceError("invariant", {
			field: "time_correction_submitted_revision",
		});
	}
	const row = rows[0];
	return row ? parseTimeCorrectionRevision(row, input.organizationId) : null;
}
