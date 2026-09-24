import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { absenceEntry } from "@/db/schema";
import {
	type Instant,
	instantFromDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import type { ApprovalDatabase } from "../server/types";
import type {
	ApprovalWorkflowStatus,
	JsonObject,
	LegacyApprovalRequestSnapshot,
	ObservedLegacyTransitionResult,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import {
	type AbsenceCompatibilityEncoding,
	type AbsenceNormalizedCoverageInput,
	type AbsenceRawCoverageInput,
	buildAbsenceSubmittedFacts,
	compareLiveAbsenceWithRevision,
} from "./absence-facts";
import { loadEmployeeLabel } from "./absence-submission";
import { ApprovalEvidenceError } from "./errors";
import {
	captureLegacyAbsenceSubmittedRevision,
	findLegacyDecisionEvidenceByRequest,
	type LegacyAbsenceSubmittedRevisionRecord,
	type LegacyDecisionEvidenceRecord,
	loadEvidenceActorLabel,
	loadLegacyAbsenceSubmittedRevision,
	readApprovalEvidenceMode,
	recordLegacyDecisionEvidence,
} from "./store";

/**
 * Legacy-authoritative absence evidence (#288). The legacy owners keep deciding;
 * these helpers run inside their transactions and add equivalent immutable
 * evidence and an operation receipt without creating canonical authority. The
 * legacy idempotency keys are stored exactly as the owners compute them.
 */

const LEGACY_DECISION_COMMAND_VERSION = "absence-legacy-decision:v1";
const LEGACY_SUBMISSION_COMMAND = "absence-legacy-submission:v1";

type LegacyDecisionAction = "approve" | "reject";

export interface LegacyObservationReference {
	workflowId: string;
	eventIds: string[];
}

/** The shadow mirror's result for this operation, as the coordinator returned it. */
export type LegacyObservedMirror = Pick<
	ObservedLegacyTransitionResult,
	"snapshot" | "events"
>;

function observationReference(
	observed: LegacyObservedMirror | null,
): LegacyObservationReference | null {
	return observed
		? {
				workflowId: observed.snapshot.id,
				eventIds: observed.events.map((event) => event.id),
			}
		: null;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/**
 * Versioned command identity of one legacy decision: the exact legacy request,
 * action and reason. The reason enters only as the fingerprint the legacy key
 * already uses, so evidence never stores decision text.
 */
export function fingerprintLegacyAbsenceDecisionCommand(input: {
	action: LegacyDecisionAction;
	approvalRequestId: string;
	reason: string | undefined;
}): string {
	return `${LEGACY_DECISION_COMMAND_VERSION}:${sha256(
		JSON.stringify([
			input.action,
			input.approvalRequestId,
			sha256(input.reason ?? ""),
		]),
	)}`;
}

function legacyEmployeeActorFingerprint(actor: {
	employeeId: string;
	userId: string;
}): string {
	return fingerprintApprovalCommandActor({ kind: "employee", ...actor });
}

async function captureVerifiedState(
	captureState: () => Promise<VerifiedLegacyApprovalState>,
	scope: { organizationId: string; absenceId: string },
): Promise<VerifiedLegacyApprovalState> {
	let state: VerifiedLegacyApprovalState;
	try {
		state = await captureState();
	} catch {
		// Unsupported or contradictory legacy rows: hold, never guess.
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_state",
		});
	}
	if (
		state.organizationId !== scope.organizationId ||
		state.source.organizationId !== scope.organizationId ||
		state.source.workflowType !== "absence" ||
		state.source.sourceType !== "absence_entry" ||
		state.source.sourceId !== scope.absenceId
	) {
		throw new ApprovalEvidenceError("invariant", { field: "legacy_scope" });
	}
	return state;
}

function sourceField<T>(state: VerifiedLegacyApprovalState, key: string): T {
	return (state.sourceSnapshot as Record<string, unknown>)[key] as T;
}

function legacyRequestOutcome(
	state: VerifiedLegacyApprovalState,
): ApprovalWorkflowStatus {
	const status = sourceField<unknown>(state, "status");
	if (status !== "pending" && status !== "approved" && status !== "rejected") {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "request_outcome",
		});
	}
	return status;
}

