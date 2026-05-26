# React Doctor Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all current React Doctor error-severity findings in `apps/webapp`, review and fix the two raw HTML/script findings, and add the missing Suspense boundary for `useSearchParams()`.

**Architecture:** Work in the isolated worktree at `/home/kai/projects/z8/.worktrees/fix-react-doctor-errors` on branch `fix/react-doctor-errors`. Treat React Doctor findings as hypotheses: each task must read the relevant code, make the smallest behavior-preserving change, and verify the relevant rule count drops. Prefer direct React 19-safe patterns over suppressions.

**Tech Stack:** Next.js 16, React 19, TypeScript, pnpm, Vitest, React Doctor, Better Auth/Tolgee existing app conventions.

---

## Baseline

Run from `apps/webapp`:

```bash
pnpm dlx react-doctor@latest --verbose .
```

Baseline evidence from `/tmp/react-doctor-c820a0c0-4928-4815-8fe0-9979ec852258`:

```text
Score: 36 / 100 Critical
Total issues: 2369
Errors: 132
Warnings: 2237

Error groups:
61 react-hooks-js/todo
33 react-hooks-js/set-state-in-effect
16 react-hooks-js/refs
14 react-hooks-js/preserve-manual-memoization
6 react-hooks-js/incompatible-library
1 react-hooks-js/immutability
1 react-hooks-js/hooks
```

## File Structure

No new production modules are expected unless a subagent finds that a tiny helper is needed to preserve behavior. Existing files are modified in place.

Plan artifacts:

- Modify: `docs/superpowers/plans/2026-05-26-react-doctor-errors.md`

Targeted app files:

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx`
- Modify: `apps/webapp/src/app/[locale]/layout.tsx`
- Modify: `apps/webapp/src/components/ui/chart.tsx`

React Compiler files are grouped by primary error family below. When a file appears in multiple families, complete the earlier task first and have later subagents re-read the current file before editing.

## Subagent Coordination Rules

- Use one implementation subagent per task.
- Do not run implementation subagents in parallel if their file lists overlap.
- Parallel-safe groups: Task 1 and Task 2 are independent. Task 3 can run with Task 1 after confirming no shared files. Tasks 4, 5, 6, 7, and 8 should run sequentially because several files overlap.
- Each implementation subagent must return `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED` with changed files, commands run, and current React Doctor evidence.
- After each implementation subagent returns, run a spec-compliance review subagent, then a code-quality review subagent. Do not move to the next task until both approve.
- Do not commit unless the user explicitly asks. This overrides generic plan examples that mention commits.

## Common Verification Commands

Run these from `/home/kai/projects/z8/.worktrees/fix-react-doctor-errors/apps/webapp` unless stated otherwise.

```bash
pnpm dlx react-doctor@latest --verbose --diff
pnpm test -- --runInBand
```

If `--runInBand` is unsupported by Vitest in this project, use:

```bash
pnpm test
```

Final verification from repository root:

```bash
CI=true pnpm build:webapp
```

## Task 1: Add Suspense Boundary for Platform Analytics Controls

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx`
- Modify only if needed: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx`

- [ ] **Step 1: Read the current files**

Read:

```text
apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx
apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx
```

- [ ] **Step 2: Verify the failing diagnostic**

Run:

```bash
pnpm dlx react-doctor@latest --verbose .
```

Expected before fix: output includes `react-doctor/nextjs-no-use-search-params-without-suspense` at `analytics-controls.tsx:43`.

- [ ] **Step 3: Implement the minimal Suspense wrapper**

In `page.tsx`, wrap the existing controls render with a small fallback that preserves layout dimensions:

```tsx
<Suspense fallback={<PlatformAnalyticsControlsLoading />}>
  <PlatformAnalyticsControls range={parsedParams.range} bucket={parsedParams.bucket} />
</Suspense>
```

Add this helper in the same file near `PlatformAnalyticsLoading`:

```tsx
function PlatformAnalyticsControlsLoading() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center" aria-hidden="true">
      <div className="grid gap-1.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-10 w-full sm:w-[180px]" />
      </div>
      <div className="grid gap-1.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-10 w-full sm:w-[160px]" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: no `nextjs-no-use-search-params-without-suspense` finding remains for `analytics-controls.tsx`.

## Task 2: Review and Fix Raw HTML/Script Findings

**Files:**

- Modify: `apps/webapp/src/app/[locale]/layout.tsx`
- Modify: `apps/webapp/src/components/ui/chart.tsx`
- Check tests: `apps/webapp/src/app/[locale]/layout.test.tsx`
- Check tests: `apps/webapp/src/components/ui/chart.test.tsx`

