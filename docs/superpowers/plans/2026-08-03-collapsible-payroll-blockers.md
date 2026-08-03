# Collapsible Payroll Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/payroll` blocker notice collapsible and collapsed whenever the payroll workspace mounts, while leaving its blocker count visible.

**Architecture:** Wrap the existing blocker notice in the shared Base UI `Collapsible` primitives. The notice header becomes the trigger, the blocker list becomes the content, and Base UI owns the unpersisted open state and accessibility attributes; existing blocker data and action logic stay unchanged.

**Tech Stack:** React 19, Next.js 16, Base UI via Z8's `Collapsible` components, Tailwind CSS, Tabler Icons, Vitest, Testing Library

---

## File Structure

- Modify `apps/webapp/src/components/payroll/payroll-workspace.tsx`: turn `PayrollBlockersAlert` into a default-collapsed notice using the existing design-system primitives.
- Modify `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`: specify collapsed/expanded behavior and open the notice before existing blocker-row interactions.

### Task 1: Specify Default-Collapsed Interaction

**Files:**
- Test: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx:108-205`

- [ ] **Step 1: Add a reusable test helper**

Add this helper below `blockerSelector` so existing behavioral tests can explicitly reveal blocker controls:

```tsx
function expandPayrollBlockers() {
	const notice = document.querySelector(
		'[aria-labelledby="payroll-blockers-title"]',
	);
	expect(notice).toBeTruthy();
	const trigger = within(notice as HTMLElement).getByRole("button");
	fireEvent.click(trigger);
	return trigger;
}
```

- [ ] **Step 2: Write the failing collapsible behavior test**

Add this test after `renders summary cards, employee rows, period controls, and blockers`:

```tsx
it("collapses blocker rows by default and toggles them from the notice header", () => {
	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	const notice = screen.getByRole("region", {
		name: "2 payroll blockers need review",
	});
	const trigger = within(notice).getByRole("button", {
		name: "2 payroll blockers need review",
	});
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
	expect(within(notice).queryByText("Missing clock-out")).toBeNull();

	fireEvent.click(trigger);
	expect(trigger.getAttribute("aria-expanded")).toBe("true");
	expect(within(notice).getByText("Missing clock-out")).toBeTruthy();

	fireEvent.click(trigger);
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
	expect(within(notice).queryByText("Missing clock-out")).toBeNull();
});
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```bash
pnpm --filter webapp test -- src/components/payroll/payroll-workspace.test.tsx -t "collapses blocker rows by default"
```

Expected: FAIL because the notice has no button trigger and the blocker rows render immediately.

### Task 2: Implement the Collapsible Notice

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx:3-58,1272-1468`
- Test: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Import the shared collapsible primitives and chevron icon**

Add `IconChevronDown` to the existing Tabler import and add the UI import beside the other design-system imports:

```tsx
import {
	IconAlertTriangle,
	IconCalendarWeek,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconDownload,
	IconFileExport,
	IconLoader2,
	IconRefresh,
	IconUsers,
} from "@tabler/icons-react";
```

```tsx
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
```

- [ ] **Step 2: Focus the visible trigger instead of the former focus-only heading**

Rename the heading ref and target the trigger in `PayrollBlockersAlert`:

```tsx
const triggerRef = useRef<HTMLButtonElement | null>(null);
```

```tsx
const fallbackTarget = blockers.length === 0 ? fallbackFocusRef.current : triggerRef.current;
```

This keeps post-dismissal focus on an available, visible control without adding local state.

- [ ] **Step 3: Replace the notice shell with a default-collapsed structure**

Replace the current opening `<section>`, `<header>`, and `<ul>` markup before
`{blockers.map((blocker) => {` with:

```tsx
<Collapsible asChild>
	<section
		aria-labelledby="payroll-blockers-title"
		className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 text-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
	>
		<CollapsibleTrigger asChild>
			<button
				className="group flex w-full items-start gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				ref={triggerRef}
				type="button"
			>
				<IconAlertTriangle
					aria-hidden="true"
					className="mt-0.5 size-4 shrink-0"
				/>
				<h2
					className="min-w-0 flex-1 font-medium leading-none"
					id="payroll-blockers-title"
				>
					{title}
				</h2>
				<IconChevronDown
					aria-hidden="true"
					className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180"
				/>
			</button>
		</CollapsibleTrigger>
		<CollapsibleContent asChild>
			<ul className="mt-3 grid gap-2">
```

Leave the existing `blockers.map(...)` expression and blocker-row markup
unchanged. Replace the closing `</ul>` and `</section>` after the map with:

```tsx
			</ul>
		</CollapsibleContent>
	</section>
</Collapsible>
```

Do not pass `defaultOpen`, `open`, or `onOpenChange`; the shared primitive therefore starts collapsed on each mount and maintains state only for that mounted component.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter webapp test -- src/components/payroll/payroll-workspace.test.tsx -t "collapses blocker rows by default"
```

Expected: PASS.

- [ ] **Step 5: Adapt existing blocker-content tests to the intentional collapsed state**

Call `expandPayrollBlockers()` immediately after rendering in every test that reads or interacts with blocker rows. This includes the localized blocker rendering, clear controls, dismissal, concurrency, refresh, focus-management, fallback metadata, and employee-ID privacy tests. In the general rendering test, call it before the `Missing clock-out` assertion:

```tsx
expandPayrollBlockers();
expect(screen.getByText("Missing clock-out")).toBeTruthy();
```

Do not expand the notice in no-blocker tests or in the new default-collapsed test.

- [ ] **Step 6: Run the complete component test file**

Run:

```bash
pnpm --filter webapp test -- src/components/payroll/payroll-workspace.test.tsx
```

Expected: all `PayrollWorkspace` tests PASS. If a test cannot find a blocker row or action, add `expandPayrollBlockers()` after that test's render rather than weakening role queries or exposing collapsed content.

- [ ] **Step 7: Commit the tested component change**

```bash
git add apps/webapp/src/components/payroll/payroll-workspace.tsx apps/webapp/src/components/payroll/payroll-workspace.test.tsx
git commit -m "feat: collapse payroll blockers by default"
```

### Task 3: Verify the Frontend Change

**Files:**
- Verify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Verify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Run the webapp typecheck**

Run:

```bash
pnpm --filter webapp typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run React diagnostics for the modified component**

Use the repository's `react-doctor` skill against the changed React files and resolve any newly introduced actionable findings without refactoring unrelated code.

Expected: no new actionable diagnostic in `payroll-workspace.tsx` or its test.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff HEAD^ -- apps/webapp/src/components/payroll/payroll-workspace.tsx apps/webapp/src/components/payroll/payroll-workspace.test.tsx
```

Expected: only the collapsible notice, its focused tests, and test setup needed to expand blocker content are present; unrelated worktree changes remain untouched.
