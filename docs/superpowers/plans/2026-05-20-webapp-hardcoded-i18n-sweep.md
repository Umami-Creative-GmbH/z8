# Webapp Hardcoded i18n Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace remaining hardcoded user-facing strings in the webapp with Tolgee translations, excluding `/compliance` because another agent owns that area.

**Architecture:** Work in independent subsystem batches to avoid conflicts: analytics/today, organization/notifications/billing, settings, scheduling/approvals/shared UI, and lib-backed display registries. Each batch adds or extends a small i18n guard test that scans the relevant source files for known raw literals, then replaces literals with `t(key, fallback, params)` or namespace message lookups following existing patterns.

**Tech Stack:** Next.js App Router, React client components, Tolgee `@tolgee/react`, JSON locale namespaces under `apps/webapp/messages`, Vitest, pnpm, Biome.

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(app)/analytics/**`: analytics headings, chart labels, filters, empty states, and toasts.
- Modify `apps/webapp/src/app/[locale]/(app)/today/**`: manager briefing titles, card labels, actions, and toasts.
- Modify `apps/webapp/src/components/organization/**`: organization/team/member management dialog and table copy.
- Modify `apps/webapp/src/components/notifications/**`: notification preferences, permission modal/provider copy.
- Modify `apps/webapp/src/components/billing/billing-page-client.tsx`: billing plan/status/FAQ copy.
- Modify `apps/webapp/src/components/settings/**` excluding compliance-owned paths: enterprise identity, imports, audit export/logs, permissions, employment/rates, policies, templates, payroll placeholders.
- Modify `apps/webapp/src/components/scheduling/**` and `apps/webapp/src/app/[locale]/(app)/scheduling/page.tsx`: scheduling labels, loading, form copy, toasts.
- Modify `apps/webapp/src/components/approvals/**` and `apps/webapp/src/app/[locale]/(app)/approvals/**`: approval labels, card copy, reasons, toasts.
- Modify shared UI only where app-specific user-facing literals are not intentionally library defaults: app search, dashboard widget labels, data table labels, layout loading.
- Modify lib display registries that surface in UI: authorization permission registry, email template registry, notification trigger templates, manager daily briefing, payroll readiness, implementation checklist, validation labels/messages.
- Add or extend targeted i18n scan tests under the same feature folders, following existing `travel-expenses-i18n.test.ts` and `reports-i18n.test.ts` patterns.

### Task 1: Establish Guard Tests

**Files:**
- Create: `apps/webapp/src/components/i18n-hardcoded-sweep.test.ts`

- [ ] **Step 1: Add a focused raw-copy scanner**

Create a Vitest file that reads known production files and rejects representative raw literals from the scan. Use explicit file lists and literal patterns, not broad regexes that catch class names or object keys.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checks: Array<{ file: string; patterns: RegExp[] }> = [
  {
    file: "src/app/[locale]/(app)/analytics/page.tsx",
    patterns: [/"Failed to load analytics data"/, />Total Employees</, />Work Hours by Team</],
  },
  {
    file: "src/app/[locale]/(app)/today/today-briefing.tsx",
    patterns: [/>Manager Daily Briefing</, />Critical issues</, /aria-label="Today summary"/],
  },
  {
    file: "src/components/organization/create-team-dialog.tsx",
    patterns: [/>Create Team</, /"Failed to create team"/, /placeholder="Team name"/],
  },
  {
    file: "src/components/notifications/notification-settings.tsx",
    patterns: [/>Notification Preferences</, />Enable Push Notifications</, /"Unable to load notification preferences"/],
  },
  {
    file: "src/components/settings/enterprise/domain-management.tsx",
    patterns: [/>Custom Domain</, />No custom domain configured yet\.</, /"Failed to delete domain"/],
  },
  {
    file: "src/components/settings/audit-log-viewer.tsx",
    patterns: [/>Audit Log Entries</, />IP Address</, /"Failed to export audit logs"/],
  },
  {
    file: "src/components/scheduling/scheduler/shift-scheduler.tsx",
    patterns: [/>Loading schedule\.\.\.</],
  },
  {
    file: "src/lib/authorization/permission-registry.ts",
    patterns: [/label: "Manage Employees"/, /description: "Full access to employee profiles and settings"/],
  },
];

describe("webapp i18n hardcoded sweep", () => {
  it.each(checks)("does not leave known raw UI copy in $file", ({ file, patterns }) => {
    const source = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      expect(source, `${file} should not contain ${pattern}`).not.toMatch(pattern);
    }
  });
});
```

- [ ] **Step 2: Run the guard test and confirm failure**

Run: `pnpm --filter webapp test src/components/i18n-hardcoded-sweep.test.ts`

Expected: FAIL on the listed raw literals before implementation.

### Task 2: Analytics and Today Batch

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/work-hours/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/vacation-trends/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/team-performance/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/today/today-briefing.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.tsx`
- Modify locale files in `apps/webapp/messages/analytics/*.json`, `apps/webapp/messages/dashboard/*.json`, or root locale files matching existing namespace usage.

- [ ] **Step 1: Replace raw strings with `t()`**

Use `useTranslate()` in client components. Use keys under `analytics.*` for analytics and `today.*` or `dashboard.today.*` for manager briefing. Preserve interpolation for dynamic strings such as updated timestamps, approval titles, and counts.

- [ ] **Step 2: Add locale keys**

Add English fallback-equivalent keys to all supported locales first. If high-quality translations are already nearby in the same namespace, use matching terms; otherwise use English fallback in non-English files rather than leaving missing keys.

- [ ] **Step 3: Verify batch**

Run: `pnpm --filter webapp test src/components/i18n-hardcoded-sweep.test.ts`

Expected: analytics/today patterns no longer fail.

### Task 3: Organization, Notifications, and Billing Batch

**Files:**
- Modify: `apps/webapp/src/components/organization/**/*.tsx`
- Modify: `apps/webapp/src/components/notifications/**/*.tsx`
- Modify: `apps/webapp/src/components/billing/billing-page-client.tsx`
- Modify matching locale namespace files under `apps/webapp/messages/**`.

- [ ] **Step 1: Localize organization/team/member management**

Replace dialog titles, descriptions, field labels, placeholders, role labels, action buttons, empty states, and toast strings with `t()`.

- [ ] **Step 2: Localize notifications UI**

Replace category titles/descriptions, channel labels, permission modal text, and push provider toast text with `t()`.

- [ ] **Step 3: Localize billing UI**

Replace plan/status/FAQ/action/toast strings with `t()` and keep pricing tokens such as `/seat/month` as translated strings where user-facing.

- [ ] **Step 4: Verify batch**

Run: `pnpm --filter webapp test src/components/i18n-hardcoded-sweep.test.ts src/components/notifications/notification-settings.test.tsx src/components/organization/invite-code-management.test.tsx`

Expected: tests pass or only unrelated pre-existing failures remain.

### Task 4: Settings Batch

**Files:**
- Modify settings files reported in the scan, excluding compliance-owned pages/components.
- Modify matching locale namespace files under `apps/webapp/messages/settings/*.json` or root locale files.

- [ ] **Step 1: Localize enterprise identity settings**

Replace domain, SSO, OAuth, auth config, verification, and social provider management copy with `t()`.

- [ ] **Step 2: Localize import and audit settings**

Replace clockin/clockodo import labels, import review labels, audit log filters/table/detail labels, and audit export tooltips with `t()`.

- [ ] **Step 3: Localize employee/security/policy settings**

Replace employment history, rate history, permissions, passkeys, role/contract selectors, coverage/work policy weekdays, project statuses, and email template labels with `t()`.

- [ ] **Step 4: Verify batch**

Run: `pnpm --filter webapp test src/components/i18n-hardcoded-sweep.test.ts`

Expected: settings patterns no longer fail.

### Task 5: Scheduling, Approvals, Shared UI Batch

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/**`
- Modify: `apps/webapp/src/components/approvals/**`
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/page.tsx`
- Modify: `apps/webapp/src/components/scheduling/**`
- Modify: selected shared components from scan: app search, dashboard widgets, data table labels, layout loading.
- Modify matching locale files.

- [ ] **Step 1: Localize approvals**

Replace approval page card copy, inbox toolbar filters, approval dialog validation/labels, and action toasts with `t()`.

- [ ] **Step 2: Localize scheduling**

Replace schedule headings, loading text, sidebar labels, shift dialog toasts, and shift form labels/placeholders/help text with `t()`.

- [ ] **Step 3: Localize shared UI where app-specific**

Replace app search copy, dashboard drag/refresh labels, and project-specific data table demo labels. Leave generic reusable UI library defaults alone if they are deliberately framework-level and not part of app copy.

- [ ] **Step 4: Verify batch**

Run: `pnpm --filter webapp test src/components/i18n-hardcoded-sweep.test.ts`

Expected: approvals/scheduling/shared patterns no longer fail.

### Task 6: Lib Display Registry Batch

**Files:**
- Modify: `apps/webapp/src/lib/authorization/permission-registry.ts`
- Modify: `apps/webapp/src/lib/email/template-registry.ts`
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
- Modify: `apps/webapp/src/lib/manager-daily-briefing/**`
- Modify: `apps/webapp/src/lib/payroll-readiness/**`
- Modify: `apps/webapp/src/lib/implementation-checklist/definition.ts`
- Modify: `apps/webapp/src/lib/validations/**/*.ts`
- Modify matching message files.

- [ ] **Step 1: Use translation keys or key-bearing metadata**

For registries that cannot call React hooks, add stable translation keys next to labels/descriptions, then translate at render sites. If a registry is consumed server-side for user-facing payloads, use the existing server translation mechanism or return keys plus fallbacks to client renderers.

- [ ] **Step 2: Localize notifications and email registry surfaces**

For notification trigger and email template text, use existing i18n infrastructure where available. Preserve stored/template identifiers and only translate display titles/messages shown to users.

- [ ] **Step 3: Localize validation messages**

Where validation schemas are client-rendered, move messages to form-level `t()` helpers or return message keys. Do not break server validation semantics.

- [ ] **Step 4: Verify batch**

Run: `pnpm --filter webapp test src/components/i18n-hardcoded-sweep.test.ts`

Expected: lib registry patterns no longer fail.

### Task 7: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Search for remaining known raw strings**

Run focused searches for representative scan strings excluding `/compliance` and tests. Expected: no remaining known raw UI literals from the scan in targeted production files.

- [ ] **Step 2: Format and typecheck**

Run: `pnpm --filter webapp exec biome check <modified ts/tsx files>` and `pnpm --filter webapp exec tsc --noEmit`.

Expected: both pass or report unrelated pre-existing failures only.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter webapp test`.

Expected: all tests pass. If unrelated dirty-worktree tests fail, record exact failures and confirm they are outside the i18n sweep.

## Self-Review

- Spec coverage: the plan covers every scan bucket except `/compliance`, which is explicitly excluded by the user.
- Placeholder scan: no TBD/TODO placeholders remain; each task has concrete files, actions, and verification commands.
- Type consistency: all client UI uses Tolgee `t()`, registry/server surfaces use key-bearing metadata or existing server translation paths.
