import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import type { ApprovalTerminalFinalizationResult } from "../domain-adapters/types";
import type {
	WorkPeriodMaintenanceFacts,
	WorkPeriodTerminalOutcome,
} from "../domain-adapters/work-period-contract";
import type { ResolvePolicyAndCreateApprovalResult } from "../policies/chain-service";
import type { ApprovalDatabase } from "../server/types";
import type {
	ApprovalCommandResult,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
	ApprovalWorkflowStatus,
	JsonObject,
} from "../workflow/ports";
import {
	type ApprovalWorkflowCommand,
	fingerprintApprovalCommandActor,
} from "../workflow/state-machine";
import { loadEmployeeLabel } from "./absence-submission";
import { deriveCommandDecisionOutcome } from "./decision-outcome";
import { ApprovalEvidenceError } from "./errors";
import {
	captureWorkPeriodSubmittedRevision,
	type LegacyDecisionEvidenceRecord,
	loadCanonicalWorkPeriodSubmittedRevision,
	loadEvidenceActorLabel,
	loadLegacyWorkPeriodSubmittedRevision,
	readApprovalEvidenceMode,
	recordDecisionEvidence,
	recordLegacyDecisionEvidence,
	type WorkPeriodSubmittedRevisionRecord,
} from "./store";
import {
	buildWorkPeriodSubmittedFacts,
	compareLiveWorkPeriodWithRevision,
	verifyWorkPeriodInterval,
	type WorkPeriodEndpointFacts,
	type WorkPeriodEvidenceKind,
	type WorkPeriodFactsInput,
	type WorkPeriodSubmittedFacts,
} from "./work-period-facts";

/**
 * Approval lifecycle evidence for manual time submissions and policy
 * clock-outs (#302). The ordinary work-period submission and decision owners
 * call these helpers inside their existing transactions; capture follows
 * `approval_evidence_control` per organization and kind and is inactive by
 * default. Every failure throws and rolls the owning operation back.
 */

const LEGACY_DECISION_COMMAND_VERSION = "work-period-legacy-decision:v1";
const SUBMISSION_ACTIVATION_COMMAND = "work-period-submission-activation:v1";

type DecisionAction = "approve" | "reject";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/**
 * Owner receipt keys embed the decision reason verbatim. Evidence keeps only a
 * versioned digest of the exact key, so free text never leaves the workflow
 * events while the committed command stays identifiable by its key.
 */
export function workPeriodReceiptKeyDigest(idempotencyKey: string): string {
	return `receipt-key:sha256:${sha256(idempotencyKey)}`;
}

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

// ---------------------------------------------------------------------------
// Live graph reads
// ---------------------------------------------------------------------------

async function loadEntries(
	database: ApprovalDatabase,
	scope: { organizationId: string; employeeId: string },
	ids: string[],
) {
	if (ids.length === 0) return [];
	return await database
		.select({
			id: timeEntry.id,
			organizationId: timeEntry.organizationId,
			employeeId: timeEntry.employeeId,
			type: timeEntry.type,
			timestamp: timeEntry.timestamp,
			utcOffsetMinutes: timeEntry.utcOffsetMinutes,
			timezone: timeEntry.timezone,
			timezoneSource: timeEntry.timezoneSource,
		})
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, scope.organizationId),
				eq(timeEntry.employeeId, scope.employeeId),
				inArray(timeEntry.id, ids),
			),
		);
}

async function loadPeriods(
	database: ApprovalDatabase,
	scope: { organizationId: string; employeeId: string },
	ids: string[],
) {
	return await database
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			canonicalRecordId: workPeriod.canonicalRecordId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isActive: workPeriod.isActive,
			deletedAt: workPeriod.deletedAt,
			projectId: workPeriod.projectId,
			workCategoryId: workPeriod.workCategoryId,
			workLocationType: workPeriod.workLocationType,
			approvalStatus: workPeriod.approvalStatus,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				inArray(workPeriod.id, ids),
			),
		);
}

