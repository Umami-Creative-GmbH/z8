# Platform Admin Billing Seat Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show licensed seats, used seats, demo users, and a row-level Stripe seat sync action in `/platform-admin/billing`.

**Architecture:** Keep the billing page server-rendered for table data and add a small client row action for on-demand sync. Share the billable-seat definition with `SeatSyncService` by using the same approved non-demo member rule in table aggregation and by calling `syncSeatsForOrganization` from a platform-admin-only server action.

**Tech Stack:** Next.js App Router, React client component, Drizzle ORM, Effect services, Better Auth session checks, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/page.tsx`: add seat aggregations, columns, and sync action column.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/actions.ts`: server action for row-level seat sync with billing/admin guards.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/sync-seats-button.tsx`: client button with `IconRefresh`, pending state, and `router.refresh()` on success.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/page.test.ts`: source-level regression tests for labels/action wiring.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/actions.test.ts`: tests for disabled billing, auth/admin guards, and successful sync.

---

### Task 1: Add Admin Billing Sync Action

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/actions.test.ts`

- [ ] **Step 1: Write failing action tests**

Create tests covering:

```ts
it("rejects sync when billing is disabled", async () => {
	vi.stubEnv("BILLING_ENABLED", "false");
	const result = await syncOrganizationSeatsAction("org-1");
	expect(result).toEqual({ success: false, error: "Billing is disabled" });
});

it("rejects non-admin sessions", async () => {
	vi.stubEnv("BILLING_ENABLED", "true");
	getSessionMock.mockResolvedValue({ user: { role: "user" } });
	const result = await syncOrganizationSeatsAction("org-1");
	expect(result.success).toBe(false);
});

it("syncs the requested organization for platform admins", async () => {
	vi.stubEnv("BILLING_ENABLED", "true");
	getSessionMock.mockResolvedValue({ user: { role: "admin" } });
	syncSeatsForOrganizationMock.mockResolvedValue(7);
	const result = await syncOrganizationSeatsAction("org-1");
	expect(syncSeatsForOrganizationMock).toHaveBeenCalledWith("org-1");
	expect(result).toEqual({ success: true, seats: 7 });
});
```

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest run 'src/app/[locale]/(admin)/platform-admin/billing/actions.test.ts'`

Expected: fails because `actions.ts` does not exist.

- [ ] **Step 3: Implement action**

Create `syncOrganizationSeatsAction(organizationId: string)` with `'use server'`, `BILLING_ENABLED` guard, `auth.api.getSession({ headers: await headers() })`, platform admin role check, and Effect layer call to `SeatSyncService.syncSeatsForOrganization(organizationId)`.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run 'src/app/[locale]/(admin)/platform-admin/billing/actions.test.ts'`

Expected: tests pass.

---

### Task 2: Add Sync Button Client Component

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/sync-seats-button.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/page.test.ts`

- [ ] **Step 1: Add source-level test expectations**

Extend `page.test.ts` to assert page source imports/uses `SyncSeatsButton`, and button source uses `IconRefresh`, `syncOrganizationSeatsAction`, and `router.refresh()`.

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest run 'src/app/[locale]/(admin)/platform-admin/billing/page.test.ts'`

Expected: fails until component and wiring exist.

- [ ] **Step 3: Implement component**

Create a client component with props `{ organizationId: string; organizationName: string }`, a pending state via `useTransition`, `IconRefresh`, accessible label, calls `syncOrganizationSeatsAction`, and refreshes router on success.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run 'src/app/[locale]/(admin)/platform-admin/billing/page.test.ts'`

Expected: tests pass.

---

### Task 3: Add Seat Columns To Billing Table

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/page.test.ts`

- [ ] **Step 1: Add failing label/query tests**

Extend `page.test.ts` to assert translated labels for `Licensed seats`, `Used seats`, `Demo users`, and sync action text are present through `t(...)` calls.

- [ ] **Step 2: Run red test**

Run: `pnpm vitest run 'src/app/[locale]/(admin)/platform-admin/billing/page.test.ts'`

Expected: fails before table columns are added.

- [ ] **Step 3: Implement table data and columns**

In `page.tsx`, import `and`, `count`, `eq`, `notLike`, `sql` or equivalent Drizzle helpers plus `member` and `user`. Aggregate per organization:

```ts
usedSeats: count approved members where email not like "%@demo.invalid"
demoUsers: count members where email like "%@demo.invalid"
```

Render columns `Licensed seats`, `Used seats`, `Demo users`, and an action column containing `<SyncSeatsButton organizationId={sub.organizationId} organizationName={orgName} />`.

- [ ] **Step 4: Run green test**

Run: `pnpm vitest run 'src/app/[locale]/(admin)/platform-admin/billing/page.test.ts'`

Expected: tests pass.

---

### Task 4: Focused Verification

**Files:**
- No planned edits.

- [ ] **Step 1: Run admin billing tests**

Run: `pnpm vitest run 'src/app/[locale]/(admin)/platform-admin/billing/page.test.ts' 'src/app/[locale]/(admin)/platform-admin/billing/actions.test.ts'`

Expected: all tests pass.

- [ ] **Step 2: Run billing reconciliation tests**

Run: `pnpm vitest run src/lib/effect/services/billing/seat-sync.service.test.ts src/lib/jobs/billing-seat-reconciliation.test.ts src/lib/cron/registry.test.ts src/lib/auth.test.ts src/lib/effect/services/invite-code.service.test.ts`

Expected: all tests pass.

- [ ] **Step 3: Run build if feasible**

Run: `CI=true pnpm build`

Expected: current known blocker may remain `mobile:build: Favicon source file in Expo config (web.favicon) does not exist: ./assets/favicon.png`; report it if still present.

---

## Self-Review

- Spec coverage: table columns, demo/used count distinction, row-level refresh action, billing/admin guards, and focused tests are covered.
- Placeholder scan: no placeholders remain.
- Type consistency: `syncOrganizationSeatsAction`, `SyncSeatsButton`, `Licensed seats`, `Used seats`, and `Demo users` are named consistently.
