# Approval Routing Policy Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure canonical, organization-scoped approval policy matcher while preserving legacy chain-service and settings-preview behavior.

**Architecture:** `approvals/routing` owns canonical context, condition validation, alias handling, and first-match selection. The existing policy matcher becomes a thin adapter from `ApprovalPolicyEvaluationContext`, keeping legacy callers unchanged. Policy settings stores canonical approval type values in the existing JSON condition payload and persists the existing stage fallback column without a migration.

**Tech Stack:** TypeScript, Vitest, Zod, Drizzle ORM, TanStack Form, Tolgee, pnpm.

**Execution constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not commit, create migrations, change cutover authority, implement reviewer resolution, or add source adapters. Every persisted reference and policy selection remains scoped by `organizationId`.

---

## File Map

- Create `apps/webapp/src/lib/approvals/routing/types.ts`: canonical routing context, legacy alias constants, and validated fallback union.
- Create `apps/webapp/src/lib/approvals/routing/policy-matcher.ts`: pure condition validation and canonical first-match selection.
- Create `apps/webapp/src/lib/approvals/routing/policy-matcher.test.ts`: canonical matcher, alias, tenant, malformed-policy, and ordering coverage.
- Modify `apps/webapp/src/lib/approvals/policies/types.ts`: add the persisted stage fallback field to the shared draft shape.
- Modify `apps/webapp/src/lib/approvals/policies/matcher.ts`: adapt legacy context and delegate all condition behavior to routing.
- Modify `apps/webapp/src/lib/approvals/policies/chain-service.ts`: retain persisted stage fallback values when mapping legacy policy rows.
- Modify `apps/webapp/src/lib/approvals/policies/matcher.test.ts`: prove legacy compatibility behavior after delegation.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/action-helpers.ts`: validate canonical type values and stage fallback behavior.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.ts`: persist normalized fallback behavior with tenant-scoped policy writes.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts`: cover settings normalization, fallback validation, and preview compatibility.
- Modify `apps/webapp/src/components/settings/approval-policy/approval-policy-dialog-utils.ts`: model canonical workflow type options and fallback in form payloads.
- Modify `apps/webapp/src/components/settings/approval-policy/approval-policy-dialog.tsx`: render canonical type labels and pass fallback values through the existing stage field.
- Modify `apps/webapp/src/components/settings/approval-policy/approval-policy-stages-field.tsx` and its tests if needed: expose the three supported fallback choices without changing approver resolution.
- Modify `apps/webapp/messages/settings/rules/{en,de,el,es,fr,gsw,it,pl,pt,tr}.json`: canonical workflow and fallback labels.

### Task 1: Add Canonical Routing Types And Pure Matcher

**Files:**
- Create: `apps/webapp/src/lib/approvals/routing/types.ts`
- Create: `apps/webapp/src/lib/approvals/routing/policy-matcher.ts`
- Create: `apps/webapp/src/lib/approvals/routing/policy-matcher.test.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/types.ts`

- [ ] **Step 1: Write the failing canonical matcher tests**

Create a canonical context fixture and verify policy aliases, canonical-only policy values, scope, and no-match behavior.

```ts
it("matches a legacy time_entry policy for manual time submission", () => {
  expect(findMatchingRoutingPolicy(context({ workflowType: "manual_time_submission" }), [
    policy({ priority: 1, values: ["time_entry"] }),
  ])?.id).toBe("policy-1");
});

it("rejects a foreign-organization policy even when all conditions match", () => {
  expect(findMatchingRoutingPolicy(context(), [
    { ...policy(), organizationId: "other-org" },
  ])).toBeNull();
});

it("fails closed for an unsupported persisted fallback", () => {
  expect(() => validateRoutingPolicy(policy({ fallbackBehavior: "manager" }))).toThrow(
    "unsupported fallback behavior",
  );
});
```

- [ ] **Step 2: Run the new test file and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/routing/policy-matcher.test.ts
```

Expected: FAIL because the routing modules do not exist.

- [ ] **Step 3: Define canonical routing types**

In `routing/types.ts`, import `ApprovalWorkflowType` from `@/lib/approvals/workflow/types` and define:

```ts
export const ROUTING_STAGE_FALLBACKS = [
  "fail",
  "default_manager",
  "organization_admin",
] as const;
export type RoutingStageFallback = (typeof ROUTING_STAGE_FALLBACKS)[number];

export interface ApprovalRoutingContext {
  organizationId: string;
  workflowType: ApprovalWorkflowType;
  source: { type: string; id: string };
  requesterEmployeeId: string;
  teamIds: string[];
  locationId: string | null;
  absenceCategoryId: string | null;
  travelExpenseAmount: number | null;
  overtimeRisk: "none" | "warning" | "violation" | null;
  employeeGroupIds: string[];
}

export const LEGACY_APPROVAL_TYPE_ALIASES = {
  absence: ["absence_entry"],
  time_correction: ["time_entry"],
  manual_time_submission: ["time_entry"],
  policy_clock_out: ["time_entry"],
  travel_expense: ["travel_expense_claim"],
  shift_request: [],
  compliance_exception: [],
} as const;
```

