# Approval Activation Reviewer Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pure, activation-time reviewer resolution that derives all current eligible reviewers from an organization-scoped directory snapshot and fails closed when routing cannot resolve.

**Architecture:** A new routing resolver consumes canonical routing context, a persisted stage resolver snapshot, and current directory data without database I/O. It returns either sorted human reviewer IDs or a requester auto-approval disposition. Existing manager eligibility primitives remain the source of direct/team and deterministic primary-manager semantics; Phase 3.3 will adapt this pure result to the existing `StageActivationResolver` persistence port.

**Tech Stack:** TypeScript, Vitest, existing approval routing and manager-eligibility modules, pnpm.

**Execution constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not commit, create migrations, write workflow/stage/assignment rows, change transition engine behavior, or add a database-backed activation resolver. Every input is organization-scoped and all failures must be typed and fail closed.

---

## File Map

- Create `apps/webapp/src/lib/approvals/routing/approver-resolver.ts`: persisted stage snapshot contract, typed activation error, pure candidate resolution, fallback handling, and auto-approval disposition.
- Create `apps/webapp/src/lib/approvals/routing/approver-resolver.test.ts`: full resolver matrix for primary candidates, fallback, requester auto-approval, inactive/cross-org users, and deterministic output.
- Modify `apps/webapp/src/lib/approvals/policies/manager-eligibility.ts`: export a direct-only eligible-manager resolver for the second manager hop.
- Modify `apps/webapp/src/lib/approvals/policies/manager-eligibility.test.ts`: lock down direct-only and deterministic primary-manager behavior used by activation.

### Task 1: Define Pure Resolver Contracts And Primary Resolution

**Files:**
- Create: `apps/webapp/src/lib/approvals/routing/approver-resolver.ts`
- Create: `apps/webapp/src/lib/approvals/routing/approver-resolver.test.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/manager-eligibility.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/manager-eligibility.test.ts`

- [x] **Step 1: Write failing primary-resolution tests**

Create a fixed `ApprovalRoutingContext` and scoped directory fixture. Cover every primary resolver kind before adding production code: plural direct managers, team-manager fallback when no direct manager exists, direct-only second hop for `manager_manager`, every active organization admin, valid specific employee, inactive and foreign specific employees, requester auto-approval, and unsupported `team_lead`.

Also add the direct-only primitive regression:

```ts
it("does not use team fallback in direct-only resolution", () => {
  expect(resolveDirectEligibleManagers({
    organizationId: "org-1",
    requesterEmployeeId: "direct-a",
    employees,
    managerLinks: [],
    teamMemberships: [{ employeeId: "direct-a", teamId: "team-a" }],
    teams: [{ id: "team-a", organizationId: "org-1", primaryManagerId: "team-manager-a" }],
  })).toEqual({ ok: false, reason: "Requester has no active direct manager in this organization." });
});
```

```ts
it("returns every sorted eligible direct manager", () => {
  expect(resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "direct_manager", fallbackBehavior: "fail" }),
    directory: directory({ managerLinks: [
      { employeeId: "requester", managerId: "manager-b" },
      { employeeId: "requester", managerId: "manager-a", isPrimary: true },
    ] }),
  })).toEqual({ activationMode: "human", approverEmployeeIds: ["manager-a", "manager-b"] });
});

it("returns requester auto approval when an eligible candidate is the requester", () => {
  expect(resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "specific_employee", approverEmployeeId: "requester" }),
    directory: directory(),
  })).toEqual({ activationMode: "requester_auto_approve", reason: "requester_is_approver" });
});

it("uses only the selected manager's active direct managers for manager_manager", () => {
  expect(resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "manager_manager" }),
    directory: directory({
      managerLinks: [
        { employeeId: "requester", managerId: "manager-a", isPrimary: true },
        { employeeId: "manager-a", managerId: "director" },
      ],
      teamMemberships: [{ employeeId: "manager-a", teamId: "leadership" }],
      teams: [{ id: "leadership", organizationId: "org-1", primaryManagerId: "team-lead" }],
    }),
  })).toEqual({ activationMode: "human", approverEmployeeIds: ["director"] });
});

it("fails closed for an inactive or foreign specific employee", () => {
  expect(() => resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "specific_employee", approverEmployeeId: "foreign-manager" }),
    directory: directory(),
  })).toThrow("No eligible reviewer");
});

it("fails closed for unsupported team_lead without using fallback", () => {
  expect(() => resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "team_lead", fallbackBehavior: "organization_admin" }),
    directory: directory({ requesterRole: "admin" }),
  })).toThrow("Unsupported approver type");
});
```

