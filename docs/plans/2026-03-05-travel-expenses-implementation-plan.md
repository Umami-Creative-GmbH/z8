# Travel Expenses Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a first-class Travel Expenses module where employees submit receipt/mileage/per-diem claims and managers approve or reject them end-to-end.

**Architecture:** Add a dedicated travel-expenses domain (schema + server actions + UI routes) with strict organization scoping. Keep calculations deterministic on the server (policy-based mileage/per-diem), and model claim lifecycle explicitly (`draft -> submitted -> approved|rejected`). Integrate with existing app shell (sidebar, settings, i18n, query keys) without coupling travel flows into time-tracking internals.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, TanStack Query, TanStack Form, Luxon, Vitest, Tolgee i18n, Uppy/TUS + S3.

---

### Task 1: Add Travel Expense Schema + Enums

**Files:**
- Create: `apps/webapp/src/db/schema/travel-expense.ts`
- Modify: `apps/webapp/src/db/schema/enums.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Test: `apps/webapp/src/db/schema/__tests__/travel-expense-schema.test.ts`

**Step 1: Write the failing schema test**

```ts
import { describe, expect, test } from "vitest";
import {
  travelExpenseClaim,
  travelExpenseAttachment,
  travelExpensePolicy,
  travelExpenseDecisionLog,
} from "../travel-expense";