- [ ] **Step 1: Read trust boundaries**

Confirm `FONT_SIZE_INIT_SCRIPT` in `layout.tsx` is static source-controlled code, not tenant/user input. Confirm chart style CSS values come only from typed chart config objects, then inspect whether `color` can contain unsafe CSS tokens.

- [ ] **Step 2: Replace native script where safe**

In `layout.tsx`, import `Script` from `next/script` and replace the raw `<script>` with:

```tsx
<Script id="font-size-init" strategy="beforeInteractive">
  {FONT_SIZE_INIT_SCRIPT}
</Script>
```

Expected intent: keep the font-size initialization before hydration while using Next.js script handling.

- [ ] **Step 3: Harden chart CSS generation**

In `chart.tsx`, keep the `<style>` tag if required for CSS custom properties, but add a strict color-value validator before interpolation. Use a small allowlist for common safe CSS color syntaxes:

```ts
const SAFE_CSS_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9%.,\s/+-]+\)|(?:var\(--[a-zA-Z0-9_-]+\))|[a-zA-Z]+)$/;

function toSafeCssColor(value: string): string | null {
  const trimmed = value.trim();
  return SAFE_CSS_COLOR_PATTERN.test(trimmed) ? trimmed : null;
}
```

Use it before returning each CSS variable:

```ts
const safeColor = color ? toSafeCssColor(color) : null;
return safeColor ? `  --color-${toSafeCssIdentifier(key, index)}: ${safeColor};` : null;
```

- [ ] **Step 4: Verify security tests**

Run existing focused tests if present:

```bash
pnpm vitest run src/components/ui/chart.test.tsx src/app/[locale]/layout.test.tsx
```

Expected: tests pass. If a test asserts raw `<script>` rendering, update it to assert the rendered Next `Script` behavior or the presence of the script id/content without weakening the security check.

- [ ] **Step 5: Verify React Doctor diff**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: `nextjs-no-native-script` is gone. `no-danger` for `chart.tsx` may remain because style injection still uses React's raw HTML API; if it remains, document the sanitized trust boundary in the task result rather than suppressing it.

## Task 3: Fix React Compiler `todo` Tagged Template Errors

**Files:**

- Modify all files listed in baseline `react-hooks-js/todo`:
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/billing/page.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/layout.tsx`
- `apps/webapp/src/app/[locale]/(app)/analytics/team-performance/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/analytics/vacation-trends/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/analytics/work-hours/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/billing/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/page.tsx`
- `apps/webapp/src/app/[locale]/onboarding/organization/organization-page-client.tsx`
- `apps/webapp/src/components/dashboard/presence-status-widget.tsx`
- `apps/webapp/src/components/dashboard/hydration-widget.tsx`
- `apps/webapp/src/components/absences/absence-year-calendar.tsx`
- `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`
- `apps/webapp/src/components/dashboard/use-widget-data.ts`
- `apps/webapp/src/components/settings/absence-category-form.tsx`
- `apps/webapp/src/components/settings/audit-export/audit-config-form.tsx`
- `apps/webapp/src/components/settings/audit-export/audit-pack-generator-card.tsx`
- `apps/webapp/src/components/reports/projects/project-reports-container.tsx`
- `apps/webapp/src/components/settings/audit-export/audit-packages-table.tsx`
- `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx`
- `apps/webapp/src/components/settings/holiday-import-dialog.tsx`
- `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`
- `apps/webapp/src/components/settings/work-balance-recalculation-card.tsx`
- `apps/webapp/src/components/settings/vacation-policy-form.tsx`
- `apps/webapp/src/components/settings/social-accounts.tsx`
- `apps/webapp/src/components/time-tracking/quick-break-popover.tsx`
- `apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx`
- `apps/webapp/src/components/ui/calendar.tsx`
- `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog.tsx`
- `apps/webapp/src/hooks/use-image-upload.ts`
- `apps/webapp/src/hooks/use-push-notifications.ts`
- `apps/webapp/src/hooks/use-travel-expense-file-upload.ts`
- `apps/webapp/src/hooks/use-organization.ts`
- `apps/webapp/src/lib/hooks/use-enabled-providers.ts`
- `apps/webapp/src/lib/notifications/use-notification-stream.tsx`
- `apps/webapp/src/lib/queue/use-job-status.ts`
- `apps/webapp/src/tolgee/client.tsx`

- [ ] **Step 1: Identify tagged templates**

Search each target file for tagged template calls inside React components/hooks, especially `t\`...${...}\``, `css\`...${...}\``, or similar.

