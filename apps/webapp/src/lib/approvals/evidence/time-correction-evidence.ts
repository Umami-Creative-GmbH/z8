import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	approvalWorkflowEvent,
	timeEntry,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { instantFromDate, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { ApprovalDatabase } from "../server/types";
import type {
	ApprovalCommandResult,
	ApprovalWorkflowSnapshot,
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
	captureTimeCorrectionSubmittedRevision,
	type LegacyDecisionEvidenceRecord,
	loadCanonicalTimeCorrectionSubmittedRevision,
	loadEvidenceActorLabel,
	loadLegacyTimeCorrectionSubmittedRevision,
	readApprovalEvidenceMode,
	recordDecisionEvidence,
	recordLegacyDecisionEvidence,
	type TimeCorrectionSubmittedRevisionRecord,
} from "./store";
import {
	buildTimeCorrectionSubmittedFacts,
	compareLiveTimeCorrectionWithRevision,
	type TimeCorrectionFactsInput,
	type TimeCorrectionSubmittedFacts,
} from "./time-correction-facts";

/**
 * Approval lifecycle evidence for approval-based time corrections (#301). The
 * correction submission and decision owners call these helpers inside their
 * coordinated transactions; capture follows `approval_evidence_control` for
 * `time_correction` and is inactive by default. Every failure throws and rolls
 * the owning operation back. Holds reuse the work-period evidence translation.
 */

const LEGACY_DECISION_COMMAND_VERSION = "time-correction-legacy-decision:v1";
const SUBMISSION_ACTIVATION_COMMAND = "time-correction-submission-activation:v1";

type DecisionAction = "approve" | "reject";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Owner receipt keys embed the decision reason; evidence keeps only a digest. */
export function timeCorrectionReceiptKeyDigest(idempotencyKey: string): string {
	return `receipt-key:sha256:${sha256(idempotencyKey)}`;
}

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

// ---------------------------------------------------------------------------
// Live graph reads
// ---------------------------------------------------------------------------

const ENTRY_COLUMNS = {
	id: timeEntry.id,
	organizationId: timeEntry.organizationId,
	employeeId: timeEntry.employeeId,
	type: timeEntry.type,
	timestamp: timeEntry.timestamp,
	utcOffsetMinutes: timeEntry.utcOffsetMinutes,
	timezone: timeEntry.timezone,
	timezoneSource: timeEntry.timezoneSource,
	replacesEntryId: timeEntry.replacesEntryId,
	isSuperseded: timeEntry.isSuperseded,
	supersededById: timeEntry.supersededById,
};

async function loadPeriod(
	database: ApprovalDatabase,
	input: { organizationId: string; employeeId: string; workPeriodId: string },
) {
	const rows = await database
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
			deletedAt: workPeriod.deletedAt,
			projectId: workPeriod.projectId,
			workCategoryId: workPeriod.workCategoryId,
			workLocationType: workPeriod.workLocationType,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
			graphRevision: workPeriod.graphRevision,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		)
		.limit(2);
	return rows.length === 1 ? (rows[0] ?? null) : null;
}

async function loadEntries(
	database: ApprovalDatabase,
	scope: { organizationId: string; employeeId: string },
	ids: readonly (string | null | undefined)[],
) {
	const present = ids.filter((id): id is string => typeof id === "string");
	if (present.length === 0) return [];
	return await database
		.select(ENTRY_COLUMNS)
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, scope.organizationId),
				eq(timeEntry.employeeId, scope.employeeId),
				inArray(timeEntry.id, present),
			),
		);
}

type Correction = {
	action: "edit" | "delete";
	workLocationType?: string;
	workCategoryId?: string | null;
	clockInCorrectionId?: string;
	clockOutCorrectionId?: string;
};

/** The period, its endpoint entries and the proposal's correction entries, as stored now. */
async function loadFactsInput(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		requesterEmployeeId: string;
		correction: Correction;
	},
): Promise<TimeCorrectionFactsInput | null> {
	const period = await loadPeriod(database, input);
	if (!period) return null;
	const entries = await loadEntries(database, input, [
		period.clockInId,
		period.clockOutId,
		input.correction.clockInCorrectionId,
		input.correction.clockOutCorrectionId,
	]);
	const entry = (id: string | null | undefined) =>
		id ? (entries.find((candidate) => candidate.id === id) ?? null) : null;
	const { clockInCorrectionId, clockOutCorrectionId, ...correction } = input.correction;
	return {
		requesterEmployeeId: input.requesterEmployeeId,
		period,
		clockIn: entry(period.clockInId),
		clockOut: entry(period.clockOutId),
		correction,
		corrections: {
			clockIn: clockInCorrectionId
				? (entry(clockInCorrectionId) ?? incomplete("clock_in_correction"))
				: null,
			clockOut: clockOutCorrectionId
				? (entry(clockOutCorrectionId) ?? incomplete("clock_out_correction"))
				: null,
		},
	};
}

