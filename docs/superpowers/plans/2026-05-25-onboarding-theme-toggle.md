# Onboarding Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the existing theme toggle to the onboarding shell so onboarding steps match auth route controls.

**Architecture:** Reuse `ThemeToggle` from `@/components/theme-toggle` in the onboarding layout top control row. Extend the existing onboarding layout test with a mock and assertion so the behavior is covered without testing the dropdown implementation.

**Tech Stack:** Next.js App Router, React, Vitest, Testing Library, Tailwind CSS.

---

### Task 1: Onboarding Theme Toggle

**Files:**
- Modify: `apps/webapp/src/app/[locale]/onboarding/layout.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/layout.tsx`

- [ ] **Step 1: Write the failing test**

Update `apps/webapp/src/app/[locale]/onboarding/layout.test.tsx` to mock `ThemeToggle` and assert it renders:

```tsx
vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

expect(screen.getByRole("button", { name: "Theme" })).toBeTruthy();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run 'src/app/[locale]/onboarding/layout.test.tsx'`

Expected: FAIL because the `Theme` button is not present in the onboarding layout.

- [ ] **Step 3: Write minimal implementation**

Update `apps/webapp/src/app/[locale]/onboarding/layout.tsx`:

```tsx
import { ThemeToggle } from "@/components/theme-toggle";

<div className="flex items-center justify-end gap-2 drop-shadow-sm">
	<ThemeToggle />
	<LanguageSwitcher />
</div>
```

- [ ] **Step 4: Run focused verification**

Run: `./node_modules/.bin/vitest run 'src/app/[locale]/onboarding/layout.test.tsx'`

Expected: PASS with 1 test passing.

- [ ] **Step 5: Run typecheck**

Run: `./node_modules/.bin/tsc --noEmit --pretty false`

Expected: exit 0.

## Self-Review

- Spec coverage: covers the approved request to add the theme toggle beside the language switcher.
- Placeholder scan: no placeholders.
- Type consistency: uses existing `ThemeToggle` component and current test patterns.
