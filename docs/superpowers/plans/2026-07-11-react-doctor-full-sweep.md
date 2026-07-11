# React Doctor Full Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 41 supplied React Doctor diagnostics without suppressions or behavior regressions.

**Architecture:** Keep the existing public behavior while extracting cohesive UI regions and controller hooks from oversized components. Replace only state that mirrors other local inputs, use explicit navigation capabilities, and make date display locale and timezone explicit according to each value's domain meaning.

**Tech Stack:** React 19, Next.js 16, TypeScript, Vitest, TanStack Query/Form, Temporal, React Doctor.

---

### Task 1: Remove Calendar Derived-State Root Cause

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx:80-201`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Write a failing calendar reset test**

Render `CalendarView` with `initialDateKey="2026-01-01"`, rerender with `initialDateKey="2026-02-01"`, and assert `useCalendarData` receives February exactly once after the rerender. This records the reset behavior without the current effect's intermediate old-month render.

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run: `pnpm --dir apps/webapp test src/components/calendar/calendar-view.test.tsx`

Expected: the new test fails before the keyed reset implementation is present.

- [ ] **Step 3: Replace the effect reset with a keyed calendar instance**

Make exported `CalendarView` render an internal `CalendarViewContent`, keyed by normalized initial date/timezone inputs. Move the existing implementation into `CalendarViewContent`, delete the `useEffect` at `calendar-view.tsx:199-201`, and retain the lazy `useState` initializer so interactive range navigation still owns `currentDateKey`. This keeps reset behavior for every direct component consumer.

- [ ] **Step 4: Verify the test, typecheck, and both reports**

Run: `pnpm --dir apps/webapp test src/components/calendar/calendar-view.test.tsx && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

Expected: the test and typecheck pass; both `react-doctor/no-derived-state` and `react-hooks-js/set-state-in-effect` no longer report the calendar line.

- [ ] **Step 5: Commit the root-cause fix**

```bash
git add apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
git commit -m "fix(calendar): remove derived date reset state"
```

### Task 2: Stabilize Payroll Export Initial Selection

**Files:**
- Modify: `apps/webapp/src/components/settings/payroll-export/export-form.tsx:103-113`
- Test: `apps/webapp/src/components/settings/payroll-export/export-form.test.tsx`

- [ ] **Step 1: Write failing rerender cases**

Add tests for: a configured `config.formatId` becoming available after rerender; an explicit user format selection winning over the config; and an unavailable selected format falling back to the first configured format in the submitted export payload.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --dir apps/webapp test src/components/settings/payroll-export/export-form.test.tsx`

Expected: the new prop-change case fails because `requestedFormatId` was captured on the initial render.

- [ ] **Step 3: Store only a user override**

Change `requestedFormatId` to `string | null` initialized to `null`. During render derive `selectedFormatId` in this order: configured user override, configured `config.formatId`, then `firstConfiguredFormatId`. The select handler must set the explicit override. Keep `filterOptions` state and its fetch effect unchanged because it is server-loaded data, not derived state.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/settings/payroll-export/export-form.test.tsx && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add apps/webapp/src/components/settings/payroll-export/export-form.tsx apps/webapp/src/components/settings/payroll-export/export-form.test.tsx
git commit -m "fix(payroll): derive export format from current config"
```

### Task 3: Replace Sidebar Navigation Booleans

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx:40-88`
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx`
- Test: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Write a failing capability-object test**

Replace direct `show*` prop setup in sidebar tests with one `navigationCapabilities` object. Assert payroll, compliance, works council, platform admin, and scheduling visibility each follow their named capability.

- [ ] **Step 2: Run the sidebar test and verify the API failure**

Run: `pnpm --dir apps/webapp test src/components/app-sidebar.test.tsx`

Expected: TypeScript/test setup fails until `AppSidebar` accepts the new object.

- [ ] **Step 3: Introduce the explicit input**