/**
 * The work graph a finalization left: the corrected segment, the unchanged
 * segment of a rejection, or a deleted period with its zero-length canonical
 * sentinel. Read from the committed rows of this transaction, never inferred
 * from the requested action.
 */
async function readCorrectionResult(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		transition: "approved" | "rejected";
	},
): Promise<JsonObject> {
	const period = await loadPeriod(database, input);
	if (!period) return incomplete("result_work_period");
	const entries = await loadEntries(database, input, [period.clockInId, period.clockOutId]);
	const endpoint = (id: string | null) => {
		const entry = id ? entries.find((candidate) => candidate.id === id) : undefined;
		if (!id) return null;
		if (!entry) return incomplete("result_endpoint");
		return {
			entryId: entry.id,
			at: instantToCanonicalString(instantFromDate(entry.timestamp)),
			utcOffsetMinutes: entry.utcOffsetMinutes,
			timezone: entry.timezone,
			timezoneSource: entry.timezoneSource,
		};
	};
	const start = instantFromDate(period.startTime);
	const end = period.endTime ? instantFromDate(period.endTime) : null;
	const segment = {
		clockIn: endpoint(period.clockInId),
		clockOut: endpoint(period.clockOutId),
		storedDurationMinutes: period.durationMinutes,
		elapsedSeconds: end ? end.since(start).total({ unit: "seconds" }) : null,
		attribution: {
			projectId: period.projectId,
			workCategoryId: period.workCategoryId,
			workLocationType: period.workLocationType,
		},
	};
	if (period.deletedAt === null) {
		return {
			transition: input.transition,
			kind: input.transition === "approved" ? "amended" : "unchanged",
			graphRevision: period.graphRevision,
			segment,
		} as unknown as JsonObject;
	}
	if (input.transition !== "approved" || !period.canonicalRecordId) {
		return incomplete("result_deletion");
	}
	const [sentinel] = await database
		.select({
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			durationMinutes: timeRecord.durationMinutes,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!sentinel) return incomplete("result_sentinel");
	return {
		transition: "approved",
		kind: "deleted",
		graphRevision: period.graphRevision,
		deletedAt: instantToCanonicalString(instantFromDate(period.deletedAt)),
		sentinel: {
			startAt: instantToCanonicalString(instantFromDate(sentinel.startAt)),
			endAt: sentinel.endAt ? instantToCanonicalString(instantFromDate(sentinel.endAt)) : null,
			durationMinutes: sentinel.durationMinutes,
		},
	} as unknown as JsonObject;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/**
 * Builds the submitted facts from the locked period and the proposal's pending
 * entries, before routing or an auto-completing finalization can change them.
 * Returns null while capture is inactive.
 */
export async function prepareTimeCorrectionSubmissionFacts(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workPeriodId: string;
		requesterEmployeeId: string;
		correction: Correction;
	},
): Promise<TimeCorrectionSubmittedFacts | null> {
	const mode = await readApprovalEvidenceMode(database, {
		organizationId: input.organizationId,
		workflowType: "time_correction",
	});
	if (mode !== "capture") return null;
	const live = await loadFactsInput(database, {
		...input,
		employeeId: input.requesterEmployeeId,
	});
	if (!live) return incomplete("work_period");
	return buildTimeCorrectionSubmittedFacts(live);
}

export type TimeCorrectionSubmissionLifecycle =
	| { authority: "canonical"; workflow: ApprovalWorkflowSnapshot }
	| {
			authority: "legacy";
			approvalRequestId: string;
			chainInstanceId: string | null;
			/** Shadow observation linked by this submission, if any. Not authority. */
			observedWorkflowId: string | null;
			autoCompleted: boolean;
	  };

async function verifyLegacySubmission(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		facts: TimeCorrectionSubmittedFacts;
		lifecycle: Extract<TimeCorrectionSubmissionLifecycle, { authority: "legacy" }>;
	},
) {
	const expected = input.lifecycle.autoCompleted ? "approved" : "pending";
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
				eq(approvalRequest.id, input.lifecycle.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.facts.workPeriodId),
				eq(approvalRequest.requestedBy, input.facts.requesterEmployeeId),
			),
		)
		.limit(2);
	const request = requests[0];
	if (requests.length !== 1 || !request || request.status !== expected) {
		return incomplete("legacy_lifecycle");
	}
	const chainInstanceId = input.lifecycle.chainInstanceId;
	if (!chainInstanceId) return { request, chainStageId: null };
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
					eq(approvalChainStageInstance.approvalRequestId, input.lifecycle.approvalRequestId),
				),
			)
			.limit(2),
	]);
	if (chains.length !== 1 || stages.length > 1) return incomplete("legacy_lifecycle");
	return { request, chainStageId: stages[0]?.id ?? null };
}