/** The organization-scoped period and its two endpoint entries, as stored now. */
export async function loadWorkPeriodFactsInput(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		kind: WorkPeriodEvidenceKind;
		requesterEmployeeId: string;
		policy: WorkPeriodFactsInput["policy"];
	},
): Promise<WorkPeriodFactsInput | null> {
	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	const [period, ...others] = await loadPeriods(database, scope, [input.workPeriodId]);
	if (!period || others.length > 0) return null;
	const entries = await loadEntries(
		database,
		scope,
		[period.clockInId, period.clockOutId].filter((id): id is string => id !== null),
	);
	const entry = (id: string | null) => entries.find((candidate) => candidate.id === id) ?? null;
	return {
		kind: input.kind,
		requesterEmployeeId: input.requesterEmployeeId,
		period,
		clockIn: entry(period.clockInId),
		clockOut: entry(period.clockOutId),
		policy: input.policy,
	};
}

export interface WorkPeriodResultSegment {
	workPeriodId: string;
	canonicalRecordId: string;
	approvalStatus: string;
	clockIn: WorkPeriodEndpointFacts;
	clockOut: WorkPeriodEndpointFacts;
	storedDurationMinutes: number;
	elapsedSeconds: number;
}

/**
 * Every resulting segment as committed by this transaction, each with its own
 * endpoints, captures and independently stored minutes.
 */
export async function readWorkPeriodResultSegments(
	database: ApprovalDatabase,
	input: { organizationId: string; employeeId: string; workPeriodIds: string[] },
): Promise<WorkPeriodResultSegment[]> {
	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	const periods = await loadPeriods(database, scope, input.workPeriodIds);
	const entries = await loadEntries(
		database,
		scope,
		periods.flatMap((period) =>
			[period.clockInId, period.clockOutId].filter((id): id is string => id !== null),
		),
	);
	return input.workPeriodIds.map((id) => {
		const period = periods.find((candidate) => candidate.id === id);
		if (!period) return incomplete("result_segment");
		// The same verification as submitted intervals, so an unverifiable
		// resulting segment is never recorded as an outcome.
		const interval = verifyWorkPeriodInterval(
			period,
			entries.find((entry) => entry.id === period.clockInId) ?? null,
			entries.find((entry) => entry.id === period.clockOutId) ?? null,
		);
		return { workPeriodId: period.id, approvalStatus: period.approvalStatus, ...interval };
	});
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/**
 * Builds the submitted facts from the locked graph before routing or terminal
 * finalization can change it. Returns null while capture is inactive.
 */
export async function prepareWorkPeriodSubmissionFacts(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		kind: WorkPeriodEvidenceKind;
		workPeriodId: string;
		requesterEmployeeId: string;
		policy: WorkPeriodFactsInput["policy"];
	},
): Promise<WorkPeriodSubmittedFacts | null> {
	const mode = await readApprovalEvidenceMode(database, {
		organizationId: input.organizationId,
		workflowType: input.kind,
	});
	if (mode !== "capture") return null;
	const live = await loadWorkPeriodFactsInput(database, {
		...input,
		employeeId: input.requesterEmployeeId,
	});
	if (!live) return incomplete("work_period");
	return buildWorkPeriodSubmittedFacts(live);
}

/** Facts of the terminal outcome, read from the committed result graph. */
async function terminalResult(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		outcome: WorkPeriodTerminalOutcome;
		maintenance: WorkPeriodMaintenanceFacts | null;
	},
): Promise<JsonObject> {
	const segments = await readWorkPeriodResultSegments(database, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		workPeriodIds: input.outcome.resultPeriodIds,
	});
	if (segments.some((segment) => segment.approvalStatus !== input.outcome.status)) {
		return incomplete("result_status");
	}
	return {
		status: input.outcome.status,
		adjustment: { ...input.outcome.adjustment },
		segments: segments as unknown as JsonObject[],
		// Required follow-ups run through the decision owner's after-commit
		// maintenance; recorded here so the outcome names what remains to do.
		followUps: input.maintenance
			? {
					delivery: "post_commit_owner",
					workBalanceDirtyFromDate: input.maintenance.dirtyFromDate,
					surchargePeriodIds: [...input.maintenance.surchargePeriodIds],
					staleSurchargePeriodIds: [...input.maintenance.staleSurchargePeriodIds],
				}
			: null,
	};
}

export type WorkPeriodSubmissionLifecycle =
	| {
			authority: "canonical";
			workflow: ApprovalWorkflowSnapshot;
			events: ApprovalWorkflowEventSnapshot[];
	  }
	| {
			authority: "legacy";
			routing: ResolvePolicyAndCreateApprovalResult;
			/** Shadow observation linked by this submission, if any. Not authority. */
			observedWorkflowId: string | null;
	  };

