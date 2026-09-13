# Incomplete Manual Time Input Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the existing worktree.

**Goal:** Prevent incomplete visible manual times from submitting a previous valid value (#269).

**Architecture:** Retain local editable text in `TimeInput`, emitting normalized time or an empty invalid value through the existing event interface. Validate the submitted fields in the existing TanStack form and verify the actual composition through its server-action boundary.

**Tech Stack:** React 19, TanStack Form, timepicker-ui, Testing Library/user-event, Vitest, TypeScript, pnpm.

---

## Files and responsibilities

- `apps/webapp/src/components/ui/time-input.tsx`: mask/draft, canonical emission, controlled synchronization.
- `apps/webapp/src/components/ui/time-input.test.tsx`: component contract, controlled parent and picker interaction regressions.
- `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`: time-field validators and accessible feedback.
- `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`: real input/form/action-boundary integration.
- `apps/webapp/messages/timeTracking/*.json`: localized field-validation message.
- Design and this plan: approved scope and execution evidence.

## Task 1: Reproduce stale input and preserve editable drafts

- [x] Add controlled-parent tests for incomplete and invalid input emitting `""`, preserving visible text after parent echo, completing back to the same time, PM continuity, and external value updates. Replace the old expectation that incomplete text emits nothing.

```tsx
fireEvent.change(screen.getByLabelText("Start time"), {
  target: { value: "14:" },
});
expect(handleChange).toHaveBeenLastCalledWith(
  expect.objectContaining({ target: expect.objectContaining({ value: "" }) }),
);
```

- [x] Run `pnpm --filter webapp test src/components/ui/time-input.test.tsx`; confirm the stale-value assertion fails.
- [x] Emit invalidation from mask transitions using the existing parser:

```tsx
const nextValue = parseMaskedTime(nextDisplayValue, pickerFormat, period);
emitChange(nextValue ?? "");
```

- [x] Preserve draft/period for a matching controlled echo; retain synchronization for external changes and format changes. Cover any synchronization edge discovered with a failing regression before fixing it.
- [x] Run the same test file and `pnpm --filter webapp typecheck`.

## Task 2: Validate the actual manual form

- [x] Remove the `TimeInput` mock from the existing dialog tests; render the actual component and picker. Add keyboard deletion/replacement tests for both time fields, invalid masked hours/minutes, no action invocation on submit, associated feedback, and successful corrected submission.

```tsx
await user.click(screen.getByLabelText("Clock Out"));
await user.keyboard("{End}{Backspace}");
await user.click(screen.getByRole("button", { name: "Create Entry" }));
expect(createManualTimeEntry).not.toHaveBeenCalled();
```

- [x] Run `pnpm --filter webapp test src/components/time-tracking/manual-time-entry-dialog.test.tsx`; confirm failure at the actual form boundary.
- [x] Add a field validator near the form definition, using the existing translation function, and register it for `onChange` and `onSubmit` on both time fields:

```tsx
const validateTime = ({ value }: { value: string }) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? undefined
    : t("timeTracking.manualEntry.errors.invalidTime", "Enter a complete, valid time");
```

- [x] Add the same key to the existing locale catalogs. Reuse the existing error/label/control primitives.
- [x] Rerun the dialog file and typecheck; check the component file for shared-input regressions.

## Task 3: Review and final evidence

- [x] Run React Doctor and review React, composition, and web-interface standards on changed code.
- [x] Run `/code-review` against base `3f67a31c`, with spec #269 and relevant #264 contracts; fix actionable findings with focused verification.
- [x] Run root `pnpm test` once after implementation; record failures/skips exactly. Database checks requiring unavailable credentials remain blocked.

Final delivery: inspect `git status`, `git diff`, and `git log --oneline -10`,
record the evidence on #269, and commit only this ticket's files on
`feature/269-incomplete-manual-time-input`.

## Execution evidence — 2026-09-13

### Red/green and integration scope

- The initial component regression run failed six tests because invalid/partial
  text retained `14:30` as its submitted value or emitted no invalidation.
- After adding invalidation, five controlled-draft tests failed because the
  parent echo erased visible text. The echo guard corrected those failures.
- Actual manual-form keyboard tests then demonstrated that the action was
  called with an empty endpoint: native `required` checks see the nonempty
  visible draft, not the canonical field. TanStack validation now stops that
  call and displays associated feedback.
- The manual tests use the actual TimeInput, masking, timepicker-ui, TanStack
  form, labels, and error primitives in jsdom. Translation/preferences,
  unrelated choice/date loaders, navigation/toasts, and the server action are
  controlled test boundaries. The standalone input tests stub picker callbacks.
- Additional passing checks cover Enter submission, digit masking in 12h/24h,
  retained PM, external reset, period toggling while incomplete, and valid
  picker-confirmed recovery. All ten locale catalogs contain the new message.

### Executed checks

| Check | Result |
| --- | --- |
| `pnpm --filter webapp test src/components/ui/time-input.test.tsx` | 29 passed |
| `pnpm --filter webapp test src/components/time-tracking/manual-time-entry-dialog.test.tsx` | 28 passed |
| `pnpm --filter webapp typecheck` | Passed all three TypeScript projects after route generation |
| Biome check on the four changed TSX files | Passed |
| `pnpm dlx react-doctor@latest --verbose --scope changed` | Four files scanned, 100/100, no findings |
| `/code-review`, working-tree diff against `3f67a31c` | Standards: zero findings. Spec: zero actionable code findings; final verification/evidence was pending at review time and is recorded here |
| Root `pnpm test`, executed once | 29 Docker/runtime checks passed; Turbo failed to spawn webapp tests with `Exec format error (os error 8)` |
| `pnpm --filter webapp test`, full webapp suite executed once after the launcher failure | 1,000 files passed, five skipped; 11,142 tests passed, 283 skipped; zero failures |
| `git diff --check` | Passed |

The first two typecheck attempts reported only a missing generated
`@/data/licenses.json`. The normal `pnpm --filter webapp run generate-licenses`
setup command generated this ignored asset; no production build was run and
the generated catalog is not part of the commit.

### Remaining evidence and activation limits

- The Next.js browser-loop preflight found `agent-browser` absent. Authenticated
  Next.js/browser verification was not run; the Phase-backed application
  environment is unavailable to agents. jsdom execution is evidence of the
  actual input/form behavior, not an authenticated browser or deployment test.
- Database-dependent checks remain skipped/unexecuted; no database access,
  migration, historical repair, deployment, or operational activation was run.
- This change implements only T05's bounded early truthfulness correction. It
  introduces no new persistence/evidence lifecycle or manual protocol. Parent
  evidence, all-writer/configuration, old-consumer/worker, and pilot obligations
  remain unsatisfied by this change and cannot be inferred from these tests.
- Keep #269 open for normal integration and remaining runtime/release evidence;
  this local commit does not establish production activation readiness.
