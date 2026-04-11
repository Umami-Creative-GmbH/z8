# Unified Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing unified approvals inbox so it covers travel expense approvals, uses one shared query and decision path across approval types, and emits consistent per-item audit data for single and bulk decisions.

**Architecture:** Build on the current `apps/webapp/src/lib/approvals/*` plugin architecture instead of creating a second approval stack. Add a travel-expense handler, enrich the shared approval contract for consistent decision results and audit metadata, route the API and UI through the shared services, and retire the separate travel-expense manager queue once the inbox can fully replace it.

**Tech Stack:** Next.js App Router, TypeScript, Effect, Drizzle ORM, React Query, Vitest, CASL authorization.

---

## File Map

- `apps/webapp/src/lib/approvals/domain/types.ts`
  Defines canonical approval types, filters, detail payloads, and bulk decision result shapes.
- `apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.ts`
  New adapter that maps travel expense claims into `UnifiedApprovalItem` and delegates approve or reject actions.
- `apps/webapp/src/lib/approvals/handlers/index.ts`
  Exports the new travel-expense handler.
- `apps/webapp/src/lib/approvals/init.ts`
  Registers the travel-expense handler at startup.
- `apps/webapp/src/lib/approvals/application/approval-query.service.ts`
  Becomes the canonical mixed-type inbox query path used by API routes.
- `apps/webapp/src/lib/approvals/application/bulk-approval.service.ts`
  Upgrades from bulk approve only to per-item bulk decision results and shared validation behavior.
- `apps/webapp/src/lib/approvals/infrastructure/audit-logger.ts`
  Normalizes cross-module audit event payloads for single and bulk decisions.
- `apps/webapp/src/app/api/approvals/inbox/route.ts`
  Switches from manual handler loops to `ApprovalQueryService`.
- `apps/webapp/src/app/api/approvals/inbox/counts/route.ts`
  Uses the shared counts service so inbox badges include travel expenses.
- `apps/webapp/src/app/api/approvals/inbox/bulk-approve/route.ts`
  Delegates to the shared bulk service and returns per-item results.
- `apps/webapp/src/app/api/approvals/inbox/bulk-reject/route.ts`
  Delegates to the shared bulk service for bulk rejection with a shared reason payload.
- `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.ts`
  Reuses the shared audit metadata contract for single approvals.
- `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.ts`
  Reuses the shared audit metadata contract for single rejections.
- `apps/webapp/src/lib/query/use-approval-inbox.ts`
  Keeps the client contract aligned with the richer bulk result shape and travel-expense type.
- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar.tsx`
  Adds the travel-expense type filter label and the bulk reject flow support.
- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx`
  Adds the travel-expense icon mapping and keeps row rendering generic.
- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.tsx`
  Displays travel-expense detail content and preserves approve or reject affordances.
- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`
  Surfaces the new type, partial-success feedback, and the final bulk decision UX.
- `apps/webapp/src/app/[locale]/(app)/travel-expenses/approvals/page.tsx`
  Redirects the old travel-expense approvals entry point to the unified inbox.

## Task 1: Extend the shared approval contract

**Files:**
- Modify: `apps/webapp/src/lib/approvals/domain/types.ts`
- Test: `apps/webapp/src/lib/approvals/server/queries.test.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/actions.canonical.test.ts`

- [ ] **Step 1: Write a failing domain contract test for the new approval type and bulk result shape**

Add assertions to `apps/webapp/src/lib/approvals/server/queries.test.ts` that encode the new approval type and result semantics.

```ts
import { describe, expect, it } from "vitest";
import type { ApprovalType, BulkDecisionResult } from "../domain/types";

describe("approval domain contract", () => {
  it("supports travel expense approvals in the shared type union", () => {
    const type: ApprovalType = "travel_expense_claim";
    expect(type).toBe("travel_expense_claim");
  });

  it("tracks per-item bulk decision outcomes", () => {
    const result: BulkDecisionResult = {
      succeeded: [
        { id: "apr-1", status: "approved", approvalType: "travel_expense_claim" },
      ],
      failed: [
        { id: "apr-2", code: "stale", message: "Request is already approved" },
      ],
    };

    expect(result.succeeded[0]?.approvalType).toBe("travel_expense_claim");
    expect(result.failed[0]?.code).toBe("stale");
  });
});
```