/**
 * The shadow observation made by this operation, checked against the source's
 * observation link. A submission binds the link itself, so it must match
 * exactly; a decision on a source submitted before shadowing may observe a
 * workflow the source was never linked to, but never a different one.
 */
function observedWorkflowId(
	state: VerifiedLegacyApprovalState,
	observation: LegacyObservationReference | null,
	linkRequired: boolean,
): string | null {
	const linked =
		sourceField<string | null>(state, "approvalWorkflowId") ?? null;
	const observed = observation?.workflowId ?? null;
	const consistent = linkRequired
		? observed === linked
		: linked === null || observed === null || observed === linked;
	if (!consistent) {
		throw new ApprovalEvidenceError("invariant", { field: "observation" });
	}
	return observed;
}

/** The request as the legacy rows record it after the owner's mutation. */
function decidedRequestState(
	state: VerifiedLegacyApprovalState,
	approvalRequestId: string,
): {
	status: LegacyApprovalRequestSnapshot["status"];
	chainStageId: string | null;
	chainDecidedBy: string | null;
	decidedAt: Instant | null;
	decidedAtSource: string;
} {
	if (state.chain) {
		const rows = state.chainRows.filter(
			(row) => row.approvalRequestId === approvalRequestId,
		);
		const row = rows[0];
		if (rows.length !== 1 || !row || row.status === "cancelled") {
			throw new ApprovalEvidenceError("evidence_incomplete", {
				field: "legacy_request",
			});
		}
		return {
			status: row.status,
			chainStageId: row.id,
			chainDecidedBy: row.decidedBy,
			decidedAt: row.decidedAt,
			decidedAtSource: "approval_chain_stage_instance.decided_at",
		};
	}
	const request = state.approvalRequest;
	if (!request || request.id !== approvalRequestId) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_request",
		});
	}
	// Approval writes approved_at; rejection writes updated_at in the same
	// statement that changes the status. Nothing later is read as decision time.
	return request.status === "approved"
		? {
				status: request.status,
				chainStageId: null,
				chainDecidedBy: null,
				decidedAt: request.approvedAt,
				decidedAtSource: "approval_request.approved_at",
			}
		: {
				status: request.status,
				chainStageId: null,
				chainDecidedBy: null,
				decidedAt: request.status === "rejected" ? request.updatedAt : null,
				decidedAtSource: "approval_request.updated_at",
			};
}

export type LegacyAbsenceRouting =
	| { kind: "default_created"; approvalRequestId: string }
	| {
			kind: "chain_created";
			chainInstanceId: string;
			approvalRequestId: string;
	  }
	| {
			kind: "auto_completed";
			chainInstanceId: string | null;
			approvalRequestId: string;
	  };

export interface LegacyAbsenceSubmissionEvidenceInput {
	organizationId: string;
	absenceId: string;
	submissionKey: string;
	routing: LegacyAbsenceRouting;
	/** Post-mutation legacy rows, read inside the submission transaction. */
	captureState: () => Promise<VerifiedLegacyApprovalState>;
	/** This submission's shadow mirror result; null when nothing was mirrored. */
	observed: LegacyObservedMirror | null;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	submitterUserId: string;
	category: { id: string; name: string };
	raw: AbsenceRawCoverageInput | undefined;
	normalized: AbsenceNormalizedCoverageInput;
	entry: AbsenceCompatibilityEncoding["entry"];
	canonicalRecord: { id: string; startAt: Date; endAt: Date };
}

/**
 * Captures a legacy-authoritative absence submission's immutable evidence in
 * the transaction that created the legacy rows. Returns null while capture is
 * inactive. The lifecycle is linked to the legacy request/chain the routing
 * owner actually created; anything it cannot verify rolls the submission back.
 */