Define `NavigationCapabilities` with `scheduling`, `compliance`, `payroll`, `worksCouncil`, and `platformAdmin`. Replace the five `show*`/`shiftsEnabled` props in `AppSidebarProps` with this object; map its fields to existing navigation arrays and flattened app-search input. Update server/layout callers without changing their authorization decisions.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/app-sidebar.test.tsx && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx 'apps/webapp/src/app/[locale]/(app)/layout.tsx' apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "refactor(sidebar): group navigation capabilities"
```

### Task 4: Apply Mechanical Hygiene Fixes

**Files:**
- Modify: `apps/webapp/src/components/ui/time-input.tsx`
- Modify: `apps/webapp/src/components/font-size-preference.tsx`
- Create: `apps/webapp/src/components/calendar/year-calendar-events.ts`
- Modify: `apps/webapp/src/components/calendar/year-calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/year-calendar-view.test.tsx`

- [ ] **Step 1: Add the failing utility import test**

Move the year-event grouping expectation in `year-calendar-view.test.tsx` to import `groupYearCalendarEventsByDate` from `year-calendar-events.ts`; the test must fail while that module does not exist.

- [ ] **Step 2: Run the focused tests**

Run: `pnpm --dir apps/webapp test src/components/ui/time-input.test.tsx src/components/font-size-preference.test.tsx src/components/calendar/year-calendar-view.test.tsx`

Expected: the new year-event import fails; existing time-input and font-size tests pass as behavior baselines.

- [ ] **Step 3: Make the local, behavior-preserving moves**

Delete `flushSync` around `TimepickerUI` change emission. Move `setFontSize` to module scope. Move `groupYearCalendarEventsByDate` into `year-calendar-events.ts`, importing any needed calendar types and using the same event-local/logical-date behavior.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/ui/time-input.test.tsx src/components/font-size-preference.test.tsx src/components/calendar/year-calendar-view.test.tsx && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add apps/webapp/src/components/ui/time-input.tsx apps/webapp/src/components/font-size-preference.tsx apps/webapp/src/components/calendar/year-calendar-events.ts apps/webapp/src/components/calendar/year-calendar-view.tsx apps/webapp/src/components/calendar/year-calendar-view.test.tsx
git commit -m "refactor(react): remove imperative render warnings"
```

### Task 5: Make Locale Formatting Explicit

**Files:**
- Modify: `apps/webapp/src/components/compliance/compliance-alert-banner.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/domain-verification-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/holiday/holiday-import-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/holiday/assignment/assignment-manager.tsx`
- Modify: `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx`
- Test: `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`
- Test: `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx`

- [ ] **Step 1: Add fixed locale/zone rendering tests**

Mock a non-default locale and timezone in the time-clock popover test, and assert a fixed instant renders in that explicit context. In Clockodo import, assert a custom date-only range renders with an explicit locale and UTC zone.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --dir apps/webapp test src/components/time-tracking/time-clock-popover.test.tsx src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx`

Expected: the added formatting assertions fail while formatters use `undefined` locale or browser defaults.

- [ ] **Step 3: Apply domain-correct formatters**

Use `useLocale()` and the user preference timezone for instants: compliance rest-period availability, time-clock start time, and domain verification expiry. Use the active locale and `timeZone: "UTC"` for date-only holiday/import, holiday-assignment, and Clockodo review ranges. Do not use the viewer timezone for date-only business values.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/time-tracking/time-clock-popover.test.tsx src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add apps/webapp/src/components/compliance/compliance-alert-banner.tsx apps/webapp/src/components/time-tracking/time-clock-popover.tsx apps/webapp/src/components/settings/enterprise/domain-verification-dialog.tsx apps/webapp/src/components/settings/holiday/holiday-import-dialog.tsx apps/webapp/src/components/settings/holiday/assignment/assignment-manager.tsx apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx
git commit -m "fix(dates): format UI dates with explicit context"
```

### Task 6: Consolidate State Transitions And Mutation Invalidation