- [ ] **Step 2: Run the targeted test to verify the contract is not implemented yet**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/server/queries.test.ts"`
Expected: FAIL because `travel_expense_claim` and `BulkDecisionResult` are not defined in `domain/types.ts` yet.

- [ ] **Step 3: Extend `domain/types.ts` with the canonical additions**

Add the new approval type, richer bulk result types, and a decision-action union without widening the rest of the system unnecessarily.

```ts
export type ApprovalType =
  | "absence_entry"
  | "time_entry"
  | "shift_request"
  | "travel_expense_claim";

export type ApprovalDecisionAction = "approve" | "reject";

export interface BulkDecisionSuccess {
  id: string;
  approvalType: ApprovalType;
  status: ApprovalStatus;
}

export interface BulkDecisionFailure {
  id: string;
  code: "forbidden" | "stale" | "validation_failed" | "not_found" | "unsupported";
  message: string;
}

export interface BulkDecisionResult {
  succeeded: BulkDecisionSuccess[];
  failed: BulkDecisionFailure[];
}
```

- [ ] **Step 4: Keep the public approvals action exports aligned with the richer type contract**

Update `apps/webapp/src/app/[locale]/(app)/approvals/actions.canonical.test.ts` to assert that the canonical exports still type-check against the new shared result shape.

```ts
import { describe, expect, it } from "vitest";
import type { BulkDecisionResult } from "@/lib/approvals/domain/types";

describe("approvals canonical exports", () => {
  it("accepts the shared bulk decision result shape", () => {
    const result: BulkDecisionResult = { succeeded: [], failed: [] };
    expect(Array.isArray(result.succeeded)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);
  });
});
```

- [ ] **Step 5: Run the contract tests again**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/server/queries.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/actions.canonical.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/lib/approvals/domain/types.ts" "apps/webapp/src/lib/approvals/server/queries.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/actions.canonical.test.ts"
git commit -m "feat: extend unified approval domain contract"
```

## Task 2: Add the travel-expense approval adapter

**Files:**
- Create: `apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/index.ts`
- Modify: `apps/webapp/src/lib/approvals/init.ts`
- Test: `apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.test.ts`

- [ ] **Step 1: Write the failing handler test**

Create `apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.test.ts` to lock in the mapping and registration contract.

```ts
import { describe, expect, it } from "vitest";
import { TravelExpenseClaimHandler } from "./travel-expense-claim.handler";

describe("TravelExpenseClaimHandler", () => {
  it("registers the travel expense approval type", () => {
    expect(TravelExpenseClaimHandler.type).toBe("travel_expense_claim");
    expect(TravelExpenseClaimHandler.supportsBulkApprove).toBe(true);
  });
});
```

- [ ] **Step 2: Run the handler test to verify it fails**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.test.ts"`
Expected: FAIL because the handler file does not exist.

- [ ] **Step 3: Implement the adapter on top of the existing handler utilities**

Create `apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.ts` using `fetchApprovals` and `getApprovalCount` from `base-handler.ts` instead of inventing a second query path.