export async function captureLegacyAbsenceSubmissionEvidence(
	database: ApprovalDatabase,
	input: LegacyAbsenceSubmissionEvidenceInput,
): Promise<LegacyAbsenceSubmittedRevisionRecord | null> {
	const mode = await readApprovalEvidenceMode(database, {
		organizationId: input.organizationId,
		workflowType: "absence",
	});
	if (mode !== "capture") return null;
	if (!input.raw) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "raw_input",
		});
	}
	const scope = {
		organizationId: input.organizationId,
		absenceId: input.absenceId,
	};
	const state = await captureVerifiedState(input.captureState, scope);
	const chainInstanceId =
		input.routing.kind === "default_created"
			? null
			: input.routing.chainInstanceId;
	if (
		(state.chain?.id ?? null) !== chainInstanceId ||
		(input.routing.kind === "chain_created" && !state.chain)
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_lifecycle",
		});
	}
	const decided = decidedRequestState(state, input.routing.approvalRequestId);
	const expectedStatus =
		input.routing.kind === "auto_completed" ? "approved" : "pending";
	if (
		decided.status !== expectedStatus ||
		legacyRequestOutcome(state) !== expectedStatus
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_lifecycle",
		});
	}
	const observation = observationReference(input.observed);
	const observed = observedWorkflowId(state, observation, true);

	const sources = await database
		.select({ createdAt: absenceEntry.createdAt })
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.id, input.absenceId),
				eq(absenceEntry.organizationId, input.organizationId),
			),
		)
		.limit(2);
	const createdAt = sources[0]?.createdAt;
	if (sources.length !== 1 || !createdAt) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "submitted_at",
		});
	}

	const [subject, submitter] = await Promise.all([
		loadEmployeeLabel(database, input.organizationId, {
			employeeId: input.subjectEmployeeId,
		}),
		loadEmployeeLabel(database, input.organizationId, {
			userId: input.submitterUserId,
		}),
	]);
	if (!subject || !submitter || submitter.userId !== input.submitterUserId) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "roles" });
	}
	const requester =
		input.requesterEmployeeId === subject.employeeId
			? subject
			: await loadEmployeeLabel(database, input.organizationId, {
					employeeId: input.requesterEmployeeId,
				});
	if (!requester) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "requester",
		});
	}

	const facts = buildAbsenceSubmittedFacts({
		organizationId: input.organizationId,
		absenceId: input.absenceId,
		subjectEmployeeId: subject.employeeId,
		requesterEmployeeId: requester.employeeId,
		categoryId: input.category.id,
		raw: input.raw,
		normalized: input.normalized,
		entry: input.entry,
		canonicalRecord: input.canonicalRecord,
	});
	const revision = await captureLegacyAbsenceSubmittedRevision(database, {
		organizationId: input.organizationId,
		requestCycleKey: input.submissionKey,
		// Persisted creation of the submitted source row, never a render time.
		submittedAt: instantFromDate(createdAt),
		facts,
		labels: {
			subjectName: subject.name,
			requesterName: requester.name,
			submitterName: submitter.name,
			categoryName: input.category.name,
		},
		submitter: {
			kind: "employee",
			employeeId: submitter.employeeId,
			userId: submitter.userId,
		},
		legacy: {
			approvalRequestId: input.routing.approvalRequestId,
			chainInstanceId,
			observedWorkflowId: observed,
		},
	});

	if (input.routing.kind === "auto_completed") {
		// Routing approved the request during submission (requester is approver).
		const approvedAt = sourceField<unknown>(state, "approvedAt");
		const decidedAt =
			typeof approvedAt === "string" ? parseInstant(approvedAt) : null;
		if (!decidedAt) {
			throw new ApprovalEvidenceError("evidence_incomplete", {
				field: "activation_outcome",
			});
		}
		const systemActor = {
			kind: "system",
			employeeId: null,
			userId: null,
		} as const;
		await recordLegacyDecisionEvidence(database, {
			organizationId: input.organizationId,
			submittedRevisionId: revision.id,
			operationKind: "submission_activation",
			receipt: {
				idempotencyKey: input.submissionKey,
				actorFingerprint: fingerprintApprovalCommandActor(systemActor),
				commandFingerprint: LEGACY_SUBMISSION_COMMAND,
			},
			action: "approve",
			legacy: {
				approvalRequestId: input.routing.approvalRequestId,
				chainStageId: decided.chainStageId,
				observedWorkflowId: observed,
			},
			assignmentOutcome: null,
			requestOutcome: "approved",
			actor: systemActor,
			decidedAt,
			result: legacyResult({
				absenceStatus: "approved",
				legacyRequestStatus: decided.status,
				decidedAtSource: "absence_entry.approved_at",
				observation,
			}),
			labels: { actorName: null },
		});
	}
	return revision;
}