export interface WorkPeriodSubmissionEvidenceInput {
	organizationId: string;
	requestCycleKey: string;
	facts: WorkPeriodSubmittedFacts;
	/** The authenticated human who submitted, evidenced separately. */
	submitterUserId: string;
	lifecycle: WorkPeriodSubmissionLifecycle;
	/** Present when routing completed the request during submission. */
	activation: {
		outcome: WorkPeriodTerminalOutcome;
		maintenance: WorkPeriodMaintenanceFacts | null;
	} | null;
}

async function verifyLegacySubmissionLifecycle(
	database: ApprovalDatabase,
	input: WorkPeriodSubmissionEvidenceInput & {
		lifecycle: Extract<WorkPeriodSubmissionLifecycle, { authority: "legacy" }>;
	},
) {
	const { routing } = input.lifecycle;
	const expectedStatus = routing.kind === "auto_completed" ? "approved" : "pending";
	const requests = await database
		.select({
			id: approvalRequest.id,
			status: approvalRequest.status,
			approvedAt: approvalRequest.approvedAt,
			createdAt: approvalRequest.createdAt,
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, routing.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.facts.workPeriodId),
				eq(approvalRequest.requestedBy, input.facts.requesterEmployeeId),
			),
		)
		.limit(2);
	const request = requests[0];
	if (requests.length !== 1 || !request || request.status !== expectedStatus) {
		return incomplete("legacy_lifecycle");
	}
	const chainInstanceId = routing.kind === "default_created" ? null : routing.chainInstanceId;
	if (!chainInstanceId) return { request, chainInstanceId: null, chainStageId: null };
	const [chains, stages] = await Promise.all([
		database
			.select({ id: approvalChainInstance.id })
			.from(approvalChainInstance)
			.where(
				and(
					eq(approvalChainInstance.id, chainInstanceId),
					eq(approvalChainInstance.organizationId, input.organizationId),
					eq(approvalChainInstance.entityType, "time_entry"),
					eq(approvalChainInstance.entityId, input.facts.workPeriodId),
				),
			)
			.limit(2),
		database
			.select({ id: approvalChainStageInstance.id })
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.chainInstanceId, chainInstanceId),
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.approvalRequestId, routing.approvalRequestId),
				),
			)
			.limit(2),
	]);
	if (chains.length !== 1 || stages.length > 1) return incomplete("legacy_lifecycle");
	return { request, chainInstanceId, chainStageId: stages[0]?.id ?? null };
}

/**
 * Writes the submitted revision (and, when routing completed the request, the
 * system activation outcome) in the submission transaction. The facts were
 * captured before routing; the lifecycle references are what routing created.
 */