**Files:**
- Modify: `apps/webapp/src/components/settings/holiday/holiday-import-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/surcharge-reports/surcharge-reports-root.tsx`
- Modify: `apps/webapp/src/components/organization/invite-member-dialog.tsx`
- Test: `apps/webapp/src/components/settings/surcharge-reports/surcharge-reports-root.test.tsx`
- Test: `apps/webapp/src/components/organization/invite-member-dialog.test.tsx`

- [ ] **Step 1: Add reducer and mutation-boundary tests**

Extend surcharge reports tests to assert `requestStarted`, invalid range, success, failed request, stale response, and organization switch leave no stale rows. Extend invite tests to assert successful mutation invalidates only `queryKeys.invitations.list(organizationId)` from mutation success, while failed results do not close the dialog.

- [ ] **Step 2: Run focused tests and verify failures**

Run: `pnpm --dir apps/webapp test src/components/settings/surcharge-reports/surcharge-reports-root.test.tsx src/components/organization/invite-member-dialog.test.tsx`

Expected: assertions for reducer transitions and mutation-level invalidation fail before the refactor.

- [ ] **Step 3: Replace state chains without changing business behavior**

Use reducers for the holiday-import resettable wizard state and surcharge-report fetch state. Preserve cached countries, partial import failures, request-id protection, organization-scoped stale-row protection, and UTC effective date boundaries. Move invitation list invalidation into `useMutation.onSuccess`, retain the result-success guard for dialog closure and refresh, and keep invalidation organization-scoped.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/settings/surcharge-reports/surcharge-reports-root.test.tsx src/components/organization/invite-member-dialog.test.tsx && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add apps/webapp/src/components/settings/holiday/holiday-import-dialog.tsx apps/webapp/src/components/settings/surcharge-reports/surcharge-reports-root.tsx apps/webapp/src/components/organization/invite-member-dialog.tsx apps/webapp/src/components/settings/surcharge-reports/surcharge-reports-root.test.tsx apps/webapp/src/components/organization/invite-member-dialog.test.tsx
git commit -m "refactor(state): consolidate transition updates"
```

### Task 7: Split Onboarding Giant Components

**Files:**
- Modify: `apps/webapp/src/app/[locale]/onboarding/{holiday-setup,organization,profile,vacation-policy,work-templates}/page-client.tsx`
- Create: colocated header, field-section, and action components for each route
- Test: existing `organization/page.test.tsx`, `profile/page.test.tsx`; new focused client tests for holiday setup, vacation policy, and work templates

- [ ] **Step 1: Create behavior tests before extraction**

Cover country selection preset naming and skip/continue; organization slug generation/availability and disabled creation; profile submit defaults; vacation carryover conditional input; and work-template weekday selection/default submission. Keep server action mocks at route boundaries.

- [ ] **Step 2: Run all onboarding tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/onboarding`

Expected: tests pass as behavior baselines before extraction.

- [ ] **Step 3: Extract coherent sections**