function legacyResult(input: {
	absenceStatus: ApprovalWorkflowStatus;
	legacyRequestStatus: LegacyApprovalRequestSnapshot["status"];
	decidedAtSource: string;
	observation: LegacyObservationReference | null;
}): JsonObject {
	// Resulting statuses only; no deduction or payable quantity is inferred.
	return {
		absenceStatus: input.absenceStatus,
		legacyRequestStatus: input.legacyRequestStatus,
		decidedAtSource: input.decidedAtSource,
		observation: input.observation
			? {
					kind: "shadow",
					workflowId: input.observation.workflowId,
					eventIds: [...input.observation.eventIds],
				}
			: null,
	};
}

/**
 * Receipt before fresh checks: an exact committed legacy operation (same
 * legacy request, action, reason and actor) returns its historical evidence,
 * with no mutation, evidence write or side effect. Anything else is not a
 * replay and continues through the unchanged legacy owner, which rejects an
 * already-decided request as before. Without the exact request identity the
 * operation cannot be matched, so nothing is guessed.
 */
export async function findLegacyAbsenceDecisionReplay(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		absenceId: string;
		approvalRequestId: string | undefined;
		action: LegacyDecisionAction;
		reason: string | undefined;
		actor: { employeeId: string; userId: string };
	},
): Promise<LegacyDecisionEvidenceRecord | null> {
	if (!input.approvalRequestId) return null;
	const evidence = await findLegacyDecisionEvidenceByRequest(database, {
		organizationId: input.organizationId,
		approvalRequestId: input.approvalRequestId,
	});
	if (evidence?.operationKind !== "command") return null;
	const revision = await loadLegacyAbsenceSubmittedRevision(database, {
		organizationId: input.organizationId,
		absenceId: input.absenceId,
	});
	if (revision?.id !== evidence.submittedRevisionId) return null;
	const matches =
		evidence.receipt.actorFingerprint ===
			legacyEmployeeActorFingerprint(input.actor) &&
		evidence.receipt.commandFingerprint ===
			fingerprintLegacyAbsenceDecisionCommand({
				action: input.action,
				approvalRequestId: input.approvalRequestId,
				reason: input.reason,
			});
	return matches ? evidence : null;
}

export interface LegacyAbsenceDecisionPlan {
	revision: LegacyAbsenceSubmittedRevisionRecord;
	before: VerifiedLegacyApprovalState;
}

/**
 * Fresh evidence checks for a legacy decision, after the replay lookup and
 * before the legacy mutation. Once a lifecycle has a submitted revision it is
 * always enforced; while capture is active a lifecycle without one is held.
 * Live identity, category or stored coverage that differs from the revision is
 * a material change that needs cancellation and resubmission.
 */
export async function prepareLegacyAbsenceDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		absenceId: string;
		captureState: () => Promise<VerifiedLegacyApprovalState>;
	},
): Promise<LegacyAbsenceDecisionPlan | null> {
	const scope = {
		organizationId: input.organizationId,
		absenceId: input.absenceId,
	};
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: "absence",
		}),
		loadLegacyAbsenceSubmittedRevision(database, scope),
	]);
	if (!revision) {
		if (mode === "capture") {
			throw new ApprovalEvidenceError("evidence_required");
		}
		return null;
	}
	const live = await database.query.absenceEntry.findFirst({
		where: and(
			eq(absenceEntry.id, input.absenceId),
			eq(absenceEntry.organizationId, input.organizationId),
		),
		columns: {
			id: true,
			organizationId: true,
			employeeId: true,
			categoryId: true,
			startDate: true,
			startPeriod: true,
			endDate: true,
			endPeriod: true,
		},
		with: { category: { columns: { name: true } } },
	});
	if (!live || live.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "legacy_source" });
	}
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
	if (comparison.kind === "material_change") {
		throw new ApprovalEvidenceError("material_change", {
			fields: comparison.changedFields.join(","),
		});
	}
	const before = await captureVerifiedState(input.captureState, scope);
	return { revision, before };
}