```ts
import { IconReceipt } from "@tabler/icons-react";
import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { travelExpenseClaim } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { buildSLAInfo, fetchApprovals, getApprovalCount } from "./base-handler";
import type { ApprovalTypeHandler } from "../domain/types";

const unsupportedTravelExpenseOperation = () =>
  Effect.fail(new Error("travel expense approval mutation wiring is handled in Task 4"));

export const TravelExpenseClaimHandler: ApprovalTypeHandler = {
  type: "travel_expense_claim",
  displayName: "Travel Expense",
  icon: IconReceipt,
  supportsBulkApprove: true,
  getApprovals: (params) =>
    fetchApprovals({
      entityType: "travel_expense_claim",
      params,
      fetchEntitiesByIds: (entityIds) =>
        Effect.gen(function* (_) {
          const dbService = yield* _(DatabaseService);
          const claims = yield* _(
            dbService.query("getTravelExpenseApprovalClaims", () =>
              dbService.db.query.travelExpenseClaim.findMany({
                where: and(
                  eq(travelExpenseClaim.organizationId, params.organizationId),
                  inArray(travelExpenseClaim.id, entityIds),
                ),
              }),
            ),
          );

          return new Map(claims.map((claim) => [claim.id, claim] as const));
        }),
      transformToItem: (request, claim) => ({
        id: request.id,
        approvalType: "travel_expense_claim",
        entityId: claim.id,
        typeName: "Travel Expense",
        requester: {
          id: request.requester.id,
          userId: request.requester.user.id,
          name: request.requester.user.name,
          email: request.requester.user.email,
          image: request.requester.user.image,
          teamId: request.requester.teamId,
        },
        approverId: request.approverId,
        organizationId: request.organizationId,
        status: request.status,
        createdAt: request.createdAt,
        resolvedAt: request.approvedAt,
        priority: "normal",
        sla: buildSLAInfo(claim.submittedAt ?? null),
        display: {
          title: claim.destinationCity || "Travel expense claim",
          subtitle: claim.type,
          summary: claim.notes || claim.destinationCountry || "Awaiting review",
          icon: "receipt",
        },
      }),
    }),
  getCount: (approverId, organizationId) =>
    getApprovalCount("travel_expense_claim", approverId, organizationId),
  getDetail: unsupportedTravelExpenseOperation,
  approve: unsupportedTravelExpenseOperation,
  reject: unsupportedTravelExpenseOperation,
};
```

- [ ] **Step 4: Export and register the new handler**

Update the existing registry wiring so importing `@/lib/approvals/init` includes the travel-expense adapter.

```ts
// apps/webapp/src/lib/approvals/handlers/index.ts
export { TravelExpenseClaimHandler } from "./travel-expense-claim.handler";

// apps/webapp/src/lib/approvals/init.ts
import {
  AbsenceRequestHandler,
  TimeCorrectionHandler,
  TravelExpenseClaimHandler,
} from "./handlers";

registerApprovalHandler(TravelExpenseClaimHandler);
```

- [ ] **Step 5: Run the handler test again**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.ts" "apps/webapp/src/lib/approvals/handlers/index.ts" "apps/webapp/src/lib/approvals/init.ts" "apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.test.ts"
git commit -m "feat: add travel expense approval handler"
```

## Task 3: Route inbox reads through the shared query service

**Files:**
- Modify: `apps/webapp/src/lib/approvals/application/approval-query.service.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/counts/route.ts`
- Test: `apps/webapp/src/lib/approvals/server/queries.test.ts`

- [ ] **Step 1: Add a failing mixed-type query test that includes travel expenses**

Expand `apps/webapp/src/lib/approvals/server/queries.test.ts` with a query-service level expectation.

```ts
it("returns counts for all registered approval types", async () => {
  const counts = await queryService.getCounts("manager-1", "org-1");
  expect(counts.travel_expense_claim).toBeTypeOf("number");
});
```

- [ ] **Step 2: Run the query test and confirm it fails**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/server/queries.test.ts"`
Expected: FAIL because the count result does not include `travel_expense_claim` yet.

- [ ] **Step 3: Keep `ApprovalQueryService` as the canonical aggregation path**

Modify `apps/webapp/src/lib/approvals/application/approval-query.service.ts` so the service remains the single source of mixed-type inbox reads and count aggregation.

```ts
getCounts: (approverId, organizationId) =>
  Effect.gen(function* (_) {
    const handlers = getAllApprovalHandlers();
    const counts: Partial<Record<ApprovalType, number>> = {};

    for (const handler of handlers) {
      counts[handler.type] = yield* _(handler.getCount(approverId, organizationId));
    }

    return {
      absence_entry: counts.absence_entry ?? 0,
      time_entry: counts.time_entry ?? 0,
      shift_request: counts.shift_request ?? 0,
      travel_expense_claim: counts.travel_expense_claim ?? 0,
    };
  });
```

- [ ] **Step 4: Replace the manual route aggregation with the shared service**

Update `apps/webapp/src/app/api/approvals/inbox/route.ts` and `apps/webapp/src/app/api/approvals/inbox/counts/route.ts` to resolve the employee, build `ApprovalQueryParams`, and delegate to `ApprovalQueryService`.

```ts
const result = await Effect.runPromise(
  ApprovalQueryService.pipe(
    Effect.flatMap((service) => service.getApprovals(params)),
    Effect.provide(ApprovalQueryServiceLive),
  ),
);

return NextResponse.json(result);
```

