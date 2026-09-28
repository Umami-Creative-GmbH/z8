/**
 * The legacy approval write coordinator (#475).
 *
 * Every legacy approval write under legacy authority runs through it. The
 * caller reads the approval write gate once and hands the result to `observe`;
 * the coordinator decides from it whether shadow mirroring applies, loads the
 * observed workflow of the legacy request being acted on, late-mirrors a
 * request submitted before shadow mirroring began (approvals ADR 0001), and
 * derives the expected version. No caller branches on shadow mirroring around
 * it.
 */
import { sql } from "drizzle-orm";
import type { ApprovalWriteGateResult } from "../authority/resolution";
import type { ApprovalCompatibilityWriter } from "../workflow/compatibility-writer";
import { pinApprovalWriteGate } from "../workflow/pinned-write-gate";
import type {
	ApprovalDbService,
	ApprovalEventActorIdentity,
	ApprovalSourceIdentity,
	ApprovalWorkflowSnapshot,
	ObservedLegacyTransitionResult,
	TransactionalWorkflowRepository,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import { APPROVAL_WORKFLOW_TYPES } from "../workflow/types";

export type LegacyApprovalWriteBoundaryErrorCode =
	| "canonical_authority"
	| "invalid_source_identity"
	| "observation_required"
	| "observation_scope"
	| "observation_unavailable";

export class LegacyApprovalWriteBoundaryError extends Error {
	constructor(
		readonly code: LegacyApprovalWriteBoundaryErrorCode,
		message: string,
	) {
		super(message);
		this.name = "LegacyApprovalWriteBoundaryError";
	}
}

/** Reads the canonical workflow observed for one legacy request. */
export interface ObservedWorkflowReader {
	/**
	 * The workflow of the source's organization, kind and source with a stage
	 * for the legacy request, decided or not; null when there is none.
	 */
	findByLegacyRequest(input: {
		source: ApprovalSourceIdentity;
		legacyApprovalRequestId: string;
	}): Promise<ApprovalWorkflowSnapshot | null>;
}

export interface LegacyApprovalObserveInput {
	/** The caller's gated read; the coordinator never acquires the gate itself. */
	gate: ApprovalWriteGateResult;
	sourceIdentity: ApprovalSourceIdentity;
	/** The requester the observed workflow must belong to. */
	requesterEmployeeId: string;
	/** The legacy request acted on; null for a submission, which observes nothing. */
	legacyApprovalRequestId: string | null;
}

/** What `observe` found, for one legacy write through the same coordinator. */
export interface LegacyApprovalObservation {
	readonly sourceIdentity: ApprovalSourceIdentity;
	readonly legacyApprovalRequestId: string | null;
	/** The observed workflow; null without shadow mirroring or before late mirroring. */
	readonly workflow: ApprovalWorkflowSnapshot | null;
	/**
	 * True when shadow mirroring does not apply; otherwise the predicate on the
	 * observed workflow, and false when there is none.
	 */
	agrees(predicate: (workflow: ApprovalWorkflowSnapshot) => boolean): boolean;
}

interface LegacyApprovalWriteInput<Result> {
	observation: LegacyApprovalObservation;
	actor: ApprovalEventActorIdentity;
	idempotencyKey: string;
	captureState?: () => Promise<VerifiedLegacyApprovalState>;
	mutate: () => Promise<Result>;
	afterMirror?: (result: ObservedLegacyTransitionResult) => Promise<void>;
}

export interface LegacyApprovalWriteCoordinator {
	observe(input: LegacyApprovalObserveInput): Promise<LegacyApprovalObservation>;
	execute<Result>(input: LegacyApprovalWriteInput<Result>): Promise<Result>;
}

interface TrustedObservation {
	gate: ApprovalWriteGateResult;
	sourceIdentity: ApprovalSourceIdentity;
	requesterEmployeeId: string;
	legacyApprovalRequestId: string | null;
	workflow: ApprovalWorkflowSnapshot | null;
}

function invalidIdentity(): never {
	throw new LegacyApprovalWriteBoundaryError(
		"invalid_source_identity",
		"Legacy approval write identity is invalid or outside the trusted scope.",
	);
}

function outOfScope(): never {
	throw new LegacyApprovalWriteBoundaryError(
		"observation_scope",
		"Legacy approval observation is outside the trusted source scope.",
	);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function trustedSourceIdentity(source: ApprovalSourceIdentity): ApprovalSourceIdentity {
	const identity = Object.freeze({
		organizationId: source.organizationId,
		workflowType: source.workflowType,
		sourceType: source.sourceType,
		sourceId: source.sourceId,
	});
	if (
		!nonEmpty(identity.organizationId) ||
		!nonEmpty(identity.sourceType) ||
		!nonEmpty(identity.sourceId) ||
		!APPROVAL_WORKFLOW_TYPES.some((workflowType) => workflowType === identity.workflowType)
	) {
		invalidIdentity();
	}
	return identity;
}

/** The observed workflow belongs to the source, its requester and the legacy request. */
function assertObservedWorkflowScope(
	workflow: ApprovalWorkflowSnapshot,
	observation: Pick<
		TrustedObservation,
		"sourceIdentity" | "requesterEmployeeId" | "legacyApprovalRequestId"
	>,
): void {
	const source = observation.sourceIdentity;
	if (
		workflow.organizationId !== source.organizationId ||
		workflow.workflowType !== source.workflowType ||
		workflow.sourceType !== source.sourceType ||
		workflow.sourceId !== source.sourceId ||
		workflow.requesterEmployeeId !== observation.requesterEmployeeId ||
		!workflow.stages.some(
			(stage) => stage.legacyApprovalRequestId === observation.legacyApprovalRequestId,
		)
	) {
		outOfScope();
	}
}

function assertObservationScope(
	state: VerifiedLegacyApprovalState,
	sourceIdentity: ApprovalSourceIdentity,
): void {
	if (
		state.organizationId !== sourceIdentity.organizationId ||
		state.source.organizationId !== sourceIdentity.organizationId ||
		state.source.workflowType !== sourceIdentity.workflowType ||
		state.source.sourceType !== sourceIdentity.sourceType ||
		state.source.sourceId !== sourceIdentity.sourceId
	) {
		outOfScope();
	}
}

function snapshotVerifiedLegacyApprovalState(
	state: VerifiedLegacyApprovalState,
): VerifiedLegacyApprovalState {
	return normalizeStableData(state) as VerifiedLegacyApprovalState;
}

function snapshotActor(actor: ApprovalEventActorIdentity): ApprovalEventActorIdentity {
	return Object.freeze({ ...actor });
}

/** The late-mirror receipt: one per legacy request, however often it is acted on. */
export function lateMirrorIdempotencyKey(
	source: ApprovalSourceIdentity,
	legacyApprovalRequestId: string,
): string {
	return [
		"late-mirror",
		source.organizationId,
		source.workflowType,
		source.sourceType,
		source.sourceId,
		legacyApprovalRequestId,
	].join(":");
}

function resultRows(result: unknown): Record<string, unknown>[] {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	const rows = (result as { rows: unknown }).rows;
	return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** The observed-workflow read on the caller's transaction and workflow repository. */
export function createObservedWorkflowReader(dependencies: {
	dbService: ApprovalDbService;
	repository: Pick<TransactionalWorkflowRepository, "loadSnapshot">;
}): ObservedWorkflowReader {
	return {
		async findByLegacyRequest({ source, legacyApprovalRequestId }) {
			const rows = resultRows(
				await dependencies.dbService.db.execute(sql`
					select distinct workflow.id
					from approval_workflow workflow
					join approval_workflow_stage stage
						on stage.workflow_id = workflow.id
						and stage.organization_id = workflow.organization_id
					where workflow.organization_id = ${source.organizationId}
						and workflow.workflow_type = ${source.workflowType}
						and workflow.source_type = ${source.sourceType}
						and workflow.source_id = ${source.sourceId}::uuid
						and stage.legacy_approval_request_id = ${legacyApprovalRequestId}::uuid
					limit 2
				`),
			);
			if (rows.length === 0) return null;
			const workflowId = rows[0]?.id;
			// A legacy request is observed by exactly one workflow.
			if (rows.length !== 1 || typeof workflowId !== "string") outOfScope();
			return dependencies.repository.loadSnapshot({
				organizationId: source.organizationId,
				workflowId,
			});
		},
	};
}

export function createLegacyApprovalWriteCoordinator(dependencies: {
	compatibilityWriter: ApprovalCompatibilityWriter;
	observedWorkflows: ObservedWorkflowReader;
}): LegacyApprovalWriteCoordinator {
	// Observations are trusted only when this coordinator made them.
	const observations = new WeakMap<LegacyApprovalObservation, TrustedObservation>();

	return {
		async observe(input) {
			const sourceIdentity = trustedSourceIdentity(input.sourceIdentity);
			const { gate, requesterEmployeeId, legacyApprovalRequestId } = input;
			if (
				!nonEmpty(requesterEmployeeId) ||
				(legacyApprovalRequestId !== null && !nonEmpty(legacyApprovalRequestId))
			) {
				invalidIdentity();
			}
			const trusted: TrustedObservation = {
				gate,
				sourceIdentity,
				requesterEmployeeId,
				legacyApprovalRequestId,
				workflow: null,
			};
			if (gate.authority === "legacy" && gate.shadowMirroring && legacyApprovalRequestId) {
				const workflow = await dependencies.observedWorkflows.findByLegacyRequest({
					source: sourceIdentity,
					legacyApprovalRequestId,
				});
				if (workflow) {
					assertObservedWorkflowScope(workflow, trusted);
					trusted.workflow = workflow;
				}
			}
			const observation: LegacyApprovalObservation = Object.freeze({
				sourceIdentity,
				legacyApprovalRequestId,
				workflow: trusted.workflow,
				agrees: (predicate: (workflow: ApprovalWorkflowSnapshot) => boolean) =>
					!gate.shadowMirroring || (trusted.workflow !== null && predicate(trusted.workflow)),
			});
			observations.set(observation, trusted);
			return observation;
		},

		async execute<Result>(input: LegacyApprovalWriteInput<Result>) {
			const observation = observations.get(input.observation);
			if (!observation) invalidIdentity();
			const { gate, sourceIdentity } = observation;
			const actor = snapshotActor(input.actor);
			const { idempotencyKey, captureState, mutate, afterMirror } = input;
			if (!nonEmpty(idempotencyKey)) invalidIdentity();
			if (gate.authority !== "legacy") {
				throw new LegacyApprovalWriteBoundaryError(
					"canonical_authority",
					"Legacy approval writes are not authoritative under canonical authority.",
				);
			}
			if (!gate.shadowMirroring) return mutate();
			if (!captureState) {
				throw new LegacyApprovalWriteBoundaryError(
					"observation_required",
					"Legacy approval observation is required while shadow mirroring.",
				);
			}
			// The compatibility writer answers from the caller's gate, never a new read.
			const compatibilityWriter = dependencies.compatibilityWriter.withWriteGate(
				pinApprovalWriteGate({
					organizationId: sourceIdentity.organizationId,
					workflowType: sourceIdentity.workflowType,
					authority: gate,
					refuse: invalidIdentity,
				}),
			);
			const mirror = async (mirrorInput: {
				before: VerifiedLegacyApprovalState;
				after: VerifiedLegacyApprovalState;
				idempotencyKey: string;
				expectedVersion: number | null;
			}) => {
				const mirrored = await compatibilityWriter.mirrorLegacyToCanonical({
					...mirrorInput,
					actor,
				});
				if (mirrored === null) {
					throw new LegacyApprovalWriteBoundaryError(
						"observation_unavailable",
						"Legacy approval observation was unavailable.",
					);
				}
				return mirrored;
			};

			const capturedBefore = await captureState();
			assertObservationScope(capturedBefore, sourceIdentity);
			const before = snapshotVerifiedLegacyApprovalState(capturedBefore);
			let observedWorkflow = observation.workflow;
			if (observation.legacyApprovalRequestId !== null && observedWorkflow === null) {
				// Late mirroring (ADR 0001): the request, submitted before shadow
				// mirroring began, is first mirrored as a fresh submission.
				const lateMirrored = await mirror({
					before: snapshotVerifiedLegacyApprovalState({
						...before,
						approvalRequest: null,
						chain: null,
						chainRows: [],
					}),
					after: before,
					idempotencyKey: lateMirrorIdempotencyKey(
						sourceIdentity,
						observation.legacyApprovalRequestId,
					),
					expectedVersion: null,
				});
				assertObservedWorkflowScope(lateMirrored.snapshot, observation);
				if (lateMirrored.snapshot.status !== "pending" || lateMirrored.snapshot.version !== 1) {
					outOfScope();
				}
				observedWorkflow = lateMirrored.snapshot;
			}
			const result = await mutate();
			const capturedAfter = await captureState();
			assertObservationScope(capturedAfter, sourceIdentity);
			const mirrored = await mirror({
				before,
				after: snapshotVerifiedLegacyApprovalState(capturedAfter),
				idempotencyKey,
				expectedVersion: observedWorkflow?.version ?? null,
			});
			// An action on a legacy request moves only the workflow observing it.
			if (observedWorkflow && mirrored.snapshot.id !== observedWorkflow.id) outOfScope();
			await afterMirror?.(mirrored);
			return result;
		},
	};
}