/**
 * Writes the submitted revision (and, when routing completed the request, the
 * system activation outcome with its resulting graph) in the submission
 * transaction. The facts were captured before routing; the lifecycle
 * references are what routing created.
 */
export async function captureTimeCorrectionSubmissionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		requestCycleKey: string;
		facts: TimeCorrectionSubmittedFacts;
		submitterUserId: string;
		lifecycle: TimeCorrectionSubmissionLifecycle;
	},
): Promise<TimeCorrectionSubmittedRevisionRecord> {
	const { facts } = input;
	if (facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const [subject, submitter] = await Promise.all([
		loadEmployeeLabel(database, input.organizationId, { employeeId: facts.subjectEmployeeId }),
		loadEmployeeLabel(database, input.organizationId, { userId: input.submitterUserId }),
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
		idempotencyKey: timeCorrectionReceiptKeyDigest(input.requestCycleKey),
		actorFingerprint: fingerprintApprovalCommandActor(systemActor),
		commandFingerprint: SUBMISSION_ACTIVATION_COMMAND,
	};
	const activationResult = async () => ({
		terminal: await readCorrectionResult(database, {
			organizationId: input.organizationId,
			employeeId: facts.subjectEmployeeId,
			workPeriodId: facts.workPeriodId,
			transition: "approved",
		}),
	});

	if (input.lifecycle.authority === "canonical") {
		const { workflow } = input.lifecycle;
		if (
			workflow.organizationId !== input.organizationId ||
			workflow.workflowType !== "time_correction" ||
			workflow.sourceType !== "time_entry" ||
			workflow.sourceId !== facts.workPeriodId ||
			workflow.requesterEmployeeId !== facts.requesterEmployeeId
		) {
			throw new ApprovalEvidenceError("invariant", { field: "workflow_scope" });
		}
		const revision = await captureTimeCorrectionSubmittedRevision(database, {
			organizationId: input.organizationId,
			lifecycle: { authority: "canonical", workflowId: workflow.id },
			requestCycleKey: input.requestCycleKey,
			submittedAt: workflow.submittedAt,
			facts,
			labels,
			submitter: submitterIdentity,
		});
		if (workflow.status !== "pending") {
			const decidingStages = workflow.stages.filter((stage) => stage.status === workflow.status);
			if (workflow.status !== "approved" || !workflow.completedAt || decidingStages.length === 0) {
				return incomplete("activation_outcome");
			}
			const events = await database
				.select({ id: approvalWorkflowEvent.id })
				.from(approvalWorkflowEvent)
				.where(
					and(
						eq(approvalWorkflowEvent.organizationId, input.organizationId),
						eq(approvalWorkflowEvent.workflowId, workflow.id),
					),
				);
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
				eventIds: events.map((event) => event.id).sort(),
				result: await activationResult(),
				labels: { actorName: null },
				reviewedBindingId: null,
			});
		}
		return revision;
	}

	const lifecycle = input.lifecycle;
	const verified = await verifyLegacySubmission(database, {
		organizationId: input.organizationId,
		facts,
		lifecycle,
	});
	const revision = await captureTimeCorrectionSubmittedRevision(database, {
		organizationId: input.organizationId,
		lifecycle: {
			authority: "legacy",
			legacy: {
				approvalRequestId: lifecycle.approvalRequestId,
				chainInstanceId: lifecycle.chainInstanceId,
				observedWorkflowId: lifecycle.observedWorkflowId,
			},
		},
		requestCycleKey: input.requestCycleKey,
		submittedAt: instantFromDate(verified.request.createdAt),
		facts,
		labels,
		submitter: submitterIdentity,
	});
	if (lifecycle.autoCompleted) {
		if (!verified.request.approvedAt) return incomplete("activation_outcome");
		await recordLegacyDecisionEvidence(database, {
			organizationId: input.organizationId,
			submittedRevisionId: revision.id,
			operationKind: "submission_activation",
			receipt: activationReceipt,
			action: "approve",
			legacy: {
				approvalRequestId: lifecycle.approvalRequestId,
				chainStageId: verified.chainStageId,
				observedWorkflowId: lifecycle.observedWorkflowId,
			},
			assignmentOutcome: null,
			requestOutcome: "approved",
			actor: systemActor,
			decidedAt: instantFromDate(verified.request.approvedAt),
			result: {
				legacyRequestStatus: "approved",
				decidedAtSource: "approval_request.approved_at",
				...(await activationResult()),
			},
			labels: { actorName: null },
		});
	}
	return revision;
}