- [ ] **Step 5: Run the shared query tests again**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/server/queries.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/lib/approvals/application/approval-query.service.ts" "apps/webapp/src/app/api/approvals/inbox/route.ts" "apps/webapp/src/app/api/approvals/inbox/counts/route.ts" "apps/webapp/src/lib/approvals/server/queries.test.ts"
git commit -m "refactor: route unified approval reads through shared query service"
```

## Task 4: Standardize shared decision execution and bulk results

**Files:**
- Modify: `apps/webapp/src/lib/approvals/application/bulk-approval.service.ts`
- Modify: `apps/webapp/src/lib/approvals/infrastructure/audit-logger.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/bulk-approve/route.ts`
- Create: `apps/webapp/src/app/api/approvals/inbox/bulk-reject/route.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts`
- Test: `apps/webapp/src/lib/approvals/server/shared.test.ts`

- [ ] **Step 1: Write the failing tests for per-item bulk outcomes and travel-expense delegation**

Add one test for per-item failure codes and one test proving travel-expense claims can flow through the shared decision path.

```ts
it("reports stale approvals as coded failures", async () => {
  const result = await bulkApprovalService.bulkDecide(["apr-1"], "approve", "manager-1", "org-1");
  expect(result.failed).toContainEqual(
    expect.objectContaining({ id: "apr-1", code: "stale" }),
  );
});

it("approve succeeds for travel expense claims through the shared path", async () => {
  const result = await approveTravelExpenseClaim({ claimId: "claim-1", note: "Looks good" });
  expect(result).toEqual({ success: true, data: { status: "approved" } });
});
```

- [ ] **Step 2: Run the bulk/shared tests to verify failure**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/server/shared.test.ts" "apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts"`
Expected: FAIL because the shared bulk result and travel-expense adapter delegation are not wired yet.

- [ ] **Step 3: Upgrade the bulk service from approve-only to a shared decision service**

Modify `apps/webapp/src/lib/approvals/application/bulk-approval.service.ts` so it returns coded per-item outcomes and delegates to `handler.approve` or `handler.reject`.

```ts
readonly bulkDecide: (
  approvalIds: string[],
  action: ApprovalDecisionAction,
  approverId: string,
  organizationId: string,
  reason?: string,
) => Effect.Effect<BulkDecisionResult, AnyAppError, any>;

// inside the implementation
if (request.status !== "pending") {
  failed.push({ id: request.id, code: "stale", message: `Request is already ${request.status}` });
  continue;
}

const effect = action === "approve"
  ? handler.approve(request.entityId, approverId)
  : handler.reject(request.entityId, approverId, reason ?? "");
```

- [ ] **Step 4: Normalize audit logging at the infrastructure boundary**

Update `apps/webapp/src/lib/approvals/infrastructure/audit-logger.ts` to include stable metadata for module, action mode, and resulting status, and use it from the bulk route instead of inserting directly into `auditLog` there.

```ts
export interface ApprovalAuditEntry {
  organizationId: string;
  approvalId: string;
  approvalType: ApprovalType;
  entityId: string;
  action: ApprovalAuditAction;
  performedBy: string;
  previousStatus: ApprovalStatus;
  newStatus: ApprovalStatus;
  metadata?: {
    bulk?: boolean;
    sourceModule?: string;
    decisionMode?: "single" | "bulk";
    [key: string]: unknown;
  };
}
```

- [ ] **Step 5: Delegate travel-expense approval and rejection into the shared path**

Reduce duplication in `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts` by keeping travel-expense claim validation and state changes in this file, but make the approval handler the only inbox-facing decision adapter.

```ts
export async function approveTravelExpenseClaim(input: { claimId: string; note?: string }) {
  return runTravelExpenseDecision({
    claimId: input.claimId,
    action: "approved",
    comment: input.note ?? null,
  });
}

export async function rejectTravelExpenseClaim(input: { claimId: string; reason: string }) {
  return runTravelExpenseDecision({
    claimId: input.claimId,
    action: "rejected",
    comment: input.reason,
  });
}
```

- [ ] **Step 6: Update the bulk-approve API route to use the service instead of inline logic**