Keep policy draft interfaces in `approvals/policies/types.ts`; do not create duplicate persisted-policy shapes in routing. Add `fallbackBehavior: RoutingStageFallback` to `ApprovalPolicyStageDraft`, defaulting existing test fixtures to `"fail"`.

- [ ] **Step 4: Implement the pure matcher and validator**

Create `findMatchingRoutingPolicy(context, policies)` and `validateRoutingPolicy(policy)`. It must:

```ts
const candidates = policies
  .filter((policy) => policy.isActive && policy.organizationId === context.organizationId)
  .toSorted((left, right) => left.priority - right.priority);

return candidates.find((policy) =>
  policy.conditions.every((condition) => matchesRoutingCondition(context, condition)),
) ?? null;
```

`approval_type` compares a condition value against the canonical workflow type and its legacy aliases. `team` matches any `context.teamIds`; location, absence category, overtime risk, and employee groups retain their existing semantics. Travel amount retains inclusive numeric bounds. Reject unsupported operators, missing required payload fields, unknown approval type values, and fallback behavior outside `ROUTING_STAGE_FALLBACKS` with an `ApprovalRoutingPolicyValidationError` that names the invalid field.

- [ ] **Step 5: Run canonical matcher tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/routing/policy-matcher.test.ts
```

Expected: PASS with aliases, every supported condition, no-match, tenant isolation, priority ordering, and malformed persisted-policy cases covered.

### Task 2: Delegate The Legacy Matcher Without Changing Its Contract

**Files:**
- Modify: `apps/webapp/src/lib/approvals/policies/matcher.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/chain-service.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/matcher.test.ts`

- [ ] **Step 1: Add failing legacy compatibility tests**

Add assertions that existing `findMatchingPolicy` contexts still select the same policy and that legacy `teamId` is converted to exactly one canonical team ID.

```ts
it("preserves legacy absence matching through the routing adapter", () => {
  expect(findMatchingPolicy(legacyContext, [matchingPolicy])?.id).toBe("policy_1");
});

it("does not broaden a null legacy team into a team match", () => {
  expect(findMatchingPolicy({ ...legacyContext, teamId: null }, [
    { ...matchingPolicy, conditions: [{ conditionType: "team", operator: "equals", value: "team_1" }] },
  ])).toBeNull();
});

it("rejects an invalid persisted stage fallback through the legacy validation contract", () => {
  expect(validatePolicyDraft({
    ...matchingPolicy,
    stages: [{ ...matchingPolicy.stages[0], fallbackBehavior: "manager" }],
  })).toContain("unsupported fallback behavior");
});
```

- [ ] **Step 2: Run the legacy matcher test and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/policies/matcher.test.ts
```

Expected: FAIL because the current legacy validation ignores the persisted fallback field.

- [ ] **Step 3: Replace duplicated matching logic with an explicit adapter**

In the database-record mapper in `chain-service.ts`, map `stage.fallbackBehavior` into the shared draft field so malformed persisted values are examined by the delegated validator rather than discarded.

Keep `findMatchingPolicy` and `validatePolicyDraft` exports. Convert the old context only at this boundary:

```ts
function toRoutingContext(context: ApprovalPolicyEvaluationContext): ApprovalRoutingContext {
  return {
    organizationId: context.organizationId,
    workflowType: legacyApprovalTypeToWorkflowType(context.approvalType),
    source: { type: context.entityType, id: context.entityId },
    requesterEmployeeId: context.requesterEmployeeId,
    teamIds: context.teamId ? [context.teamId] : [],
    locationId: context.locationId,
    absenceCategoryId: context.absenceCategoryId,
    travelExpenseAmount: context.travelExpenseAmount,
    overtimeRisk: context.overtimeRisk,
    employeeGroupIds: context.employeeGroupIds,
  };
}
```

Delegate matching and validation. Translate a routing validation error into the current string-array validation result so existing settings callers retain their result contract. Do not change chain creation, decision, or fallback execution behavior in this task.

- [ ] **Step 4: Run legacy and canonical matcher tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/routing/policy-matcher.test.ts \
  src/lib/approvals/policies/matcher.test.ts
```

Expected: PASS with legacy behavior unchanged and one routing implementation owning matching semantics.

### Task 3: Accept And Persist Canonical Policy Inputs Safely

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/action-helpers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts`

- [ ] **Step 1: Write failing settings normalization tests**

Add tests for canonical workflow values and fallback persistence validation.