- [x] **Step 2: Run the new resolver test and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/routing/approver-resolver.test.ts \
  src/lib/approvals/policies/manager-eligibility.test.ts
```

Expected: FAIL because the resolver module and `resolveDirectEligibleManagers` export do not exist.

- [x] **Step 3: Define resolver input, result, and error contracts**

Use the existing `ApprovalRoutingContext`, `EligibleManagerEmployee`, `EligibleManagerLink`, `EligibleTeamMembership`, and `EligibleTeam` shapes. Persisted stage data is runtime input, so do not narrow its `approverType` or `fallbackBehavior` properties to valid unions before validation. Define the new boundary types:

```ts
export interface ApprovalStageResolverSnapshot {
  approverType: string;
  approverEmployeeId?: string;
  fallbackBehavior: string;
}

export type ApprovalStageReviewerResolution =
  | { activationMode: "human"; approverEmployeeIds: string[] }
  | { activationMode: "requester_auto_approve"; reason: "requester_is_approver" };

export class ApprovalStageActivationError extends Error {
  constructor(
    readonly code: "no_eligible_reviewer" | "invalid_stage_resolver",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalStageActivationError";
  }
}
```

`resolveApprovalStageReviewers` accepts `{ context, stage, directory }`. It does not accept a database handle, workflow, user-supplied candidate IDs, or a caller-provided authorization result.

Add the direct-only manager primitive before importing it in the resolver:

```ts
export function resolveDirectEligibleManagers(
  input: ResolveEligibleManagersInput,
): EligibleManagerResult {
  const requester = activeEmployeeInOrg(
    input.employees,
    input.organizationId,
    input.requesterEmployeeId,
  );
  if (!requester) {
    return { ok: false, reason: "Requester is not active in this organization." };
  }

  const managerIds = directManagerIds(input);
  return managerIds.length > 0
    ? { ok: true, source: "direct", managerIds }
    : { ok: false, reason: "Requester has no active direct manager in this organization." };
}
```

Keep `resolveEligibleManagers` behavior unchanged: it retains direct-then-team fallback and can call this helper before resolving team candidates.

- [x] **Step 4: Implement primary candidate resolution**

Build `managerInput` from the context and directory once:

```ts
const managerInput = {
  ...directory,
  organizationId: context.organizationId,
  requesterEmployeeId: context.requesterEmployeeId,
};
```

Implement these exact rules:

```ts
// direct_manager: resolveEligibleManagers(managerInput)
// manager_manager: resolvePrimaryEligibleManager(managerInput), then
//   resolveDirectEligibleManagers({ ...managerInput, requesterEmployeeId: primary.managerId })
// org_admin: all active employees where role === "admin" in context.organizationId
// specific_employee: the one active employee with matching id and organizationId
```

For human candidates, deduplicate and sort with `localeCompare`. If candidates include `context.requesterEmployeeId`, return requester auto-approval instead of human IDs. `team_lead` and any unknown `approverType` throw `ApprovalStageActivationError("invalid_stage_resolver", "Unsupported approver type.")` immediately and never use fallback. A missing requester, inactive candidates, foreign candidates, and an empty candidate set produce a no-candidate result; fallback behavior is added in Task 2.

- [x] **Step 5: Run primary resolver tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/routing/approver-resolver.test.ts \
  src/lib/approvals/policies/manager-eligibility.test.ts
```

Expected: PASS for plural direct/team candidates, a direct-only manager's-manager second hop, org admins, specific employees, requester auto-approval, inactive users, cross-organization IDs, unsupported resolver types, and the direct-only manager primitive.