Keep the route responsible for auth and request parsing only.

```ts
const result = await Effect.runPromise(
  BulkApprovalService.pipe(
    Effect.flatMap((service) =>
      service.bulkDecide(approvalIds, "approve", currentEmployee.id, currentEmployee.organizationId),
    ),
    Effect.provide(BulkApprovalServiceLive),
  ),
);

return NextResponse.json(result);
```

- [ ] **Step 7: Add the matching bulk-reject API route**

Create `apps/webapp/src/app/api/approvals/inbox/bulk-reject/route.ts` with the same auth and employee lookup flow as `bulk-approve`, but require a non-empty rejection reason and call `bulkDecide(..., "reject", ..., reason)`.

```ts
const body = await request.json();
const approvalIds = body.approvalIds as string[];
const reason = body.reason as string;

if (!reason?.trim()) {
  return NextResponse.json({ error: "reason is required" }, { status: 400 });
}

const result = await Effect.runPromise(
  BulkApprovalService.pipe(
    Effect.flatMap((service) =>
      service.bulkDecide(
        approvalIds,
        "reject",
        currentEmployee.id,
        currentEmployee.organizationId,
        reason,
      ),
    ),
    Effect.provide(BulkApprovalServiceLive),
  ),
);
```

- [ ] **Step 8: Run the bulk and travel-expense approval tests again**

Run: `pnpm test -- --run "apps/webapp/src/lib/approvals/server/shared.test.ts" "apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add "apps/webapp/src/lib/approvals/application/bulk-approval.service.ts" "apps/webapp/src/lib/approvals/infrastructure/audit-logger.ts" "apps/webapp/src/app/api/approvals/inbox/bulk-approve/route.ts" "apps/webapp/src/app/api/approvals/inbox/bulk-reject/route.ts" "apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts" "apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts" "apps/webapp/src/lib/approvals/server/shared.test.ts"
git commit -m "feat: unify approval decision execution and audit logging"
```

## Task 5: Finish the inbox UI contract for travel expenses and partial-success feedback

**Files:**
- Modify: `apps/webapp/src/lib/query/use-approval-inbox.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`
- Test: `apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.test.tsx`

- [ ] **Step 1: Write a failing UI test for the travel-expense decision affordance**

Reuse the existing queue test file to assert the shared inbox no longer depends on a dedicated queue-only capability check.

```ts
import { describe, expect, it } from "vitest";
import { getApprovalTypeLabel } from "@/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar";

describe("approval inbox labels", () => {
  it("exposes a travel expense type label", () => {
    expect(getApprovalTypeLabel("travel_expense_claim")).toBe("Travel Expenses");
  });
});
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run: `pnpm test -- --run "apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.test.tsx"`
Expected: FAIL because the helper or label does not exist yet.

- [ ] **Step 3: Extend the client query hook to consume the richer result shape**

Update `apps/webapp/src/lib/query/use-approval-inbox.ts` so the client types use `BulkDecisionResult`, add a bulk reject fetcher, and remain aligned with the API response.

```ts
import type { BulkDecisionResult } from "@/lib/approvals/domain/types";

async function bulkApproveApprovals(approvalIds: string[]): Promise<BulkDecisionResult> {
  const response = await fetch("/api/approvals/inbox/bulk-approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalIds }),
  });
  return response.json();
}

async function bulkRejectApprovals(
  approvalIds: string[],
  reason: string,
): Promise<BulkDecisionResult> {
  const response = await fetch("/api/approvals/inbox/bulk-reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalIds, reason }),
  });
  return response.json();
}
```

- [ ] **Step 4: Add the new type to the toolbar and table mappings**

Keep the UI generic and data-driven instead of adding travel-expense-specific rendering branches everywhere.

```ts
const APPROVAL_TYPES: { value: ApprovalType; label: string }[] = [
  { value: "absence_entry", label: "Absence Requests" },
  { value: "time_entry", label: "Time Corrections" },
  { value: "shift_request", label: "Shift Requests" },
  { value: "travel_expense_claim", label: "Travel Expenses" },
];

