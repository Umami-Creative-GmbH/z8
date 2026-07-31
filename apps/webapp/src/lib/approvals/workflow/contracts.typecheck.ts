import * as registryModule from "../domain-adapters/registry";
import {
	type ApprovalDomainAdapterRegistry,
	type ApprovedCancellationAuthorization,
	createApprovalDomainAdapterRegistry,
} from "../domain-adapters/registry";
import type {
	ApprovalDomainAdapter,
	ApprovalPostCommitHandler,
	ApprovalTerminalTransition,
	ApprovalWorkflowTransactionContext,
} from "../domain-adapters/types";
import type {
	OrdinaryWorkPeriodApprovalSource,
	OrdinaryWorkPeriodWorkflowPayload,
} from "../domain-adapters/work-period-contract";
import type {
	ApprovalAssignmentActorIdentity,
	ApprovalAssignmentSnapshot,
	ApprovalCommandActor,
	ApprovalCommandResult,
	ApprovalEventActorIdentity,
	ApprovalMaterializedAssignmentChange,
	ApprovalMaterializedTransitionPlan,
	ApprovalMaterializedWorkflowEvent,
	ApprovalPlannedEntityReference,
	ApprovalTransitionIdentityResolution,
	ApprovalTransitionPlan,
	ApprovalWorkflowAuthorization,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
	ApprovalWorkflowSourceMap,
	ObservedApprovalOutboxWriteInput,
	ObservedLegacyTransition,
	ObservedLegacyTransitionResult,
	TransactionalWorkflowRepository,
} from "./ports";
import type { ApprovalWorkflowEventType } from "./types";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value,
	>() => Value extends Right ? 1 : 2
		? true
		: false;
type Assert<Value extends true> = Value;

type EngineAdapterKeys = keyof ApprovalDomainAdapter<unknown>;
type ForbiddenEngineKeys = Extract<
	EngineAdapterKeys,
	"describePostCommitEvents" | "handlePostCommitEvent" | "cancelApproved"
>;
type TerminalMutationKeys = Extract<
	EngineAdapterKeys,
	"finalizeTerminal" | "cancelApproved"
>;

type _EngineHasNoPostCommitOrSecondMutation = Assert<
	Equal<ForbiddenEngineKeys, never>
>;
type _EngineHasOneTerminalMutation = Assert<
	Equal<TerminalMutationKeys, "finalizeTerminal">
>;
type _PostCommitBoundaryIsSeparate = Assert<
	Equal<
		keyof ApprovalPostCommitHandler,
		"describePostCommitEvents" | "handlePostCommitEvent"
	>
>;

type RequiredContextKeys =
	| "dbService"
	| "writeGate"
	| "repository"
	| "adapterRegistry"
	| "activationResolver"
	| "projectionWriter"
	| "compatibilityWriter"
	| "outboxWriter";
type _TransactionContextIsComplete = Assert<
	Equal<keyof ApprovalWorkflowTransactionContext, RequiredContextKeys>
>;
type _ObservedLegacyRepositoryPersistsEvents = Assert<
	Equal<
		Awaited<
			ReturnType<
				TransactionalWorkflowRepository["applyObservedLegacyTransition"]
			>
		>,
		ObservedLegacyTransitionResult
	>
>;
type _ObservedTransitionHasExplicitVersionAuthority = Assert<
	Equal<
		keyof ObservedLegacyTransition,
		| "organizationId"
		| "source"
		| "before"
		| "after"
		| "actor"
		| "idempotencyKey"
		| "expectedVersion"
	>
>;
type _ObservedOutboxIsObserveOnly = Assert<
	Equal<ObservedApprovalOutboxWriteInput["disposition"], "observe">
>;
type _ObservedResultIsObserveOnly = Assert<
	Equal<
		ObservedLegacyTransitionResult["outbox"][number]["disposition"],
		"observe"
	>
>;
type _AuthorizationIncludesRequesterCancellation = Assert<
	Equal<
		Awaited<ReturnType<ApprovalWorkflowAuthorization["authorize"]>>,
		"active_assignment" | "requester" | "manage_approval" | "system"
	>
>;

type _CommandResultHasOneAuthoritativeSnapshot = Assert<
	Equal<
		keyof ApprovalCommandResult,
		"snapshot" | "events" | "projection" | "outbox"
	>
>;
type _TransitionPlanHasAuthoritativeBeforeAndPlannedAfter = Assert<
	Equal<
		keyof ApprovalTransitionPlan,
		| "expectedVersion"
		| "previousSnapshot"
		| "plannedSnapshot"
		| "changes"
		| "events"
		| "identityAllocations"
		| "nextAction"
	>
>;
type _MaterializedPlanHasPersistedAuthoritativeSnapshot = Assert<
	Equal<
		keyof ApprovalMaterializedTransitionPlan,
		| "expectedVersion"
		| "resultingSnapshot"
		| "changes"
		| "events"
		| "nextAction"
	>
>;
declare const unresolvedPlan: ApprovalTransitionPlan;
// @ts-expect-error Planned assignments cannot masquerade as persisted snapshots.
const unresolvedSnapshot: ApprovalWorkflowSnapshot =
	unresolvedPlan.plannedSnapshot;
type _RepositoryReturnsIdentityResolutions = Assert<
	Equal<
		Awaited<
			ReturnType<
				TransactionalWorkflowRepository["allocateTransitionIdentities"]
			>
		>,
		ApprovalTransitionIdentityResolution[]
	>
