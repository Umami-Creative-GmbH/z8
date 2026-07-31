# Approval Activation Reviewer Resolution Design

## Goal

Resolve approval reviewers only when a canonical workflow stage activates, using current organization-scoped directory data and validated fallback behavior.

## Scope

- Add a pure routing resolver that receives a canonical routing context, stage resolver snapshot, and current scoped directory snapshot.
- Resolve direct/team managers, manager's manager, organization admins, and specific employees.
- Return parallel human reviewer IDs or a requester auto-approval disposition.
- Extend manager eligibility helpers only as needed to expose deterministic plural candidates.

## Non-Goals

- No workflow/stage persistence, assignment materialization, source adapter, transition-engine, or cutover changes.
- No new policy schema or migration.
- No sequential reviewer fan-out or policy-stage editing changes.

## Inputs

The resolver accepts only verified, organization-scoped values:

- Canonical routing context with organization and requester identity.
- A stage resolver snapshot containing approver type, optional specific employee ID, and fallback behavior.
- Current directory snapshot: employees, manager links, team memberships, and teams.

The resolver performs no database I/O. The caller is responsible for building the directory snapshot with organization-scoped queries at activation time.

## Resolution Rules

All candidate employees must be active and belong to the routing context organization. Results are deduplicated and sorted by employee ID before return.

- `direct_manager`: return all eligible direct managers. If none exist, return all eligible primary managers of the requester's teams.
- `manager_manager`: resolve the requester's deterministic primary direct/team manager, then its active direct manager. No team fallback applies to the second hop.
- `org_admin`: return every active organization admin.
- `specific_employee`: return the configured employee only when active and organization-scoped.
- `team_lead` remains unsupported and fails closed.

For any primary result, if the requester appears among candidates, return:

```ts
{ activationMode: "requester_auto_approve", reason: "requester_is_approver" }
```

Otherwise return:

```ts
{ activationMode: "human", approverEmployeeIds: string[] }
```

The canonical engine later creates one assignment per returned reviewer. Any assignment can decide; existing version/CAS semantics select one durable outcome.

## Fallback Rules

When the configured resolver produces no candidate:

- `fail` returns a typed `ApprovalStageActivationError`.
- `default_manager` resolves the direct/team manager candidate set.
- `organization_admin` resolves the active organization-admin candidate set.

Fallback candidates receive the same active, organization, deduplication, sorting, and requester-auto-approval checks. Unsupported or malformed fallback values fail closed. If fallback produces no candidate, return a typed error rather than a synthetic reviewer or legacy default.

## Compatibility

Existing legacy eligibility and approver-resolution call sites remain behaviorally unchanged. The canonical resolver may reuse their pure directory primitives but must not change legacy decision routing. Database helpers remain explicitly organization-scoped and return only current directory data.

## Tests

- Direct and team fallback manager sets, deterministic ordering, duplicates, and primary manager's manager.
- Active organization admins and specific employees, including inactive and cross-organization rejection.
- Requester appearing in primary or fallback candidates produces auto-approval without human IDs.
- Every fallback mode, including missing fallback candidates and invalid persisted fallback values.
- No stale future assignments: resolution is exclusively snapshot-driven and has no persistence side effects.

## Verification

Run the new resolver suite and manager-eligibility suites, webapp typecheck, Biome for changed routing/eligibility files, and `git diff --check`.