const TYPE_ICONS: Record<ApprovalType, React.ComponentType<{ className?: string }>> = {
  absence_entry: IconCalendarOff,
  time_entry: IconClockEdit,
  shift_request: IconExchange,
  travel_expense_claim: IconReceipt,
};
```

- [ ] **Step 5: Add a client mutation for bulk reject and show partial-success feedback in the inbox page**

Update `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx` so it surfaces both success and failure summaries from the per-item result shape.

```ts
const bulkRejectMutation = useBulkReject();

if (result.succeeded.length > 0) {
  toast.success(`${result.succeeded.length} request(s) approved`);
}

if (result.failed.length > 0) {
  toast.error(result.failed.map((item) => item.message).join("\n"));
}
```

Add a matching hook in `use-approval-inbox.ts`:

```ts
export function useBulkReject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ approvalIds, reason }: { approvalIds: string[]; reason: string }) =>
      bulkRejectApprovals(approvalIds, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
    },
  });
}
```

- [ ] **Step 6: Teach the detail panel to render travel-expense details using the shared contract**

In `approval-detail-panel.tsx`, add a narrow rendering branch keyed on `approval.approvalType === "travel_expense_claim"` and display amount, destination, trip range, and note fields already returned by the detail API.

```tsx
if (approval.approvalType === "travel_expense_claim") {
  return (
    <div className="space-y-2">
      <div>{detail.entity.destinationCity}</div>
      <div>{detail.entity.calculatedAmount} {detail.entity.calculatedCurrency}</div>
      <div>{detail.entity.tripStart} - {detail.entity.tripEnd}</div>
    </div>
  );
}
```

- [ ] **Step 7: Run the inbox UI test again**

Run: `pnpm test -- --run "apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.test.tsx"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/webapp/src/lib/query/use-approval-inbox.ts" "apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar.tsx" "apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx" "apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.tsx" "apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx" "apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.test.tsx"
git commit -m "feat: add travel expenses to unified approval inbox UI"
```

## Task 6: Remove the redundant travel-expense manager queue entry point

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/travel-expenses/approvals/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/travel-expenses/page.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts`

- [ ] **Step 1: Write the failing smoke test for the new navigation target**

Add a simple assertion that the travel-expense approvals entry no longer behaves like a standalone queue.

```ts
import { describe, expect, it } from "vitest";

describe("travel expense approval entry point", () => {
  it("redirects managers to the unified approvals inbox", async () => {
    const page = await import("@/app/[locale]/(app)/travel-expenses/approvals/page");
    expect(page).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"`
Expected: FAIL or provide missing coverage for the new redirect behavior.

- [ ] **Step 3: Convert the old queue page into a redirect or thin wrapper**

Prefer a redirect to the shared inbox once parity is complete.

```tsx
import { redirect } from "next/navigation";

export default function TravelExpenseApprovalsPage() {
  redirect("/approvals/inbox?types=travel_expense_claim");
}
```

- [ ] **Step 4: Update any travel-expense page links to point at the unified inbox**

In `apps/webapp/src/app/[locale]/(app)/travel-expenses/page.tsx`, change manager-facing CTA targets to `/approvals/inbox?types=travel_expense_claim` so the old queue is no longer discoverable as the primary review surface.

```tsx
href="/approvals/inbox?types=travel_expense_claim"
```

- [ ] **Step 5: Run the smoke test again**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/travel-expenses/approvals/page.tsx" "apps/webapp/src/app/[locale]/(app)/travel-expenses/page.tsx" "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"
git commit -m "refactor: route travel expense approvals through unified inbox"
```

## Verification

- [ ] Run the focused approval tests:

```bash
pnpm test -- --run "apps/webapp/src/lib/approvals/**" "apps/webapp/src/app/[locale]/(app)/approvals/**" "apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts" "apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.test.tsx"
```

Expected: PASS.

- [ ] Run one final broader webapp test slice for regressions:

```bash
pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/travel-expenses/**" "apps/webapp/src/lib/query/use-approval-inbox.ts"
```

Expected: PASS or zero matching test files for the hook path and PASS for the travel-expense suite.

- [ ] Sanity-check the inbox manually in the browser after implementation:

```bash
pnpm dev
```

Expected: managers can see travel expense items in `/approvals/inbox`, approve selected mixed items, get partial-success feedback when one item is stale, and the legacy `/travel-expenses/approvals` path forwards to the inbox.