>;
type _IdentityResolutionRetainsEntityKind = Assert<
	Equal<
		keyof ApprovalTransitionIdentityResolution,
		"allocationKey" | "entityKind" | "id"
	>
>;
type _RepositoryAppliesOnlyMaterializedPlans = Assert<
	Equal<
		Parameters<TransactionalWorkflowRepository["applyMaterializedTransition"]>,
		[plan: ApprovalMaterializedTransitionPlan]
	>
>;
// @ts-expect-error Employee command actors require trusted user context.
const commandActorWithoutUser: ApprovalCommandActor = {
	kind: "employee",
	employeeId: "30000000-0000-4000-8000-000000000001",
	userId: null,
};
type _MaterializedEventReferencesContainNoAllocationRefs = Assert<
	Equal<
		Extract<
			ApprovalMaterializedWorkflowEvent["references"][keyof ApprovalMaterializedWorkflowEvent["references"]],
			ApprovalPlannedEntityReference
		>,
		never
	>
>;
type _MaterializedAssignmentChangesContainPersistedRows = Assert<
	Equal<
		ApprovalMaterializedAssignmentChange["resulting"],
		ApprovalAssignmentSnapshot
	>
>;
type _AssignmentRowsUsePhysicalAssignmentActors = Assert<
	Equal<
		NonNullable<ApprovalAssignmentSnapshot["resolvedBy"]>,
		ApprovalAssignmentActorIdentity
	>
>;
type _EventRowsUseEventActors = Assert<
	Equal<ApprovalWorkflowEventSnapshot["actor"], ApprovalEventActorIdentity>
>;
const validEventActor: ApprovalEventActorIdentity = {
	kind: "employee",
	employeeId: "30000000-0000-4000-8000-000000000001",
	userId: "user-1",
};
// @ts-expect-error Assignment rows cannot persist employee user context.
const invalidAssignmentActor: ApprovalAssignmentActorIdentity = validEventActor;
// @ts-expect-error Workflow event names come from the shared registry.
const invalidWorkflowEventType: ApprovalWorkflowEventType = "workflow.unknown";
type _MaterializedAssignmentChangesHaveNoPlannedReference = Assert<
	Equal<Extract<"reference", keyof ApprovalMaterializedAssignmentChange>, never>
>;
declare const repository: TransactionalWorkflowRepository;
// @ts-expect-error Repositories may only apply a fully materialized plan.
repository.applyMaterializedTransition(unresolvedPlan);

interface TestSourceMap {
	absence: { kind: "absence" };
	time_correction: { kind: "time_correction" };
	manual_time_submission: { kind: "manual_time_submission" };
	policy_clock_out: { kind: "policy_clock_out" };
	travel_expense: { kind: "travel_expense" };
	shift_request: { kind: "shift_request" };
	compliance_exception: { kind: "compliance_exception" };
}
type _DefaultSourceMapIsComplete = Assert<
	Equal<keyof ApprovalWorkflowSourceMap, keyof TestSourceMap>
>;
type _OrdinarySourceMapUsesSharedContract = Assert<
	Equal<
		ApprovalWorkflowSourceMap["manual_time_submission" | "policy_clock_out"],
		OrdinaryWorkPeriodApprovalSource
	>
>;
type _OrdinarySourcePayloadIsCanonical = Assert<
	Equal<
		OrdinaryWorkPeriodApprovalSource["payload"],
		Readonly<OrdinaryWorkPeriodWorkflowPayload>
	>
>;
declare const typedRegistry: ApprovalDomainAdapterRegistry<TestSourceMap>;
declare const absenceAdapter: ApprovalDomainAdapter<{ kind: "absence" }>;
type _RegistryInfersSourceFromWorkflowType = Assert<
	Equal<
		ReturnType<typeof typedRegistry.get<"absence">>,
		ApprovalDomainAdapter<{ kind: "absence" }>
	>
>;
// @ts-expect-error Callers cannot choose an arbitrary source type.
typedRegistry.get<{ forged: true }>("absence");
// @ts-expect-error Registry construction requires every workflow type.
createApprovalDomainAdapterRegistry<TestSourceMap>({ absence: absenceAdapter });
// @ts-expect-error The registry module exports no raw capability issuer.
registryModule.mintApprovedCancellationAuthorization({
	organizationId: "org-1",
	workflowId: "10000000-0000-4000-8000-000000000001",
});

declare const approvedCancellationAuthorization: ApprovedCancellationAuthorization;

const validApprovedCancellation: ApprovalTerminalTransition = {
	kind: "cancel_approved",
	from: "approved",
	to: "cancelled",
	reason: null,
	authorization: approvedCancellationAuthorization,
};

// @ts-expect-error External object literals cannot forge approved cancellation authorization.
const forgedApprovedCancellation: ApprovedCancellationAuthorization = {};
// @ts-expect-error Copying an opaque authorization does not preserve its nominal brand.
const copiedApprovedCancellation: ApprovedCancellationAuthorization = {
	...approvedCancellationAuthorization,
};
// @ts-expect-error Approval cannot claim a different terminal state.
const invalidApprovalTransition: ApprovalTerminalTransition = {
	kind: "approve",
	from: "pending",
	to: "rejected",
	reason: null,
};

void validApprovedCancellation;
void invalidApprovalTransition;
void forgedApprovedCancellation;
void copiedApprovedCancellation;
void commandActorWithoutUser;
void invalidAssignmentActor;
void invalidWorkflowEventType;
void validEventActor;
void unresolvedSnapshot;
