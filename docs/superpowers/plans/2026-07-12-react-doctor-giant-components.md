# React Doctor Giant Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 12 supplied React Doctor giant components into focused, behavior-preserving modules.

**Architecture:** Each parent remains the owner of queries, mutations, form state, authorization, and navigation. Extracted modules receive explicit data and event props; pure helpers and browser/DOM lifecycle code live in colocated utility or hook files. No component boundary may change organization scoping, Temporal date semantics, or public component props.

**Tech Stack:** React 19, Next.js 16, TypeScript, Vitest, TanStack Query/Form, Temporal, React Doctor.

---

### Task 1: Billing Page

**Files:** `apps/webapp/src/components/billing/billing-page-client.tsx`, new colocated `billing-page/` modules, `billing-page-client.test.tsx`.

- [ ] Add a behavioral test for a failed checkout or billing-portal request retaining actionable UI.
- [ ] Run `pnpm --dir apps/webapp test src/components/billing/billing-page-client.test.tsx` and observe the test fail.
- [ ] Extract billing alerts, subscription summary, FAQ, and checkout/portal action hook into `billing-page/`; keep the Suspense/search-param boundary and pricing selection in the parent.
- [ ] Re-run the test and `pnpm --dir apps/webapp typecheck`.

### Task 2: Calendar View

**Files:** `apps/webapp/src/components/calendar/calendar-view.tsx`, new `calendar-controls.tsx`, `calendar-event-dialogs.tsx`, `clock-out-on-behalf-dialog.tsx`, and `calendar-view.test.tsx`.

- [ ] Add a test that preserves manager-only clock-out authorization and selected employee timezone context through the extracted dialog boundary.
- [ ] Run the focused test and observe its pre-extraction failure.
- [ ] Extract controls and dialogs; retain all queries, Temporal normalization, route synchronization, and mutation callbacks in `CalendarViewContent`.
- [ ] Re-run calendar tests and typecheck.

### Task 3: Schedule-X Calendar

**Files:** `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`, new `schedule-x-calendar-header.tsx`, `use-schedule-x-dom-integrations.ts`, and `schedule-x-calendar.test.tsx`.

- [ ] Add coverage for a DOM integration seam: time-range selection or delegated clock-out callback.
- [ ] Run the focused test and observe it fail before the explicit exported integration boundary exists.
- [ ] Extract header rendering and DOM lifecycle hooks; keep calendar app creation, plugin order, event conversion, and public wrapper props in the parent.
- [ ] Re-run Schedule-X tests and typecheck.

### Task 4: Navigation User Menu

**Files:** `apps/webapp/src/components/nav-user.tsx`, new `nav-user-preferences.tsx`, and `nav-user.test.tsx`.

- [ ] Add a behavior test for preference persistence before locale navigation.
- [ ] Run the focused test and observe it fail against the new extracted-module contract.
- [ ] Move desktop/mobile preference controls and preference state to `NavUserPreferences`; retain logout, identity trigger, and overlay ownership in `NavUser`.
- [ ] Re-run NavUser tests and typecheck.

### Task 5: Approval Policy Dialog

**Files:** `apps/webapp/src/components/settings/approval-policy/approval-policy-dialog.tsx`, new `approval-policy-stages-field.tsx`, and `approval-policy-dialog.test.tsx`.

- [ ] Add a stage-editor test proving a changed approver clears a stale specific employee selection.
- [ ] Run the focused test and observe it fail before the extracted field interface exists.
- [ ] Extract stage editing only; retain TanStack form state, payload construction, and dialog reset behavior in the parent.
- [ ] Re-run approval-policy tests and typecheck.

### Task 6: Employment History

**Files:** `apps/webapp/src/components/settings/employee-employment-history-card.tsx`, new `employee-employment-history/` modules, and `employee-employment-history-card.test.tsx`.

- [ ] Add a test for UTC date-only timeline display and `__inherit__` conversion.
- [ ] Run the focused test and observe it fail before helpers are exported.
- [ ] Extract form, display/timeline sections, and pure formatting/predicate helpers; retain mutations, confirmation, and derived current/next contexts in the card.
- [ ] Re-run employment-history tests and typecheck.

### Task 7: Enterprise Domain & SSO Management

**Files:** `apps/webapp/src/components/settings/enterprise/domain-management.tsx`, `sso-provider-management.tsx`, new `custom-domain-summary.tsx`, `sso-provider-list-card.tsx`, and enterprise tests.

- [ ] Add behavior tests for delete confirmation and provider/domain local-state updates.
- [ ] Run focused enterprise tests and observe pre-extraction failure.
- [ ] Extract visual summary/list cards; retain server-action sequencing, secret handling, and dialog state in each parent.
- [ ] Re-run focused enterprise tests and typecheck.

### Task 8: Holiday Import Dialog

**Files:** `apps/webapp/src/components/settings/holiday/holiday-import-dialog.tsx`, new `holiday-import/` state, controller, steps, and footer modules, and holiday import tests.

- [ ] Add a workflow test for partial import: assignment failure warns while successful holiday creation completes.
- [ ] Run the focused test and observe it fail before the controller contract exists.
- [ ] Extract reducer/helpers, controller hook, and each wizard step; preserve country reset cascade, UTC date-only display, and import transaction ordering.
- [ ] Re-run holiday tests and typecheck.

### Task 9: Work Policy Assignment Manager

**Files:** `apps/webapp/src/components/settings/work-policy/work-policy-assignment-manager.tsx`, new `work-policy-assignment-sections.tsx`, and `policy-assignment-surface.test.ts`.

- [ ] Add a rendering test for organization/team/employee visibility with permissions.
- [ ] Run the focused test and observe it fail before the explicit section components exist.
- [ ] Extract the three assignment cards; retain org-scoped query, deletion mutation, selected ref, and permission calculation in the manager.
- [ ] Re-run assignment tests and typecheck.

### Task 10: Work Policy Compliance

**Files:** `apps/webapp/src/components/settings/work-policy/work-policy-compliance-view.tsx`, new `work-policy-compliance/` helpers, content, and acknowledgement panel modules.

- [ ] Add tests for acknowledgement reset and correctly escaped CSV export rows.
- [ ] Run focused tests and observe pre-extraction failure.
- [ ] Extract presentation and pure CSV/display helpers; retain range state, query/mutation ownership, and query invalidation in the parent.
- [ ] Re-run focused tests and typecheck.

### Task 11: Work Policy Table

**Files:** `apps/webapp/src/components/settings/work-policy/work-policy-table.tsx`, new `work-policy-table-columns.tsx`, and work-policy tests.

- [ ] Add a test that action availability follows `canManagePolicies` and pending mutation state.
- [ ] Run the focused test and observe pre-extraction failure.
- [ ] Extract the table column factory and action menu; retain queries, mutations, filtering, and deletion dialog state in the parent.
- [ ] Re-run work-policy tests and typecheck.

### Task 12: Validate Each Boundary

- [ ] After each task, run its focused Vitest file and `pnpm --dir apps/webapp typecheck`.
- [ ] After all tasks, run `pnpm --dir apps/webapp test`, `CI=true pnpm build`, and `npx react-doctor@latest --verbose` from `apps/webapp`.
- [ ] Confirm the original 12 `react-doctor/no-giant-component` paths no longer appear; preserve unrelated diagnostics.