export async function captureWorkPeriodSubmissionEvidence(
	database: ApprovalDatabase,
	input: WorkPeriodSubmissionEvidenceInput,
): Promise<WorkPeriodSubmittedRevisionRecord> {
	const { facts } = input;
	if (facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const [subject, submitter] = await Promise.all([
		loadEmployeeLabel(database, input.organizationId, {
			employeeId: facts.subjectEmployeeId,
		}),
		loadEmployeeLabel(database, input.organizationId, {
			userId: input.submitterUserId,
		}),
	]);
	if (
		!subject ||
		!submitter ||
		submitter.userId !== input.submitterUserId ||
		facts.requesterEmployeeId !== subject.employeeId
	) {
		return incomplete("roles");
	}
	const labels = {
		subjectName: subject.name,
		requesterName: subject.name,
		submitterName: submitter.name,
	};
	const submitterIdentity = {
		kind: "employee" as const,
		employeeId: submitter.employeeId,
		userId: submitter.userId,
	};
	const systemActor = { kind: "system", employeeId: null, userId: null } as const;
	const activationReceipt = {
		idempotencyKey: input.requestCycleKey,
		actorFingerprint: fingerprintApprovalCommandActor(systemActor),
		commandFingerprint: SUBMISSION_ACTIVATION_COMMAND,
	};

	if (input.lifecycle.authority === "canonical") {
		const { workflow } = input.lifecycle;
		if (
			workflow.organizationId !== input.organizationId ||
			workflow.workflowType !== facts.kind ||
			workflow.sourceType !== "time_entry" ||
			workflow.sourceId !== facts.workPeriodId ||
			workflow.requesterEmployeeId !== facts.requesterEmployeeId
		) {
			throw new ApprovalEvidenceError("invariant", { field: "workflow_scope" });
		}
		const revision = await captureWorkPeriodSubmittedRevision(database, {
			organizationId: input.organizationId,
			lifecycle: { authority: "canonical", workflowId: workflow.id },
			requestCycleKey: input.requestCycleKey,
			// Persisted submission instant of the workflow, never a render time.
			submittedAt: workflow.submittedAt,
			facts,
			labels,
			submitter: submitterIdentity,
		});
		if (workflow.status !== "pending") {
			const decidingStages = workflow.stages.filter((stage) => stage.status === workflow.status);
			if (
				workflow.status !== "approved" ||
				!workflow.completedAt ||
				decidingStages.length === 0 ||
				!input.activation
			) {
				return incomplete("activation_outcome");
			}
			await recordDecisionEvidence(database, {
				organizationId: input.organizationId,
				workflowId: workflow.id,
				submittedRevisionId: revision.id,
				operationKind: "submission_activation",
				receipt: activationReceipt,
				action: "approve",
				stageId: decidingStages.at(-1)?.id ?? null,
				assignmentId: null,
				assignmentOutcome: null,
				requestOutcome: workflow.status,
				actor: systemActor,
				decidedAt: workflow.completedAt,
				eventIds: input.lifecycle.events.map((event) => event.id),
				result: {
					workPeriodStatus: "approved",
					terminal: await terminalResult(database, {
						organizationId: input.organizationId,
						employeeId: facts.subjectEmployeeId,
						...input.activation,
					}),
				},
				labels: { actorName: null },
				reviewedBindingId: null,
			});
		} else if (input.activation) {
			return incomplete("activation_outcome");
		}
		return revision;
	}

	const lifecycle = input.lifecycle;
	const verified = await verifyLegacySubmissionLifecycle(database, { ...input, lifecycle });
	const revision = await captureWorkPeriodSubmittedRevision(database, {
		organizationId: input.organizationId,
		lifecycle: {
			authority: "legacy",
			legacy: {
				approvalRequestId: lifecycle.routing.approvalRequestId,
				chainInstanceId: verified.chainInstanceId,
				observedWorkflowId: lifecycle.observedWorkflowId,
			},
		},
		requestCycleKey: input.requestCycleKey,
		// Persisted creation of the approval request routing created.
		submittedAt: instantFromDate(verified.request.createdAt),
		facts,
		labels,
		submitter: submitterIdentity,
	});
	if (lifecycle.routing.kind === "auto_completed") {
		if (!input.activation || !verified.request.approvedAt) {
			return incomplete("activation_outcome");
		}
		await recordLegacyDecisionEvidence(database, {
			organizationId: input.organizationId,
			submittedRevisionId: revision.id,
			operationKind: "submission_activation",
			receipt: activationReceipt,
			action: "approve",
			legacy: {
				approvalRequestId: lifecycle.routing.approvalRequestId,
				chainStageId: verified.chainStageId,
				observedWorkflowId: lifecycle.observedWorkflowId,
			},
			assignmentOutcome: null,
			requestOutcome: "approved",
			actor: systemActor,
			decidedAt: instantFromDate(verified.request.approvedAt),
			result: {
				workPeriodStatus: "approved",
				legacyRequestStatus: "approved",
				decidedAtSource: "approval_request.approved_at",
				terminal: await terminalResult(database, {
					organizationId: input.organizationId,
					employeeId: facts.subjectEmployeeId,
					...input.activation,
				}),
			},
			labels: { actorName: null },
		});
	} else if (input.activation) {
		return incomplete("activation_outcome");
	}
	return revision;
}

// ---------------------------------------------------------------------------
// Fresh decision checks shared by both authorities
// ---------------------------------------------------------------------------

async function enforceRevision(
	database: ApprovalDatabase,
	revision: WorkPeriodSubmittedRevisionRecord,
): Promise<void> {
	const live = await loadWorkPeriodFactsInput(database, {
		organizationId: revision.organizationId,
		employeeId: revision.subjectEmployeeId,
		workPeriodId: revision.workPeriodId,
		kind: revision.workflowType,
		requesterEmployeeId: revision.requesterEmployeeId,
		policy: { breakPolicySnapshot: null, surchargeSnapshot: null },
	});
	const comparison = live
		? compareLiveWorkPeriodWithRevision(revision.facts, live)
		: { kind: "material_change" as const, changedFields: ["unverifiable:work_period"] };
	if (comparison.kind === "material_change") {
		throw new ApprovalEvidenceError("material_change", {
			fields: comparison.changedFields.join(","),
		});
	}
}

// ---------------------------------------------------------------------------
// Canonical decisions (transition engine adapter hooks)
// ---------------------------------------------------------------------------

async function loadCanonicalDecisionRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		kind: WorkPeriodEvidenceKind;
		workflow: ApprovalWorkflowSnapshot;
	},
): Promise<WorkPeriodSubmittedRevisionRecord | null> {
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: input.kind,
		}),
		loadCanonicalWorkPeriodSubmittedRevision(database, {
			organizationId: input.organizationId,
			workflowId: input.workflow.id,
		}),
	]);
	if (!revision) {
		if (mode === "capture") throw new ApprovalEvidenceError("evidence_required");
		return null;
	}
	if (
		revision.workflowType !== input.kind ||
		revision.workPeriodId !== input.workflow.sourceId ||
		revision.requesterEmployeeId !== input.workflow.requesterEmployeeId
	) {
		throw new ApprovalEvidenceError("invariant", { field: "revision_scope" });
	}
	return revision;
}