// ---------------------------------------------------------------------------
// Fresh decision checks shared by both authorities
// ---------------------------------------------------------------------------

function correctionFromFacts(facts: TimeCorrectionSubmittedFacts): Correction {
	return {
		action: facts.intent === "delete" ? "delete" : "edit",
		...(facts.requested.workLocationType.kind === "set"
			? { workLocationType: facts.requested.workLocationType.value ?? undefined }
			: {}),
		...(facts.requested.workCategoryId.kind === "set"
			? { workCategoryId: facts.requested.workCategoryId.value }
			: {}),
		...(facts.requested.clockIn
			? { clockInCorrectionId: facts.requested.clockIn.correctionEntryId }
			: {}),
		...(facts.requested.clockOut
			? { clockOutCorrectionId: facts.requested.clockOut.correctionEntryId }
			: {}),
	};
}

/** The live period must still be the submitted baseline with the same proposal. */
async function enforceRevision(
	database: ApprovalDatabase,
	revision: TimeCorrectionSubmittedRevisionRecord,
): Promise<void> {
	const live = await loadFactsInput(database, {
		organizationId: revision.organizationId,
		employeeId: revision.subjectEmployeeId,
		workPeriodId: revision.workPeriodId,
		requesterEmployeeId: revision.requesterEmployeeId,
		correction: correctionFromFacts(revision.facts),
	}).catch((error: unknown) => {
		if (error instanceof ApprovalEvidenceError) return null;
		throw error;
	});
	const comparison = live
		? compareLiveTimeCorrectionWithRevision(revision.facts, live)
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
	input: { organizationId: string; workflow: ApprovalWorkflowSnapshot },
): Promise<TimeCorrectionSubmittedRevisionRecord | null> {
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: "time_correction",
		}),
		loadCanonicalTimeCorrectionSubmittedRevision(database, {
			organizationId: input.organizationId,
			workflowId: input.workflow.id,
		}),
	]);
	if (!revision) {
		if (mode === "capture") throw new ApprovalEvidenceError("evidence_required");
		return null;
	}
	if (
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
export async function preflightCanonicalTimeCorrectionDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot;
		reviewedBindingId: string | null;
	},
): Promise<void> {
	if (input.reviewedBindingId !== null) throw new ApprovalEvidenceError("binding_mismatch");
	const revision = await loadCanonicalDecisionRevision(database, input);
	if (revision) await enforceRevision(database, revision);
}

/** Records one executed canonical decision in the engine's transaction. */
export async function recordCanonicalTimeCorrectionDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot;
		command: Extract<ApprovalWorkflowCommand, { type: "approve" | "reject" }>;
		receipt: { idempotencyKey: string; actorFingerprint: string; commandFingerprint: string };
		result: ApprovalCommandResult;
		finalized: boolean;
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
	if (input.finalized !== (outcome.requestOutcome !== "pending")) {
		return incomplete("terminal_outcome");
	}
	await recordDecisionEvidence(database, {
		organizationId: input.organizationId,
		workflowId: input.workflow.id,
		submittedRevisionId: revision.id,
		operationKind: "command",
		receipt: {
			...input.receipt,
			idempotencyKey: timeCorrectionReceiptKeyDigest(input.receipt.idempotencyKey),
		},
		action: input.command.type,
		stageId: outcome.stageId,
		assignmentId: outcome.assignmentId,
		assignmentOutcome: outcome.assignmentOutcome,
		requestOutcome: outcome.requestOutcome,
		actor: { kind: "employee", employeeId: outcome.actor.employeeId, userId: outcome.actor.userId },
		decidedAt: outcome.decidedAt,
		eventIds: outcome.eventIds,
		result: {
			terminal: input.finalized
				? await readCorrectionResult(database, {
						organizationId: input.organizationId,
						employeeId: revision.subjectEmployeeId,
						workPeriodId: revision.workPeriodId,
						transition: input.command.type === "approve" ? "approved" : "rejected",
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

export function fingerprintLegacyTimeCorrectionDecisionCommand(input: {
	action: DecisionAction;
	approvalRequestId: string;
	reason: string | null;
}): string {
	return `${LEGACY_DECISION_COMMAND_VERSION}:${sha256(
		JSON.stringify([input.action, input.approvalRequestId, sha256(input.reason ?? "")]),
	)}`;
}

export interface LegacyTimeCorrectionDecisionPlan {
	revision: TimeCorrectionSubmittedRevisionRecord;
}

/**
 * Fresh checks before the legacy mutation. Once a lifecycle has a submitted
 * revision it is always enforced; while capture is active one without it is held.
 */
export async function prepareLegacyTimeCorrectionDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workPeriodId: string;
		approvalRequestId: string;
		chainInstanceId: string | null;
	},
): Promise<LegacyTimeCorrectionDecisionPlan | null> {
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: "time_correction",
		}),
		loadLegacyTimeCorrectionSubmittedRevision(database, input),
	]);
	if (!revision) {
		if (mode === "capture") throw new ApprovalEvidenceError("evidence_required");
		return null;
	}
	await enforceRevision(database, revision);
	return { revision };
}