```ts
it("accepts a canonical manual-time policy and organization-admin fallback", () => {
  expect(normalizeApprovalPolicyInputForTest({
    ...validInput,
    conditions: [{ conditionType: "approval_type", operator: "equals", value: "manual_time_submission" }],
    stages: [{ ...validInput.stages[0], fallbackBehavior: "organization_admin" }],
  })).toMatchObject({ success: true });
});

it("rejects an unsupported fallback behavior", () => {
  expect(normalizeApprovalPolicyInputForTest({
    ...validInput,
    stages: [{ ...validInput.stages[0], fallbackBehavior: "manager" }],
  })).toMatchObject({ success: false });
});
```

- [ ] **Step 2: Run settings tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/settings/approval-policies/actions.test.ts'
```

Expected: FAIL because the input schema and persistence mapping do not yet carry canonical types and fallback behavior.

- [ ] **Step 3: Extend server input validation and persistence**

Use `APPROVAL_WORKFLOW_TYPES` plus the three legacy values in the condition schema's approval-type validation. Add `fallbackBehavior: z.enum(ROUTING_STAGE_FALLBACKS).default("fail")` to each stage input. Preserve the existing tenant-scoped reference validation and write the normalized fallback with each stage:

```ts
fallbackBehavior: stage.fallbackBehavior,
```

Keep canonical values in `valueJson`; do not overload typed foreign-key columns or alter database schema. Ensure policy records read by compatibility code include `fallbackBehavior` in their draft mapping.

- [ ] **Step 4: Run settings tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/settings/approval-policies/actions.test.ts'
```

Expected: PASS with canonical type normalization, fallback rejection, existing scoped-reference checks, and legacy preview behavior intact.

### Task 4: Expose Canonical Types And Fallbacks In The Policy Form

**Files:**
- Modify: `apps/webapp/src/components/settings/approval-policy/approval-policy-dialog-utils.ts`
- Modify: `apps/webapp/src/components/settings/approval-policy/approval-policy-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/approval-policy/approval-policy-stages-field.tsx`
- Modify: `apps/webapp/src/components/settings/approval-policy/approval-policy-dialog.test.tsx`
- Modify: `apps/webapp/messages/settings/rules/{en,de,el,es,fr,gsw,it,pl,pt,tr}.json`

- [ ] **Step 1: Write failing form utility and dialog tests**

Cover canonical option payloads and the default fallback.

```ts
it("serializes canonical workflow choices and a stage fallback", () => {
  expect(buildApprovalPolicyPayload({
    ...defaultApprovalPolicyFormValues,
    approvalTypes: ["manual_time_submission"],
    stages: [{ localId: "stage-1", label: "Manager", approverType: "direct_manager", approverEmployeeId: "", fallbackBehavior: "default_manager" }],
  })).toMatchObject({
    conditions: [{ conditionType: "approval_type", operator: "in", values: ["manual_time_submission"] }],
    stages: [{ fallbackBehavior: "default_manager" }],
  });
});
```

- [ ] **Step 2: Run the dialog tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/settings/approval-policy/approval-policy-dialog.test.tsx
```

Expected: FAIL because the form model has no fallback field and the canonical options are absent.

- [ ] **Step 3: Update the form model and controls**

Replace the three legacy-only `approvalTypeOptions` values with the seven canonical workflow types. Add `fallbackBehavior: "fail"` in `newStage` and form values, pass it through `buildApprovalPolicyPayload`, and add a stage-level select limited to `fail`, `default_manager`, and `organization_admin`. Keep the existing TanStack Form patterns and do not introduce react-hook-form.

Add the corresponding translation keys for all ten supported locale files. Use existing approval-policy namespace keys and fallback English text; do not add hardcoded rendered labels.

- [ ] **Step 4: Run dialog tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/settings/approval-policy/approval-policy-dialog.test.tsx
```

Expected: PASS with canonical options, localized labels, default `fail`, and serialized fallback values.

### Task 5: Verify Phase 3.1 Boundary

**Files:**
- Review all files listed above.

- [ ] **Step 1: Run focused routing and settings suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/routing/policy-matcher.test.ts \
  src/lib/approvals/policies/matcher.test.ts \
  'src/app/[locale]/(app)/settings/approval-policies/actions.test.ts' \
  src/components/settings/approval-policy/approval-policy-dialog.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run type and static checks**

Run:

```bash
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/routing \
  src/lib/approvals/policies/matcher.ts \
  'src/app/[locale]/(app)/settings/approval-policies' \
  src/components/settings/approval-policy
```

Expected: every command exits 0.

- [ ] **Step 3: Perform focused review**

Verify that canonical matching uses only the supplied trusted routing context, all policy selection and reference reads remain organization-scoped, invalid persisted policy data fails closed, legacy callers still delegate through the adapter, and no source decision path or rollout mode changes in this increment.