describe("travel-expense schema", () => {
  test("exports claim and supporting tables", () => {
    expect(travelExpenseClaim).toBeDefined();
    expect(travelExpenseAttachment).toBeDefined();
    expect(travelExpensePolicy).toBeDefined();
    expect(travelExpenseDecisionLog).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/travel-expense-schema.test.ts`
Expected: FAIL with module-not-found for `travel-expense.ts`.

**Step 3: Write minimal schema implementation**

```ts
// enums.ts
export const travelExpenseTypeEnum = pgEnum("travel_expense_type", ["receipt", "mileage", "per_diem"]);
export const travelExpenseStatusEnum = pgEnum("travel_expense_status", ["draft", "submitted", "approved", "rejected"]);

// travel-expense.ts (core columns)
export const travelExpenseClaim = pgTable("travel_expense_claim", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
  approverId: uuid("approver_id").references(() => employee.id),
  type: travelExpenseTypeEnum("type").notNull(),
  status: travelExpenseStatusEnum("status").default("draft").notNull(),
  projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/travel-expense-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/db/schema/enums.ts apps/webapp/src/db/schema/travel-expense.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/__tests__/travel-expense-schema.test.ts
git commit -m "feat(travel-expenses): add core schema and enums"
```

### Task 2: Add Calculation/Validation Domain (TDD)

**Files:**
- Create: `apps/webapp/src/lib/travel-expenses/types.ts`
- Create: `apps/webapp/src/lib/travel-expenses/claim-validation.ts`
- Create: `apps/webapp/src/lib/travel-expenses/policy-calculator.ts`
- Test: `apps/webapp/src/lib/travel-expenses/__tests__/policy-calculator.test.ts`
- Test: `apps/webapp/src/lib/travel-expenses/__tests__/claim-validation.test.ts`

**Step 1: Write failing calculator tests**

```ts
it("calculates mileage amount from configured rate", () => {
  expect(calculateMileageAmount({ kilometers: 120, ratePerKm: 0.42 })).toBe(50.4);
});

it("calculates per diem from trip day count and daily rate", () => {
  expect(calculatePerDiemAmount({ dayCount: 3, dailyRate: 28 })).toBe(84);
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test -- src/lib/travel-expenses/__tests__/policy-calculator.test.ts`
Expected: FAIL (`calculateMileageAmount` not defined).

**Step 3: Implement minimal calculators + validators**

```ts
export function calculateMileageAmount(input: { kilometers: number; ratePerKm: number }): number {
  return Math.round(input.kilometers * input.ratePerKm * 100) / 100;
}

export function validateReceiptClaim(input: { amount: number; attachmentsCount: number }) {
  if (input.attachmentsCount < 1) throw new Error("Receipt attachment required");
  if (input.amount <= 0) throw new Error("Amount must be positive");
}
```

**Step 4: Run focused domain tests**

Run: `pnpm --filter webapp test -- src/lib/travel-expenses/__tests__/policy-calculator.test.ts src/lib/travel-expenses/__tests__/claim-validation.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/travel-expenses
git commit -m "feat(travel-expenses): add claim validation and policy calculators"
```

### Task 3: Implement Employee Claim Actions (Draft/List/Submit)

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.claims.test.ts`
- Modify: `apps/webapp/src/lib/query/keys.ts`
- Modify: `apps/webapp/src/lib/audit-logger.ts`

**Step 1: Write failing server-action tests**

```ts
it("submits claim and resolves approver to manager", async () => {
  const result = await submitTravelExpenseClaim({ claimId: "c1" });
  expect(result.success).toBe(true);
  expect(result.data?.status).toBe("submitted");
});

it("rejects submit for receipt claim without attachment", async () => {
  const result = await submitTravelExpenseClaim({ claimId: "c-no-attachment" });
  expect(result.success).toBe(false);
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/travel-expenses/actions.claims.test.ts`
Expected: FAIL (actions missing).

**Step 3: Implement minimal actions**

```ts
export async function getMyTravelExpenseClaims(): Promise<ServerActionResult<TravelExpenseClaimRow[]>> { /* org + employee scoped */ }
export async function createTravelExpenseDraft(input: CreateTravelExpenseDraftInput): Promise<ServerActionResult<{ id: string }>> { /* draft */ }
export async function submitTravelExpenseClaim(input: { claimId: string }): Promise<ServerActionResult<{ status: "submitted" }>> {
  // validate claim type, required attachment for receipt, manager/admin approver resolution
}
```

**Step 4: Run test and ensure pass**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/travel-expenses/actions.claims.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.claims.test.ts apps/webapp/src/lib/query/keys.ts apps/webapp/src/lib/audit-logger.ts
git commit -m "feat(travel-expenses): add employee claim actions"
```

### Task 4: Implement Approval Actions (Manager/Admin)

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts`

**Step 1: Write failing approval tests**

```ts
it("allows manager to approve submitted claim", async () => {
  const result = await approveTravelExpenseClaim({ claimId: "c1", note: "OK" });
  expect(result.success).toBe(true);
});

it("prevents non-approver from deciding claim", async () => {
  const result = await rejectTravelExpenseClaim({ claimId: "c1", reason: "invalid" });
  expect(result.success).toBe(false);
});
```

**Step 2: Run approval tests to confirm failure**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts`
Expected: FAIL.

**Step 3: Implement decision actions + decision log writes**

```ts
export async function getTravelExpenseApprovalQueue(): Promise<ServerActionResult<TravelExpenseApprovalItem[]>> { /* manager/admin scoped */ }
export async function approveTravelExpenseClaim(input: { claimId: string; note?: string }) { /* submitted -> approved */ }
export async function rejectTravelExpenseClaim(input: { claimId: string; reason: string }) { /* submitted -> rejected */ }
```

**Step 4: Run approval test suite**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts
git commit -m "feat(travel-expenses): add manager approval and rejection actions"
```

### Task 5: Implement Policy Settings Actions (Mileage + Per Diem)

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/actions.test.ts`

**Step 1: Write failing policy action tests**

```ts
it("creates organization-scoped travel policy", async () => {
  const result = await upsertTravelExpensePolicy({ mileageRatePerKm: 0.42, perDiemDailyRate: 28 });
  expect(result.success).toBe(true);
});
```

**Step 2: Run tests and verify failure**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/travel-expenses/actions.test.ts`
Expected: FAIL.

**Step 3: Implement admin-only policy CRUD actions**

```ts
export async function getTravelExpensePolicies() { /* admin + org scoped */ }
export async function upsertTravelExpensePolicy(input: UpsertTravelExpensePolicyInput) { /* active/effective policy */ }
```

**Step 4: Run policy action tests**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/travel-expenses/actions.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/actions.ts apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/actions.test.ts
git commit -m "feat(travel-expenses): add admin policy actions"
```

### Task 6: Add Receipt Attachment Upload Processing

**Files:**
- Create: `apps/webapp/src/app/api/upload/travel-expense/process/route.ts`
- Create: `apps/webapp/src/lib/query/use-travel-expense-file-process.ts`
- Create: `apps/webapp/src/hooks/use-travel-expense-file-upload.ts`
- Test: `apps/webapp/src/lib/travel-expenses/__tests__/attachment-validation.test.ts`

**Step 1: Write failing attachment validation test**

```ts
it("accepts image/pdf receipts and rejects executable files", async () => {
  expect(isAllowedTravelExpenseMime("application/pdf")).toBe(true);
  expect(isAllowedTravelExpenseMime("image/png")).toBe(true);
  expect(isAllowedTravelExpenseMime("application/x-msdownload")).toBe(false);
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter webapp test -- src/lib/travel-expenses/__tests__/attachment-validation.test.ts`
Expected: FAIL.

**Step 3: Implement processing route + client mutation/hook**

```ts
// route.ts
type UploadType = "travel-expense-receipt";
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

// use-travel-expense-file-upload.ts
// Uppy + TUS upload, then POST to /api/upload/travel-expense/process
```

**Step 4: Run focused tests**

Run: `pnpm --filter webapp test -- src/lib/travel-expenses/__tests__/attachment-validation.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/api/upload/travel-expense/process/route.ts apps/webapp/src/lib/query/use-travel-expense-file-process.ts apps/webapp/src/hooks/use-travel-expense-file-upload.ts apps/webapp/src/lib/travel-expenses/__tests__/attachment-validation.test.ts
git commit -m "feat(travel-expenses): add secure receipt upload processing"
```

### Task 7: Build Employee Travel Expenses UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/travel-expenses/page.tsx`
- Create: `apps/webapp/src/components/travel-expenses/travel-expense-management.tsx`
- Create: `apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.tsx`
- Create: `apps/webapp/src/components/travel-expenses/travel-expense-list.tsx`
- Test: `apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.test.tsx`

**Step 1: Write failing UI test for claim form behavior**

```tsx
it("requires attachment when type is receipt", async () => {
  render(<TravelExpenseClaimDialog open organizationId="org-1" />);
  // select receipt type, submit without attachment
  expect(await screen.findByText(/attachment required/i)).toBeInTheDocument();
});
```

**Step 2: Run UI test and confirm failure**

Run: `pnpm --filter webapp test -- src/components/travel-expenses/travel-expense-claim-dialog.test.tsx`
Expected: FAIL.

**Step 3: Implement UI with TanStack Form**

```tsx
const form = useForm({
  defaultValues: { type: "receipt" as const, currency: "EUR", amount: 0, projectId: "" },
  onSubmit: async ({ value }) => { /* create draft or submit */ },
});
```

Use `TFormItem`, `TFormLabel`, `TFormControl`, `TFormMessage` from `apps/webapp/src/components/ui/tanstack-form.tsx`.

**Step 4: Run UI test and pass**

Run: `pnpm --filter webapp test -- src/components/travel-expenses/travel-expense-claim-dialog.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/travel-expenses/page.tsx apps/webapp/src/components/travel-expenses/travel-expense-management.tsx apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.tsx apps/webapp/src/components/travel-expenses/travel-expense-list.tsx apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.test.tsx
git commit -m "feat(travel-expenses): add employee claim list and form"
```

### Task 8: Build Manager Approval Queue UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/travel-expenses/approvals/page.tsx`
- Create: `apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.tsx`
- Create: `apps/webapp/src/components/travel-expenses/travel-expense-decision-dialog.tsx`
- Test: `apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.test.tsx`

**Step 1: Write failing approval queue test**

```tsx
it("renders submitted claims and triggers approve action", async () => {
  render(<TravelExpenseApprovalQueue organizationId="org-1" />);
  expect(await screen.findByText(/submitted/i)).toBeInTheDocument();
});
```

**Step 2: Run queue test and verify failure**

Run: `pnpm --filter webapp test -- src/components/travel-expenses/travel-expense-approval-queue.test.tsx`
Expected: FAIL.

**Step 3: Implement queue + decision UI**

```tsx
// list submitted claims assigned to manager/admin
// approve/reject with reason; invalidate queryKeys.travelExpenses.approvals(...)
```

**Step 4: Run queue test and pass**

Run: `pnpm --filter webapp test -- src/components/travel-expenses/travel-expense-approval-queue.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/travel-expenses/approvals/page.tsx apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.tsx apps/webapp/src/components/travel-expenses/travel-expense-decision-dialog.tsx apps/webapp/src/components/travel-expenses/travel-expense-approval-queue.test.tsx
git commit -m "feat(travel-expenses): add manager approval queue"
```

### Task 9: Build Admin Policy Settings UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/page.tsx`
- Create: `apps/webapp/src/components/settings/travel-expense-policy-management.tsx`
- Create: `apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx`
- Test: `apps/webapp/src/components/settings/travel-expense-policy-dialog.test.tsx`

**Step 1: Write failing settings form test**

```tsx
it("saves mileage and per-diem rates", async () => {
  render(<TravelExpensePolicyDialog open organizationId="org-1" />);
  // fill rates and submit
  expect(await screen.findByText(/policy updated/i)).toBeInTheDocument();
});
```

**Step 2: Run test and confirm failure**

Run: `pnpm --filter webapp test -- src/components/settings/travel-expense-policy-dialog.test.tsx`
Expected: FAIL.

**Step 3: Implement admin settings UI and hooks**

```tsx
// settings page (admin only)
// tanstack form with effectiveFrom, mileageRatePerKm, perDiemDailyRate
```

**Step 4: Run test to green**

Run: `pnpm --filter webapp test -- src/components/settings/travel-expense-policy-dialog.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/page.tsx apps/webapp/src/components/settings/travel-expense-policy-management.tsx apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx apps/webapp/src/components/settings/travel-expense-policy-dialog.test.tsx
git commit -m "feat(travel-expenses): add policy settings UI"
```

### Task 10: Integrate Navigation, Settings Entry, i18n, and Route Namespaces

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/components/site-header.tsx`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/components/settings/settings-icons.ts`
- Modify: `apps/webapp/src/tolgee/shared.ts`
- Modify: `apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts`
- Modify: `apps/webapp/messages/common/en.json`
- Modify: `apps/webapp/messages/common/de.json`
- Modify: `apps/webapp/messages/common/fr.json`
- Modify: `apps/webapp/messages/common/es.json`
- Modify: `apps/webapp/messages/common/it.json`
- Modify: `apps/webapp/messages/common/pt.json`
- Modify: `apps/webapp/messages/settings/en.json`
- Modify: `apps/webapp/messages/settings/de.json`
- Modify: `apps/webapp/messages/settings/fr.json`
- Modify: `apps/webapp/messages/settings/es.json`
- Modify: `apps/webapp/messages/settings/it.json`
- Modify: `apps/webapp/messages/settings/pt.json`

**Step 1: Write failing namespace mapping test**

```ts
it("loads common+settings namespaces for /travel-expenses", () => {
  expect(getNamespacesForRoute("/travel-expenses")).toEqual(["common", "settings"]);
});
```

**Step 2: Run test and verify failure**

Run: `pnpm --filter webapp test -- src/tolgee/__tests__/shared-route-namespaces.test.ts`
Expected: FAIL.

**Step 3: Implement nav + title + settings card + i18n keys**

```ts
// app-sidebar.tsx: add nav item { title: t("nav.travel-expenses"), url: "/travel-expenses" }
// site-header.tsx: map /travel-expenses to settings.travelExpenses.title (or common key)
// settings-config.ts: add "travel-expenses" settings entry under administration
```

**Step 4: Run namespace and smoke tests**

Run: `pnpm --filter webapp test -- src/tolgee/__tests__/shared-route-namespaces.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/site-header.tsx apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-icons.ts apps/webapp/src/tolgee/shared.ts apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts apps/webapp/messages/common apps/webapp/messages/settings
git commit -m "feat(travel-expenses): wire navigation and translations"
```

### Task 11: DB Push, Full Validation, and Quality Gates

**Files:**
- Modify (if needed): `docs/plans/2026-03-05-travel-expenses-implementation-plan.md` (notes only)

**Step 1: Push schema changes**

Run: `pnpm --filter webapp drizzle-kit push`
Expected: DB schema updated with travel expense tables/enums/indexes.

**Step 2: Run targeted new test suites**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/travel-expense-schema.test.ts src/lib/travel-expenses/__tests__/policy-calculator.test.ts src/lib/travel-expenses/__tests__/claim-validation.test.ts src/app/[locale]/(app)/travel-expenses/actions.claims.test.ts src/app/[locale]/(app)/travel-expenses/actions.approvals.test.ts src/app/[locale]/(app)/settings/travel-expenses/actions.test.ts src/components/travel-expenses/travel-expense-claim-dialog.test.tsx src/components/travel-expenses/travel-expense-approval-queue.test.tsx src/components/settings/travel-expense-policy-dialog.test.tsx`
Expected: PASS.

**Step 3: Run full webapp tests and build**

Run: `pnpm --filter webapp test && pnpm --filter webapp build`
Expected: PASS.

**Step 4: Run required quality review skills before merge**

- `@vercel-react-best-practices`: verify render/data-fetch patterns and bundle impact.
- `@web-design-guidelines`: verify accessibility, labels, contrast, keyboard behavior.
- `@vercel-composition-patterns`: verify component API design and avoid boolean-prop explosion.

Expected: no blocking findings (or findings addressed before merge).

**Step 5: Final commit (if any follow-up fixes)**

```bash
git add -A
git commit -m "chore(travel-expenses): finalize validation fixes"
```
