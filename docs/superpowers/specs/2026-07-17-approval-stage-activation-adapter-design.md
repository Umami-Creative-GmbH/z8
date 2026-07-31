# Approval Stage Activation Adapter Design

## Goal

Integrate activation-time reviewer resolution with the canonical workflow engine so each waiting stage resolves current, organization-scoped reviewers inside the transaction that activates the stage.

## Scope

- Extend the `StageActivationResolver` input with the transaction-bound `ApprovalDbService`.
- Add a database-backed stage activation resolver that loads the current organization directory, validates persisted snapshots, invokes the Phase 3.2 pure resolver, and returns `ResolvedStage`.
- Pass the transaction-bound service from `createApprovalTransitionEngine` to the resolver.
- Allow activation to replace a waiting stage's provisional activation mode with the resolver's validated mode before assignment or auto-approval materialization.
- Preserve the existing injected resolver composition point in `createApprovalWorkflowRepository` and its tests.

## Non-Goals

- No workflow, stage, assignment, event, policy, or directory schema change.
- No new source adapter, domain adapter, persistence, rollout, or legacy approval behavior.
- No reviewer assignment persistence in the new resolver. The existing state machine materializes returned assignments.
- No fallback policy editing or routing-policy matching changes.

## Architecture

`createApprovalTransitionEngine` already calls `StageActivationResolver.resolve` while executing the repository transaction. Its `StageActivationInput` gains `dbService: ApprovalDbService`, which is the same transaction-scoped service used by the engine and domain adapter.

The new concrete resolver lives beside the pure routing resolver. It receives the activation input, validates `routingContext` as the canonical `ApprovalRoutingContext`, validates the stage `resolverSnapshot` as the persisted stage resolver shape, reads a current directory through `input.dbService`, and calls `resolveApprovalStageReviewers`.

The concrete resolver is the only database-aware layer. `resolveApprovalStageReviewers` remains pure and does not import database code. The existing repository continues accepting a `StageActivationResolver` dependency, so tests and future composition can inject the concrete resolver without changing transaction ownership.

`ApprovalStageSnapshot.activationMode` is provisional while the stage is `waiting`. `planStageActivation` validates that the resolver returns one supported activation mode, copies that mode to the resulting stage, and then materializes either assignments or requester auto-approval. This narrowly removes the current equality requirement between a waiting stage's stored mode and the resolver result; it does not permit an already active or terminal stage to change modes.

## Directory Loading

The adapter reads employees, employee-manager links, team memberships, and teams through the transaction-bound database service at activation time.

- Every employee and team query filters `organizationId` directly.
- Manager links are retained only when their employee-side organization membership is current; candidate managers are independently filtered by the pure resolver's active, organization-scoped employee checks.
- Team memberships are retained only for teams in the activation organization.
- The adapter intentionally includes inactive employees in its snapshot so the pure resolver can consistently reject them rather than treating absent rows differently from inactive rows.
- No caller-provided candidate, employee, team, or authorization data influences the directory snapshot.

## Snapshot Validation

Both persisted JSON inputs are untrusted at this boundary.

- `routingContext` must contain a valid canonical routing context: the activation organization ID, workflow type, source identity, requester employee ID, and all required nullable or array fields with their expected primitive types.
- The validated routing context organization ID, workflow type, and source identity must equal the trusted workflow identity from `StageActivationInput`.
- `stage.resolverSnapshot` must be an object containing string `approverType` and `fallbackBehavior`; `approverEmployeeId`, when present, is passed through for the pure resolver to validate.
- Malformed or mismatched snapshots throw `ApprovalStageActivationError` with `invalid_stage_resolver`. The resolver never substitutes values from user input, policy editing state, or legacy defaults.

## Resolution Mapping

The adapter maps the pure resolution result directly to the workflow port.

- `{ activationMode: "human", approverEmployeeIds }` becomes `ResolvedStage` with `activationMode: "human"` and one assignment intent per returned employee ID. Each assignment uses empty JSON metadata.
- `{ activationMode: "requester_auto_approve" }` becomes `ResolvedStage` with `activationMode: "requester_auto_approve"` and no assignments.
- `organizationId`, `workflowId`, and `stageId` in every result come solely from trusted activation input.
- The state machine persists the resolver's mode on the activated stage before producing `assignment.created`, `stage.activated`, or `stage.auto_approved` events.
- Typed resolution failures propagate. The surrounding repository transaction rolls back, so no partial activation, assignment, or event persists.

## Security And Consistency

- Directory reads and subsequent stage persistence occur in the same transaction, preventing a stage from activating against an out-of-transaction directory view.
- Tenant scope is enforced in every directory query and rechecked in the pure resolver for every candidate.
- The adapter neither trusts nor accepts an actor, candidate set, authorization decision, or source payload from external callers.
- Requester auto-approval remains a pure resolver disposition. The state machine remains responsible for recording the stage auto-approval event and continuing activation.

## Tests

- Adapter unit tests with a transaction-bound database double prove organization predicates for every directory relation and verify inactive, foreign, and malformed data fails closed.
- Mapping tests prove sorted human reviewers produce parallel assignment intents, requester auto-approval produces no assignments, and trusted stage/workflow identifiers are returned unchanged.
- Snapshot tests cover malformed routing context, stage snapshot, and workflow/context identity mismatch.
- Transition-engine tests prove the transaction-bound service reaches the resolver and the existing state machine materializes human and auto-approved results without port regressions.
- State-machine tests prove a waiting `human` stage can become `requester_auto_approve` at activation, while non-waiting stages and invalid modes remain rejected.
- Run the new adapter suite, focused routing and workflow suites, webapp typecheck, Biome for changed files, and `git diff --check`.
