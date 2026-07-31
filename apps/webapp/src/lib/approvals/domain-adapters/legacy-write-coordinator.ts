import type { ApprovalCompatibilityWriter } from "../workflow/compatibility-writer";
import type {
	ApprovalEventActorIdentity,
	ApprovalSourceIdentity,
	ApprovalWorkflowType,
	ApprovalWriteGate,
	ObservedLegacyTransitionResult,
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

interface LegacyApprovalWriteInput<Result> {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	sourceIdentity: ApprovalSourceIdentity;
	actor: ApprovalEventActorIdentity;
	idempotencyKey: string;
	expectedVersion: number | null;
	captureState?: () => Promise<VerifiedLegacyApprovalState>;
	mutate: () => Promise<Result>;
	afterMirror?: (result: ObservedLegacyTransitionResult) => Promise<void>;
}

export interface LegacyApprovalWriteCoordinator {
	execute<Result>(input: LegacyApprovalWriteInput<Result>): Promise<Result>;
}

function assertValidInput(input: LegacyApprovalWriteInput<unknown>): void {
	const source = input.sourceIdentity;
	const hasRequiredIdentity =
		input.organizationId.trim().length > 0 &&
		input.workflowType.trim().length > 0 &&
		source.organizationId.trim().length > 0 &&
		source.workflowType.trim().length > 0 &&
		source.sourceType.trim().length > 0 &&
		source.sourceId.trim().length > 0 &&
		input.idempotencyKey.trim().length > 0;
	const scopeMatches =
		source.organizationId === input.organizationId &&
		source.workflowType === input.workflowType;
	const workflowTypeIsSupported = APPROVAL_WORKFLOW_TYPES.some(
		(workflowType) => workflowType === input.workflowType,
	);
	const versionIsValid =
		input.expectedVersion === null ||
		(Number.isInteger(input.expectedVersion) && input.expectedVersion >= 0);
	if (
		!hasRequiredIdentity ||
		!scopeMatches ||
		!workflowTypeIsSupported ||
		!versionIsValid
	) {
		throw new LegacyApprovalWriteBoundaryError(
			"invalid_source_identity",
			"Legacy approval write identity is invalid or outside the trusted scope.",
		);
	}
}

function assertObservationScope(
	state: VerifiedLegacyApprovalState,
	organizationId: string,
	sourceIdentity: ApprovalSourceIdentity,
): void {
	if (
		state.organizationId !== organizationId ||
		state.source.organizationId !== sourceIdentity.organizationId ||
		state.source.workflowType !== sourceIdentity.workflowType ||
		state.source.sourceType !== sourceIdentity.sourceType ||
		state.source.sourceId !== sourceIdentity.sourceId
	) {
		throw new LegacyApprovalWriteBoundaryError(
			"observation_scope",
			"Legacy approval observation is outside the trusted source scope.",
		);
	}
}

function snapshotVerifiedLegacyApprovalState(
	state: VerifiedLegacyApprovalState,
): VerifiedLegacyApprovalState {
	return normalizeStableData(state) as VerifiedLegacyApprovalState;
}

function snapshotActor(
	actor: ApprovalEventActorIdentity,
): ApprovalEventActorIdentity {
	return Object.freeze({ ...actor });
}

export function createLegacyApprovalWriteCoordinator(dependencies: {
	writeGate: ApprovalWriteGate;
	compatibilityWriter: ApprovalCompatibilityWriter;
}): LegacyApprovalWriteCoordinator {
	return {
		async execute<Result>(input: LegacyApprovalWriteInput<Result>) {
			const execution: LegacyApprovalWriteInput<Result> = {
				organizationId: input.organizationId,
				workflowType: input.workflowType,
				sourceIdentity: {
					organizationId: input.sourceIdentity.organizationId,
					workflowType: input.sourceIdentity.workflowType,
					sourceType: input.sourceIdentity.sourceType,
					sourceId: input.sourceIdentity.sourceId,
				},
				actor: snapshotActor(input.actor),
				idempotencyKey: input.idempotencyKey,
				expectedVersion: input.expectedVersion,
				captureState: input.captureState,
				mutate: input.mutate,
				afterMirror: input.afterMirror,
			};
			assertValidInput(execution);
			const gate = await dependencies.writeGate.acquire({
				organizationId: execution.organizationId,
				workflowType: execution.workflowType,
			});
			const fixedGate: ApprovalWriteGate = {
				acquire: async (scope) => {
					if (
						scope.organizationId !== execution.organizationId ||
						scope.workflowType !== execution.workflowType
					) {
						throw new LegacyApprovalWriteBoundaryError(
							"invalid_source_identity",
							"Legacy approval mirror is outside the trusted scope.",
						);
					}
					return gate;
				},
			};
			const compatibilityWriter =
				dependencies.compatibilityWriter.withWriteGate(fixedGate);

			switch (gate.mode) {
				case "legacy":
					return execution.mutate();
				case "shadow":
				case "ready": {
					if (!execution.captureState) {
						throw new LegacyApprovalWriteBoundaryError(
							"observation_required",
							"Legacy approval observation is required for this rollout mode.",
						);
					}
					const capturedBefore = await execution.captureState();
					assertObservationScope(
						capturedBefore,
						execution.organizationId,
						execution.sourceIdentity,
					);
					const before = snapshotVerifiedLegacyApprovalState(capturedBefore);
					const result = await execution.mutate();
					const capturedAfter = await execution.captureState();
					assertObservationScope(
						capturedAfter,
						execution.organizationId,
						execution.sourceIdentity,
					);
					const after = snapshotVerifiedLegacyApprovalState(capturedAfter);
					const mirrored = await compatibilityWriter.mirrorLegacyToCanonical({
						before,
						after,
						actor: execution.actor,
						idempotencyKey: execution.idempotencyKey,
						expectedVersion: execution.expectedVersion,
					});
					if (mirrored === null) {
						throw new LegacyApprovalWriteBoundaryError(
							"observation_unavailable",
							"Legacy approval observation was unavailable.",
						);
					}
					await execution.afterMirror?.(mirrored);
					return result;
				}
				case "canonical":
				case "complete":
					throw new LegacyApprovalWriteBoundaryError(
						"canonical_authority",
						"Legacy approval writes are not authoritative for this rollout mode.",
					);
			}
		},
	};
}