- [ ] **Step 2: Replace interpolation-bearing tagged templates**

For each finding, convert the tagged template to an equivalent function call or string expression already supported in the same file. Examples:

```ts
// Before
const label = t`Project ${projectName}`;

// After
const label = t("Project {projectName}", { projectName });
```

```ts
// Before
const className = cn(`grid-cols-${columns}`);

// After
const className = cn("grid", columnClassByCount[columns]);
```

Do not change translated copy keys or runtime behavior. If a tagged template is not user-facing and can safely become string concatenation, use explicit concatenation:

```ts
const key = "job-" + jobId;
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: `react-hooks-js/todo` count is `0` for changed files.

## Task 4: Fix Synchronous `setState` in Effects

**Files:**

- Modify all files listed in baseline `react-hooks-js/set-state-in-effect`.

- [ ] **Step 1: Classify each effect**

For each file, decide whether the effect is deriving render state, mirroring props, initializing client-only state, or subscribing to an external system.

- [ ] **Step 2: Apply the correct pattern**

Use these replacements:

```ts
// Derived value: remove state and effect.
const derivedValue = computeValue(input);
```

```ts
// Prop reset: key the child or initialize state from props directly.
const [value, setValue] = useState(() => initialValue);
```

```ts
// Browser subscription: useSyncExternalStore.
const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
```

```ts
// Async external update: set state inside the async callback or event listener, not synchronously in the effect body.
useEffect(() => {
  let cancelled = false;
  void load().then((nextValue) => {
    if (!cancelled) {
      setValue(nextValue);
    }
  });
  return () => {
    cancelled = true;
  };
}, [load]);
```

- [ ] **Step 3: Verify focused tests**

Run tests for files that already have adjacent tests. If no adjacent test exists, run React Doctor diff and `pnpm test` after the batch.

- [ ] **Step 4: Verify React Compiler errors**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: `react-hooks-js/set-state-in-effect` count is `0` for changed files.

## Task 5: Fix Ref Access During Render

**Files:**

- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx`
- `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- `apps/webapp/src/components/settings/surcharge-reports.tsx`
- `apps/webapp/src/components/ui/virtualized-table.tsx`
- `apps/webapp/src/components/ui/time-input.tsx`
- `apps/webapp/src/hooks/use-push-notifications.ts`
- `apps/webapp/src/hooks/use-water-reminder.ts`
- `apps/webapp/src/lib/notifications/use-notification-stream.tsx`
- `apps/webapp/src/lib/query/provider.tsx`

- [ ] **Step 1: Locate `.current` reads in render paths**

Search each file for `.current` reads outside event handlers, effects, callbacks, or imperative methods.

- [ ] **Step 2: Replace render-time ref reads**

Use one of these patterns:

```ts
// Render-affecting value: use state.
const [isReady, setIsReady] = useState(false);
```

```ts
// Non-render transient value: move the read into the event handler/effect that uses it.
function handleAction() {
  const currentValue = valueRef.current;
  // use currentValue here
}
```

```ts
// Singleton construction: use lazy state instead of useRef read in render.
const [client] = useState(() => createClient());
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: `react-hooks-js/refs` count is `0` for changed files.

## Task 6: Fix Manual Memoization Preservation Errors

**Files:**

- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx`
- `apps/webapp/src/components/login-form.tsx`
- `apps/webapp/src/components/settings/absence-categories-table.tsx`

- [ ] **Step 1: Inspect memo dependencies**

Find `useMemo`, `useCallback`, and memoized arrays/objects near the reported lines.

- [ ] **Step 2: Preserve stable dependencies**

Replace mutable dependency objects with primitive dependencies or stable snapshots:

```ts
const stableIds = items.map((item) => item.id).join("|");

const selectedItems = useMemo(() => {
  return items.filter((item) => selectedIds.has(item.id));
}, [items, selectedIds, stableIds]);
```

If the memo only protects cheap work and creates compiler conflicts, remove the memo and compute inline.

- [ ] **Step 3: Verify forms still behave**

Run focused tests if present:

```bash
pnpm vitest run src/components/login-form.test.tsx src/components/settings/absence-categories-table.test.tsx src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx
```

If a listed test file does not exist, run `pnpm test` after the batch.

- [ ] **Step 4: Verify React Compiler errors**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: `react-hooks-js/preserve-manual-memoization` count is `0` for changed files.

## Task 7: Fix Incompatible Library, Hooks, and Immutability Errors

**Files:**

- `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
- `apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx`
- `apps/webapp/src/components/licenses/license-table.tsx`
- `apps/webapp/src/components/data-table.tsx`
- `apps/webapp/src/components/data-table-server/data-table.tsx`
- `apps/webapp/src/components/ui/virtualized-table.tsx`
- `apps/webapp/src/hooks/use-organization.ts`
- `apps/webapp/src/hooks/use-notification-stream.ts`