/**
 * Fresh checks after the engine's receipt claim: an evidenced lifecycle must
 * still match its revision; while capture is active one without it is held.
 * Time-kind reviewed bindings are not issued yet, so any supplied one fails.
 */
export async function preflightCanonicalWorkPeriodDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		kind: WorkPeriodEvidenceKind;
		workflow: ApprovalWorkflowSnapshot;
		reviewedBindingId: string | null;
	},
): Promise<void> {
	if (input.reviewedBindingId !== null) {
		throw new ApprovalEvidenceError("binding_mismatch");
	}
	const revision = await loadCanonicalDecisionRevision(database, input);
	if (revision) await enforceRevision(database, revision);
}

/** Records one executed canonical decision in the engine's transaction. */
export async function recordCanonicalWorkPeriodDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		kind: WorkPeriodEvidenceKind;
		workflow: ApprovalWorkflowSnapshot;
		command: Extract<ApprovalWorkflowCommand, { type: "approve" | "reject" }>;
		receipt: { idempotencyKey: string; actorFingerprint: string; commandFingerprint: string };
		result: ApprovalCommandResult;
		finalization: ApprovalTerminalFinalizationResult | null;
		reviewedBindingId: string | null;
	},
): Promise<void> {
	const revision = await loadCanonicalDecisionRevision(database, input);
	if (!revision) return;
	const outcome = deriveCommandDecisionOutcome(input);
	const actor = await loadEvidenceActorLabel(database, {
		organizationId: input.organizationId,
		employeeId: outcome.actor.employeeId,
	});
	if (!actor) return incomplete("actor");
	const finalized = input.finalization;
	const workOutcome = finalized?.workOutcome as WorkPeriodTerminalOutcome | undefined;
	if (
		(finalized === null) !== (outcome.requestOutcome === "pending") ||
		(finalized && !workOutcome)
	) {
		return incomplete("terminal_outcome");
	}
	// The period as this transaction leaves it, never the requested action.
	const [period, ...otherPeriods] = await loadPeriods(
		database,
		{ organizationId: input.organizationId, employeeId: revision.subjectEmployeeId },
		[revision.workPeriodId],
	);
	if (!period || otherPeriods.length > 0) return incomplete("work_period");
	await recordDecisionEvidence(database, {
		organizationId: input.organizationId,
		workflowId: input.workflow.id,
		submittedRevisionId: revision.id,
		operationKind: "command",
		receipt: {
			...input.receipt,
			idempotencyKey: workPeriodReceiptKeyDigest(input.receipt.idempotencyKey),
		},
		action: input.command.type,
		stageId: outcome.stageId,
		assignmentId: outcome.assignmentId,
		assignmentOutcome: outcome.assignmentOutcome,
		requestOutcome: outcome.requestOutcome,
		actor: {
			kind: "employee",
			employeeId: outcome.actor.employeeId,
			userId: outcome.actor.userId,
		},
		decidedAt: outcome.decidedAt,
		eventIds: outcome.eventIds,
		result: {
			workPeriodStatus: period.approvalStatus,
			terminal:
				finalized && workOutcome
					? await terminalResult(database, {
							organizationId: input.organizationId,
							employeeId: revision.subjectEmployeeId,
							outcome: workOutcome,
							maintenance: (finalized.maintenance ??
								null) as unknown as WorkPeriodMaintenanceFacts | null,
						})
					: null,
		},
		labels: { actorName: actor.name },
		reviewedBindingId: input.reviewedBindingId,
	});
}