/**
 * Records the committed legacy decision in the transaction that made it. The
 * decision time and stage come from the persisted legacy rows after the
 * mutation; the row doubles as the legacy operation receipt (one per decided
 * request). A contradiction rolls the whole decision back.
 */
export async function recordLegacyTimeCorrectionDecisionEvidence(
	database: ApprovalDatabase,
	plan: LegacyTimeCorrectionDecisionPlan,
	input: {
		organizationId: string;
		action: DecisionAction;
		reason: string | null;
		approvalRequestId: string;
		/** The unchanged legacy idempotency key computed by the decision owner. */
		idempotencyKey: string;
		actor: { employeeId: string; userId: string };
		/** Whether this decision finalized the lifecycle (a chain stage may not). */
		finalized: boolean;
	},
): Promise<LegacyDecisionEvidenceRecord> {
	const { revision } = plan;
	const [requests, stages, period] = await Promise.all([
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
		loadPeriod(database, {
			organizationId: input.organizationId,
			employeeId: revision.subjectEmployeeId,
			workPeriodId: revision.workPeriodId,
		}),
	]);
	const request = requests[0];
	const stage = stages[0] ?? null;
	const expected = input.action === "approve" ? "approved" : "rejected";
	const lifecycle = revision.lifecycle.authority === "legacy" ? revision.lifecycle.legacy : null;
	if (
		!lifecycle ||
		requests.length !== 1 ||
		!request ||
		stages.length > 1 ||
		!period ||
		(lifecycle.chainInstanceId
			? stage?.chainInstanceId !== lifecycle.chainInstanceId
			: stage !== null || request.id !== lifecycle.approvalRequestId)
	) {
		return incomplete("legacy_lifecycle");
	}
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
			idempotencyKey: timeCorrectionReceiptKeyDigest(input.idempotencyKey),
			actorFingerprint: fingerprintApprovalCommandActor({
				kind: "employee",
				employeeId: input.actor.employeeId,
				userId: input.actor.userId,
			}),
			commandFingerprint: fingerprintLegacyTimeCorrectionDecisionCommand({
				action: input.action,
				approvalRequestId: request.id,
				reason: input.reason,
			}),
		},
		action: input.action,
		legacy: {
			approvalRequestId: request.id,
			chainStageId: stage?.id ?? null,
			observedWorkflowId: period.approvalWorkflowId,
		},
		assignmentOutcome: expected,
		requestOutcome: input.finalized ? expected : "pending",
		actor: { kind: "employee", employeeId: input.actor.employeeId, userId: input.actor.userId },
		decidedAt: instantFromDate(decided.decidedAt),
		result: {
			legacyRequestStatus: request.status,
			decidedAtSource: decided.source,
			actorAuthority: stage
				? "decided_stage"
				: request.approverId === input.actor.employeeId
					? "assigned_approver"
					: "other_authorized_approver",
			terminal: input.finalized
				? await readCorrectionResult(database, {
						organizationId: input.organizationId,
						employeeId: revision.subjectEmployeeId,
						workPeriodId: revision.workPeriodId,
						transition: expected,
					})
				: null,
		},
		labels: { actorName: actor.name },
	});
}