### Task 2: Add Fallback Resolution And Fail-Closed Regressions

**Files:**
- Modify: `apps/webapp/src/lib/approvals/routing/approver-resolver.ts`
- Modify: `apps/webapp/src/lib/approvals/routing/approver-resolver.test.ts`

- [x] **Step 1: Write failing fallback tests**

Cover every fallback mode, including requester resolution through fallback.

```ts
it("uses all direct/team candidates for default_manager fallback", () => {
  expect(resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "specific_employee", approverEmployeeId: "inactive", fallbackBehavior: "default_manager" }),
    directory: directory({ managerLinks: [{ employeeId: "requester", managerId: "manager-a" }] }),
  })).toEqual({ activationMode: "human", approverEmployeeIds: ["manager-a"] });
});

it("auto-approves when an organization-admin fallback includes the requester", () => {
  expect(resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "specific_employee", approverEmployeeId: "missing", fallbackBehavior: "organization_admin" }),
    directory: directory({ requesterRole: "admin" }),
  })).toEqual({ activationMode: "requester_auto_approve", reason: "requester_is_approver" });
});

it("fails closed when fallback has no candidate", () => {
  expect(() => resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "specific_employee", approverEmployeeId: "missing", fallbackBehavior: "fail" }),
    directory: directory({ employees: [requester()] }),
  })).toThrow("No eligible reviewer");
});

it("fails closed for an invalid persisted fallback value", () => {
  expect(() => resolveApprovalStageReviewers({
    context: context(),
    stage: stage({ approverType: "specific_employee", approverEmployeeId: "missing", fallbackBehavior: "unknown" }),
    directory: directory({ employees: [requester()] }),
  })).toThrow("Unsupported fallback behavior");
});
```

- [x] **Step 2: Run fallback tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/routing/approver-resolver.test.ts -t "fallback"
```

Expected: FAIL because primary resolution currently returns an error without consulting fallback behavior.

- [x] **Step 3: Implement bounded fallback selection**

Only when a supported primary resolver returns no candidate:

```ts
switch (stage.fallbackBehavior) {
  case "fail":
    throw new ApprovalStageActivationError("no_eligible_reviewer", primaryReason);
  case "default_manager":
    return resolveDisposition(resolveEligibleManagers(managerInput));
  case "organization_admin":
    return resolveDisposition(activeOrganizationAdminIds(directory, context.organizationId));
  default:
    throw new ApprovalStageActivationError("invalid_stage_resolver", "Unsupported fallback behavior.");
}
```

`resolveDisposition` performs the same dedupe, sort, and requester check for primary and fallback candidates. Never recurse into fallback and never create a synthetic candidate. A fallback cannot run after `invalid_stage_resolver`.

- [x] **Step 4: Run all resolver tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/routing/approver-resolver.test.ts
```

Expected: PASS with all fallback modes, missing candidates, invalid persisted fallback values, requester-auto disposition, and deterministic ordering cases.

### Task 3: Verify Phase 3.2 Boundary

**Files:**
- Review all files listed above.

- [x] **Step 1: Run focused routing and eligibility suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/routing/approver-resolver.test.ts \
  src/lib/approvals/policies/manager-eligibility.test.ts \
  src/lib/approvals/policies/approver-resolution.test.ts
```

Expected: all tests pass.

- [x] **Step 2: Run type and static checks**

Run:

```bash
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/routing/approver-resolver.ts \
  src/lib/approvals/routing/approver-resolver.test.ts \
  src/lib/approvals/policies/manager-eligibility.ts \
  src/lib/approvals/policies/manager-eligibility.test.ts
```

Expected: every command exits 0.

- [x] **Step 3: Check the whitespace-only diff**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [x] **Step 4: Perform security and scope review**

Verify no untrusted actor, candidate, source, or authorization input reaches the resolver; every candidate is active and organization-scoped; requester candidates always auto-approve; malformed resolver/fallback snapshots and absent fallback candidates fail closed; and no persistence, source adapter, transition engine, or rollout code changed.