// ---------------------------------------------------------------------------
// Legacy-authoritative decisions
// ---------------------------------------------------------------------------

export function fingerprintLegacyWorkPeriodDecisionCommand(input: {
	action: DecisionAction;
	approvalRequestId: string;
	reason: string | null;
}): string {
	return `${LEGACY_DECISION_COMMAND_VERSION}:${sha256(
		JSON.stringify([input.action, input.approvalRequestId, sha256(input.reason ?? "")]),
	)}`;
}

export interface LegacyWorkPeriodDecisionPlan {
	revision: WorkPeriodSubmittedRevisionRecord;
}

/**
 * Fresh checks before the legacy mutation, after the owner's established
 * replay matching returned nothing. Once a lifecycle has a submitted revision
 * it is always enforced; while capture is active one without it is held.
 */
export async function prepareLegacyWorkPeriodDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		kind: WorkPeriodEvidenceKind;
		workPeriodId: string;
		approvalRequestId: string;
		chainInstanceId: string | null;
	},
): Promise<LegacyWorkPeriodDecisionPlan | null> {
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: input.kind,
		}),
		loadLegacyWorkPeriodSubmittedRevision(database, input),
	]);
	if (!revision) {
		if (mode === "capture") throw new ApprovalEvidenceError("evidence_required");
		return null;
	}
	if (revision.workflowType !== input.kind) {
		throw new ApprovalEvidenceError("invariant", { field: "revision_scope" });
	}
	await enforceRevision(database, revision);
	return { revision };
}

/**
 * Records the committed legacy decision in the transaction that made it. The
 * outcome, decision time and stage come from the persisted legacy rows after
 * the mutation; the row doubles as the legacy operation receipt (one per
 * decided request). A contradiction rolls the whole decision back.
 */