- [ ] **Step 1: Inspect library calls**

For incompatible-library findings, locate table APIs or hooks returning unstable functions. Do not memoize the returned object/functions unless the library documents it as safe.

- [ ] **Step 2: Isolate unstable library values**

Move unstable library calls to the narrowest component scope and avoid passing unstable functions to memoized children. Prefer passing primitive state or direct event handlers:

```ts
function RowAction({ rowId, onSelect }: { rowId: string; onSelect: (rowId: string) => void }) {
  return <button type="button" onClick={() => onSelect(rowId)}>Select</button>;
}
```

- [ ] **Step 3: Fix hook reference in `use-organization.ts`**

Ensure hooks are called directly, not stored or passed as values:

```ts
// Before
const hook = useSomething;
const value = hook();

// After
const value = useSomething();
```

- [ ] **Step 4: Fix declaration order in `use-notification-stream.ts`**

Move `connect` declaration above any effect/callback that closes over it, or convert it to a function declaration if it does not need local mutable state:

```ts
function connect() {
  // existing body
}
```

- [ ] **Step 5: Verify**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: counts are `0` for `react-hooks-js/incompatible-library`, `react-hooks-js/hooks`, and `react-hooks-js/immutability` in changed files.

## Task 8: Full React Doctor Error Burn-Down

**Files:**

- Modify any remaining file reported with severity `error` by React Doctor after Tasks 1-7.

- [ ] **Step 1: Run full scan**

Run:

```bash
pnpm dlx react-doctor@latest --verbose .
```

- [ ] **Step 2: Summarize remaining errors**

Use the emitted diagnostics path and run:

```bash
node -e "const fs=require('fs'); const p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,'utf8')); const errors=d.filter(x=>x.severity==='error'); const byRule={}; for (const x of errors){const k=x.plugin+'/'+x.rule; byRule[k]=(byRule[k]||0)+1;} console.log(errors.length, byRule);" /tmp/REPLACE_WITH_SCAN_DIR/diagnostics.json
```

Replace `/tmp/REPLACE_WITH_SCAN_DIR/diagnostics.json` with the actual diagnostics path printed by React Doctor.

- [ ] **Step 3: Fix remaining errors only**

For each remaining error, read the relevant code and apply the smallest safe fix. Do not expand into warning cleanup unless it is necessary to remove an error.

- [ ] **Step 4: Verify zero errors**

Run:

```bash
pnpm dlx react-doctor@latest --verbose .
```

Expected: `Errors: 0` or no severity `error` entries in `diagnostics.json`. Warnings may remain.

## Task 9: Final Verification

**Files:**

- All changed files.

- [ ] **Step 1: Run React Doctor diff**

Run from `apps/webapp`:

```bash
pnpm dlx react-doctor@latest --verbose --diff
```

Expected: no error-severity findings in changed files and no regression in score.

- [ ] **Step 2: Run full React Doctor scan**

Run from `apps/webapp`:

```bash
pnpm dlx react-doctor@latest --verbose .
```

Expected: `0` error-severity findings.

- [ ] **Step 3: Run webapp tests**

Run from `apps/webapp`:

```bash
pnpm test
```

Expected: all Vitest tests pass.

- [ ] **Step 4: Run production build**

Run from repository root:

```bash
CI=true pnpm build:webapp
```

Expected: webapp build exits `0`.

- [ ] **Step 5: Final review**

Dispatch a final code-review subagent over the full diff. Required focus: React Compiler compatibility, XSS/trust boundaries for raw style/script content, Suspense correctness, behavior preservation, and no unrelated cleanup.

## Self-Review Notes

- Scope covers all `132` React Doctor error-severity findings from the baseline plus requested raw HTML/script and Suspense warning fixes.
- No production code suppression is planned.
- The raw chart style injection may still be flagged by static analysis if React Doctor only detects API usage. The implementation must harden interpolation and document the remaining trust boundary if the warning remains.
- Commits are intentionally omitted because the active developer instructions require explicit user request before committing.