For each route, retain authorization, query, form ownership, and submission navigation in `page-client.tsx`. Extract only header, focused form-field groups, and action bars. Pass explicit props and TanStack form field render state; do not create hidden shared mutable state or change onboarding route flow.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/app/[locale]/onboarding && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add 'apps/webapp/src/app/[locale]/onboarding'
git commit -m "refactor(onboarding): split setup page sections"
```

### Task 8: Split Calendar, Billing, Login, Navigation, And Organization Components

**Files:**
- Modify: `apps/webapp/src/components/{billing/billing-page-client,calendar/calendar-view,calendar/schedule-x-calendar,login-form,nav-user,organization/organization-features-card}.tsx`
- Create: colocated focused sections/hooks
- Test: existing billing, calendar, schedule-x, and nav-user tests

- [ ] **Step 1: Extend behavior tests for existing seams**

Add or retain tests for billing action failures, calendar clock-out authorization and selected employee timezone, Schedule-X range selection/modal integration, login two-factor transitions, NavUser preference changes/logout, and optimistic feature-toggle rollback.

- [ ] **Step 2: Run focused component tests**

Run: `pnpm --dir apps/webapp test src/components/billing/billing-page-client.test.tsx src/components/calendar/calendar-view.test.tsx src/components/calendar/schedule-x-calendar.test.tsx src/components/nav-user.test.tsx`

Expected: all baseline behaviors pass before extraction.

- [ ] **Step 3: Extract one responsibility per component**

Split billing alerts/subscription/FAQ and action handling; calendar controls/dialogs from controller state; Schedule-X DOM integrations and pointer selection from calendar creation; login two-factor controls from auth flow; NavUser desktop/mobile preference menus; and organization feature rows from optimistic toggle orchestration. Keep the calendar's Temporal date calculations, explicit timezone inputs, and clock-out authorization unchanged.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/billing/billing-page-client.test.tsx src/components/calendar/calendar-view.test.tsx src/components/calendar/schedule-x-calendar.test.tsx src/components/nav-user.test.tsx && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add apps/webapp/src/components/billing apps/webapp/src/components/calendar apps/webapp/src/components/login-form.tsx apps/webapp/src/components/nav-user.tsx apps/webapp/src/components/organization/organization-features-card.tsx
git commit -m "refactor(components): split primary UI sections"
```

### Task 9: Split Settings Giant Components

**Files:**
- Modify: `apps/webapp/src/components/settings/{approval-policy/approval-policy-dialog,employee-employment-history-card,enterprise/domain-management,enterprise/sso-provider-management,holiday/holiday-import-dialog,work-policy/work-policy-assignment-manager,work-policy/work-policy-compliance-view,work-policy/work-policy-table}.tsx`
- Create: colocated focused sections and pure utilities where required
- Test: existing approval-policy, employment-history, holiday-import utility, policy-assignment, and relevant enterprise tests

- [ ] **Step 1: Add behavior coverage for currently untested dialogs**

Add focused cases for policy stage editing, employment-history form submission, domain/SSO delete confirmation, holiday wizard partial import, policy assignment removal, compliance acknowledgement/export, and work-policy search/delete. Assert organization identifiers remain present in action/query calls.

- [ ] **Step 2: Run settings component tests**

Run: `pnpm --dir apps/webapp test src/components/settings/approval-policy src/components/settings/employee-employment-history-card.test.tsx src/components/settings/holiday src/components/settings/work-policy`

Expected: baselines pass before extracting JSX.

- [ ] **Step 3: Extract settings sections**

Keep form/query/mutation ownership in each parent. Extract approval fields/stages, employment form, domain/SSO tables and confirmations, holiday wizard steps, policy assignment cards, compliance toolbar/summary/table/acknowledgement, and work-policy columns/action menu/delete dialog. Keep query keys, CASL gating, organization scoping, and UTC date-only formatting unchanged.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/settings/approval-policy src/components/settings/holiday src/components/settings/work-policy && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

```bash
git add apps/webapp/src/components/settings
git commit -m "refactor(settings): split large management components"
```

### Task 10: Full Validation And Residual-Triage Check

**Files:**
- Modify only if the scan identifies a remaining real root cause.

- [ ] **Step 1: Run the full React Doctor scan**

Run: `pnpm --dir apps/webapp exec react-doctor --verbose`

Expected: no diagnostics for the 12 addressed rule groups. If a finding remains, reread its canonical validation prompt and fix the root cause rather than suppressing it.

- [ ] **Step 2: Run project validation**

Run: `pnpm --dir apps/webapp test && pnpm --dir apps/webapp typecheck && CI=true pnpm build`

Expected: each command exits zero.

- [ ] **Step 3: Stop on any residual diagnostic**

Do not suppress, ignore, or claim completion for a remaining diagnostic. Return to the task that owns its rule group, add a focused failing test if behavior is involved, apply the canonical fix, validate it, and create a new commit that names that specific rule group.