export async function recordLegacyWorkPeriodDecisionEvidence(
	database: ApprovalDatabase,
	plan: LegacyWorkPeriodDecisionPlan,
	input: {
		organizationId: string;
		action: DecisionAction;
		reason: string | null;
		approvalRequestId: string;
		/** The unchanged legacy idempotency key computed by the decision owner. */
		idempotencyKey: string;
		actor: { employeeId: string; userId: string };
		finalized: {
			outcome?: WorkPeriodTerminalOutcome;
			maintenance: WorkPeriodMaintenanceFacts | null;
		} | null;
	},
): Promise<LegacyDecisionEvidenceRecord> {
	const { revision } = plan;
	const scope = {
		organizationId: input.organizationId,
		employeeId: revision.subjectEmployeeId,
	};
	const [requests, stages, periods] = await Promise.all([
		database
			.select({
				id: approvalRequest.id,
				status: approvalRequest.status,
				approverId: approvalRequest.approverId,
				approvedAt: approvalRequest.approvedAt,
				updatedAt: approvalRequest.updatedAt,
			})
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.id, input.approvalRequestId),
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, revision.workPeriodId),
				),
			)
			.limit(2),
		database
			.select({
				id: approvalChainStageInstance.id,
				chainInstanceId: approvalChainStageInstance.chainInstanceId,
				status: approvalChainStageInstance.status,
				decidedBy: approvalChainStageInstance.decidedBy,
				decidedAt: approvalChainStageInstance.decidedAt,
			})
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
				),
			)
			.limit(2),
		loadPeriods(database, scope, [revision.workPeriodId]),
	]);
	const request = requests[0];
	const stage = stages[0] ?? null;
	const period = periods[0];
	const expected = input.action === "approve" ? "approved" : "rejected";
	const lifecycle = revision.lifecycle.authority === "legacy" ? revision.lifecycle.legacy : null;
	if (
		!lifecycle ||
		requests.length !== 1 ||
		!request ||
		stages.length > 1 ||
		!period ||
		periods.length !== 1 ||
		(lifecycle.chainInstanceId
			? stage?.chainInstanceId !== lifecycle.chainInstanceId
			: stage !== null || request.id !== lifecycle.approvalRequestId)
	) {
		// The decided request is not part of the evidenced lifecycle.
		return incomplete("legacy_lifecycle");
	}
	// Approval writes approved_at, rejection writes updated_at in the statement
	// that changes the status; a chain stage records its own decision time.
	const decided = stage
		? {
				status: stage.status,
				decidedAt: stage.decidedAt,
				decidedBy: stage.decidedBy,
				source: "approval_chain_stage_instance.decided_at",
			}
		: {
				status: request.status,
				decidedAt: request.status === "approved" ? request.approvedAt : request.updatedAt,
				decidedBy: null,
				source:
					request.status === "approved"
						? "approval_request.approved_at"
						: "approval_request.updated_at",
			};
	if (
		request.status !== expected ||
		decided.status !== expected ||
		!decided.decidedAt ||
		(decided.decidedBy !== null && decided.decidedBy !== input.actor.employeeId)
	) {
		return incomplete("assignment_outcome");
	}
	const requestOutcome = period.approvalStatus as ApprovalWorkflowStatus;
	const final = requestOutcome !== "pending";
	if (
		(requestOutcome !== "pending" && requestOutcome !== expected) ||
		final !== Boolean(input.finalized?.outcome)
	) {
		return incomplete("terminal_outcome");
	}
	const actor = await loadEvidenceActorLabel(database, {
		organizationId: input.organizationId,
		employeeId: input.actor.employeeId,
	});
	if (!actor) return incomplete("actor");
	return await recordLegacyDecisionEvidence(database, {
		organizationId: input.organizationId,
		submittedRevisionId: revision.id,
		operationKind: "command",
		receipt: {
			idempotencyKey: workPeriodReceiptKeyDigest(input.idempotencyKey),
			actorFingerprint: fingerprintApprovalCommandActor({
				kind: "employee",
				employeeId: input.actor.employeeId,
				userId: input.actor.userId,
			}),
			commandFingerprint: fingerprintLegacyWorkPeriodDecisionCommand({
				action: input.action,
				approvalRequestId: request.id,
				reason: input.reason,
			}),
		},
		action: input.action,
		legacy: {
			approvalRequestId: request.id,
			chainStageId: stage?.id ?? null,
			// A shadow/ready observation linked to the period; never authority.
			observedWorkflowId: period.approvalWorkflowId,
		},
		assignmentOutcome: expected,
		requestOutcome,
		actor: { kind: "employee", employeeId: input.actor.employeeId, userId: input.actor.userId },
		decidedAt: instantFromDate(decided.decidedAt),
		result: {
			workPeriodStatus: requestOutcome,
			legacyRequestStatus: request.status,
			decidedAtSource: decided.source,
			// A single-stage request keeps its assigned approver when an eligible
			// manager or organization-wide approver decides it, so the persisted row
			// cannot name the decider. Record how the authorized actor relates to it.
			actorAuthority: stage
				? "decided_stage"
				: request.approverId === input.actor.employeeId
					? "assigned_approver"
					: "other_authorized_approver",
			terminal:
				final && input.finalized?.outcome
					? await terminalResult(database, {
							organizationId: input.organizationId,
							employeeId: revision.subjectEmployeeId,
							outcome: input.finalized.outcome,
							maintenance: input.finalized.maintenance,
						})
					: null,
		},
		labels: { actorName: actor.name },
	});
}

// ---------------------------------------------------------------------------
// Caller-facing holds
// ---------------------------------------------------------------------------

const WORK_PERIOD_EVIDENCE_MESSAGES = {
	evidence_required:
		"The times submitted for this entry were not captured. Review is required before a decision can be recorded.",
	evidence_incomplete:
		"The evidence for this decision is incomplete. Review is required before a decision can be recorded.",
	material_change:
		"This time entry changed after it was submitted for approval. No decision was recorded; the entry needs review.",
	binding_mismatch:
		"This review no longer matches the current entry. Reopen the request to review its current details.",
	invocation_mismatch:
		"This action conflicts with a previously recorded action. No decision was made.",
} as const;

/** Evidence holds become 409 conflicts; integrity contradictions stay errors. */
export function translateWorkPeriodEvidenceError(error: unknown): unknown {
	if (!(error instanceof ApprovalEvidenceError) || error.code === "invariant") {
		return error;
	}
	return new ConflictError({
		message: WORK_PERIOD_EVIDENCE_MESSAGES[error.code],
		conflictType: "approval_evidence",
		details: { code: error.code },
	});
}