/**
 * Records the committed legacy decision in the same transaction as the legacy
 * mutation and its shadow observation. Outcome, time and stage come from the
 * persisted legacy rows after the mutation, never from the requested action or
 * a clock read; a contradiction rolls the whole decision back.
 */
export async function recordLegacyAbsenceDecisionEvidence(
	database: ApprovalDatabase,
	plan: LegacyAbsenceDecisionPlan,
	input: {
		organizationId: string;
		absenceId: string;
		action: LegacyDecisionAction;
		reason: string | undefined;
		approvalRequestId: string | undefined;
		/** The unchanged legacy idempotency key computed by the decision owner. */
		idempotencyKey: string;
		actor: { employeeId: string; userId: string };
		captureState: () => Promise<VerifiedLegacyApprovalState>;
		/** This decision's shadow mirror result; null when nothing was mirrored. */
		observed: LegacyObservedMirror | null;
	},
): Promise<LegacyDecisionEvidenceRecord> {
	const target = plan.before.approvalRequest;
	if (
		target?.status !== "pending" ||
		(input.approvalRequestId !== undefined &&
			input.approvalRequestId !== target.id)
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_request",
		});
	}
	const lifecycle = plan.revision.legacy;
	if (
		lifecycle.chainInstanceId
			? plan.before.chain?.id !== lifecycle.chainInstanceId
			: target.id !== lifecycle.approvalRequestId
	) {
		// The decided request is not part of the evidenced lifecycle.
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_lifecycle",
		});
	}
	const after = await captureVerifiedState(input.captureState, {
		organizationId: input.organizationId,
		absenceId: input.absenceId,
	});
	const decided = decidedRequestState(after, target.id);
	const expected = input.action === "approve" ? "approved" : "rejected";
	if (
		decided.status !== expected ||
		!decided.decidedAt ||
		(decided.chainDecidedBy !== null &&
			decided.chainDecidedBy !== input.actor.employeeId)
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "assignment_outcome",
		});
	}
	const requestOutcome = legacyRequestOutcome(after);
	const observation = observationReference(input.observed);
	const observed = observedWorkflowId(after, observation, false);
	const actor = await loadEvidenceActorLabel(database, {
		organizationId: input.organizationId,
		employeeId: input.actor.employeeId,
	});
	if (!actor) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "actor" });
	}
	return await recordLegacyDecisionEvidence(database, {
		organizationId: input.organizationId,
		submittedRevisionId: plan.revision.id,
		operationKind: "command",
		receipt: {
			idempotencyKey: input.idempotencyKey,
			actorFingerprint: legacyEmployeeActorFingerprint(input.actor),
			commandFingerprint: fingerprintLegacyAbsenceDecisionCommand({
				action: input.action,
				approvalRequestId: target.id,
				reason: input.reason,
			}),
		},
		action: input.action,
		legacy: {
			approvalRequestId: target.id,
			chainStageId: decided.chainStageId,
			observedWorkflowId: observed,
		},
		assignmentOutcome: expected,
		requestOutcome,
		actor: {
			kind: "employee",
			employeeId: input.actor.employeeId,
			userId: input.actor.userId,
		},
		decidedAt: decided.decidedAt,
		result: legacyResult({
			absenceStatus: requestOutcome,
			legacyRequestStatus: decided.status,
			decidedAtSource: decided.decidedAtSource,
			observation,
		}),
		labels: { actorName: actor.name },
	});
}
