import type { Instant } from "@/lib/datetime/temporal-core";
import type { ApprovalCompatibilityWriter } from "../workflow/compatibility-writer";
import type {
	ApprovalCommandResult,
	ApprovalDbService,
	ApprovalEventActorIdentity,
	ApprovalOutboxWriter,
	ApprovalProjectionWriter,
	ApprovalSourceIdentity,
	ApprovalWorkflowSnapshot,
	ApprovalWorkflowSourceMap,
	ApprovalWorkflowStatus,
	ApprovalWorkflowType,
	ApprovalWriteGate,
	JsonObject,
	StageActivationResolver,
	TransactionalWorkflowRepository,
} from "../workflow/ports";
import type { ApprovalWorkflowCommand } from "../workflow/state-machine";
import type {
	ApprovalDomainAdapterRegistry,
	ApprovedCancellationAuthorization,
} from "./registry";

export type ApprovalDomainCommand =
	| { kind: "submit"; payload: JsonObject }
	| { kind: "approve"; reason: string | null }
	| { kind: "reject"; reason: string }
	| { kind: "cancel"; reason: string | null };

export interface ApprovalDomainAdapterContext<TSource> {
	organizationId: string;
	workflow: ApprovalWorkflowSnapshot;
	sourceIdentity: ApprovalSourceIdentity;
	source: TSource;
	actor: ApprovalEventActorIdentity;
}

export interface ApprovalDomainCapabilities {
	canCancelAfterApproval: boolean;
}

export type ApprovalTerminalTransition =
	| {
			kind: "approve";
			from: "pending";
			to: "approved";
			reason: string | null;
	  }
	| {
			kind: "reject";
			from: "pending";
			to: "rejected";
			reason: string;
	  }
	| {
			kind: "cancel_pending";
			from: "pending";
			to: "cancelled";
			reason: string | null;
	  }
	| {
			kind: "expire";
			from: "pending";
			to: "expired";
			reason: string | null;
	  }
	| {
			kind: "cancel_approved";
			from: "approved";
			to: "cancelled";
			reason: string | null;
			authorization: ApprovedCancellationAuthorization;
	  };

export type ApprovalTerminalAdapterInput<TSource> =
	ApprovalDomainAdapterContext<TSource> & {
		/** The caller-owned transaction client. Terminal code must not open another transaction. */
		dbService: ApprovalDbService;
		/** Identifies the engine path that produced this terminal transition. */
		finalizationCause: "command" | "activation";
		transition: ApprovalTerminalTransition;
		finalizedAt: Instant;
	};

export interface ApprovalTerminalFinalizationResult {
	organizationId: string;
	workflowId: string;
	sourceIdentity: ApprovalSourceIdentity;
	transitionKind: ApprovalTerminalTransition["kind"];
	terminalStatus: Exclude<ApprovalWorkflowStatus, "pending">;
	sourceSnapshot: JsonObject;
	eventPayload: JsonObject;
	compatibilityPayload: JsonObject;
	finalizedAt: Instant;
	maintenance?: JsonObject;
	/** What finalization did to the source graph, for decision evidence. */
	workOutcome?: JsonObject;
}

export interface ApprovalDisplayProjection {
	displayPayload: JsonObject;
	searchText: string;
}

export interface ApprovalPostCommitEventDescription {
	eventType: string;
	dedupeKey: string;
	payload: JsonObject;
}

/** A fresh (non-replayed) decision command, inside its authoritative transaction. */
export type ApprovalDecisionEvidenceInput<TSource> =
	ApprovalDomainAdapterContext<TSource> & {
		dbService: ApprovalDbService;
		command: Extract<ApprovalWorkflowCommand, { type: "approve" | "reject" }>;
		reviewedBindingId: string | null;
	};

export type ApprovalDecisionEvidenceRecordInput<TSource> =
	ApprovalDecisionEvidenceInput<TSource> & {
		receipt: {
			idempotencyKey: string;
			actorFingerprint: string;
			commandFingerprint: string;
		};
		result: ApprovalCommandResult;
		finalization: ApprovalTerminalFinalizationResult | null;
	};

export interface ApprovalDomainAdapter<TSource> {
	readonly workflowType: ApprovalWorkflowType;
	readonly sourceType: string;
	loadSource(input: {
		dbService: ApprovalDbService;
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot;
		sourceIdentity: ApprovalSourceIdentity;
		actor: ApprovalEventActorIdentity;
	}): Promise<TSource>;
	getTrustedCapabilities(
		input: ApprovalDomainAdapterContext<TSource>,
	): Promise<ApprovalDomainCapabilities>;
	produceRoutingContext(
		input: ApprovalDomainAdapterContext<TSource>,
	): Promise<JsonObject>;
	preflightCommand(
		input: ApprovalDomainAdapterContext<TSource> & {
			command: ApprovalDomainCommand;
			proposedStatus: ApprovalWorkflowStatus;
		},
	): Promise<void>;
	preflightTerminal(
		input: ApprovalTerminalAdapterInput<TSource>,
	): Promise<void>;
	/**
	 * Mutates the organization-scoped source exactly once through input.dbService.
	 * It must not open another transaction.
	 */
	finalizeTerminal(
		input: ApprovalTerminalAdapterInput<TSource>,
	): Promise<ApprovalTerminalFinalizationResult>;
	projectDisplay(
		input: ApprovalDomainAdapterContext<TSource>,
	): Promise<ApprovalDisplayProjection>;
	/**
	 * Optional fresh evidence checks (submitted revision, material change,
	 * reviewed binding). Runs only after the receipt claim found no committed
	 * replay, so it can never invalidate an exact historical retry.
	 */
	preflightDecisionEvidence?(
		input: ApprovalDecisionEvidenceInput<TSource>,
	): Promise<void>;
	/**
	 * Optional immutable decision evidence written in the same transaction as
	 * the transition and receipt. A failure rolls the whole decision back.
	 */
	recordDecisionEvidence?(
		input: ApprovalDecisionEvidenceRecordInput<TSource>,
	): Promise<void>;
}

export interface ApprovalWorkflowTransactionContext<
	TSourceMap extends {
		[Type in ApprovalWorkflowType]: unknown;
	} = ApprovalWorkflowSourceMap,
> {
	dbService: ApprovalDbService;
	writeGate: ApprovalWriteGate;
	repository: TransactionalWorkflowRepository;
	adapterRegistry: ApprovalDomainAdapterRegistry<TSourceMap>;
	activationResolver: StageActivationResolver;
	projectionWriter: ApprovalProjectionWriter;
	compatibilityWriter: ApprovalCompatibilityWriter;
	outboxWriter: ApprovalOutboxWriter;
}

export interface ApprovalPostCommitHandler {
	describePostCommitEvents(input: {
		organizationId: string;
		result: ApprovalCommandResult;
		finalization: ApprovalTerminalFinalizationResult | null;
	}): Promise<ApprovalPostCommitEventDescription[]>;
	handlePostCommitEvent(input: {
		organizationId: string;
		event: ApprovalPostCommitEventDescription;
	}): Promise<void>;
}

export interface ApprovalPostCommitHandlerRegistry {
	get(workflowType: ApprovalWorkflowType): ApprovalPostCommitHandler;
}
