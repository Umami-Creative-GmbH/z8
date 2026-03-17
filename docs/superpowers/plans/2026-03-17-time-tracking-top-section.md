# Time Tracking Top Section Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the `/time-tracking` top section into a calm staged action panel with a required radio-card work-location input, lighter supporting summaries, and clearer history states.

**Architecture:** Keep the existing `ClockInOutWidget` and `useClockInOutWidget` orchestration intact, but split the redesign into a small shared work-location model, a dedicated radio-card input component, and a top-panel composition refresh. Preserve all existing clock-in/out and compliance behavior, then rebalance the summary and history surfaces underneath without widening scope into backend or table architecture changes.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Radix UI, Tailwind CSS v4, Tolgee/next-intl, Vitest, Testing Library

---

## File map

- Create: `apps/webapp/src/components/time-tracking/work-location.ts`
  - Shared work-location constants, type guards, and remembered-value normalization.
- Create: `apps/webapp/src/components/time-tracking/work-location.test.ts`
  - Unit coverage for remembered-value normalization.
- Create: `apps/webapp/src/components/time-tracking/work-location-field.tsx`
  - Semantic radio-card selector with visible label, helper copy, and responsive grid.
- Create: `apps/webapp/src/components/time-tracking/work-location-field.test.tsx`
  - Interaction and accessibility coverage for the new selector.
- Create: `apps/webapp/src/components/time-tracking/clock-in-out-widget.test.tsx`
  - State-level coverage for staged panel rendering and inline failure/blocking states.
- Create: `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`
  - Focused coverage for the redesigned history header and empty state.
- Create: `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`
  - Focused coverage for the quieter summary strip and emphasized `Today` item.
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`
  - Consume the shared work-location normalization helper.
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`
  - Recompose the top panel around staged sections and inline status/error surfaces.
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`
  - Remove the old toggle selector, keep focused session/button/notes pieces, and add any small supporting presentation helpers needed by the staged panel.
- Modify: `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`
  - Reduce summary visual weight and make `Today` the strongest item.
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table.tsx`
  - Improve section header hierarchy and empty-state guidance.
- Modify: `apps/webapp/messages/timeTracking/en.json`
- Modify: `apps/webapp/messages/timeTracking/de.json`
- Modify: `apps/webapp/messages/timeTracking/es.json`
- Modify: `apps/webapp/messages/timeTracking/fr.json`
- Modify: `apps/webapp/messages/timeTracking/it.json`
- Modify: `apps/webapp/messages/timeTracking/pt.json`
  - Add explicit work-location and top-panel copy instead of relying on fallback literals.

## Implementation notes

- Follow the spec in `docs/superpowers/specs/2026-03-17-time-tracking-top-section-design.md` exactly.
- Keep data flow and mutation calls unchanged; this is a UI and local-state redesign.
- Prefer composition over boolean prop growth. If the top panel needs more structure, introduce small presentational helpers rather than adding more mode flags.
- Keep client payloads minimal and avoid introducing new client-side data fetching.
- Use semantic radio controls, not clickable `div`s.
- Keep motion sparse and respect reduced-motion behavior.

### Task 1: Stabilize work-location state

**Files:**
- Create: `apps/webapp/src/components/time-tracking/work-location.ts`
- Create: `apps/webapp/src/components/time-tracking/work-location.test.ts`
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`

- [ ] **Step 1: Write the failing normalization test**

```ts
import { describe, expect, it } from "vitest";
import { normalizeWorkLocationType } from "./work-location";

describe("normalizeWorkLocationType", () => {
	it("falls back to office for missing or invalid remembered values", () => {
		expect(normalizeWorkLocationType(undefined)).toBe("office");
		expect(normalizeWorkLocationType(null)).toBe("office");
		expect(normalizeWorkLocationType("train")).toBe("office");
	});

	it("preserves supported work locations", () => {
		expect(normalizeWorkLocationType("home")).toBe("home");
		expect(normalizeWorkLocationType("field")).toBe("field");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location.test.ts`
Expected: FAIL because `work-location.ts` and `normalizeWorkLocationType` do not exist yet.

- [ ] **Step 3: Add the shared work-location model**

```ts
export const WORK_LOCATION_TYPES = ["office", "home", "field", "other"] as const;

export type WorkLocationType = (typeof WORK_LOCATION_TYPES)[number];

export const DEFAULT_WORK_LOCATION_TYPE: WorkLocationType = "office";

export function isWorkLocationType(value: string): value is WorkLocationType {
	return WORK_LOCATION_TYPES.includes(value as WorkLocationType);
}

export function normalizeWorkLocationType(value: string | null | undefined): WorkLocationType {
	if (!value) {
		return DEFAULT_WORK_LOCATION_TYPE;
	}

	return isWorkLocationType(value) ? value : DEFAULT_WORK_LOCATION_TYPE;
}
```

- [ ] **Step 4: Wire the hook through the shared helper**

```ts
function getInitialWorkLocationType(): WorkLocationType {
	if (typeof window === "undefined") {
		return DEFAULT_WORK_LOCATION_TYPE;
	}

	return normalizeWorkLocationType(localStorage.getItem("z8-work-location-type"));
}
```

- [ ] **Step 5: Re-run the focused test**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/time-tracking/work-location.ts apps/webapp/src/components/time-tracking/work-location.test.ts apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx
git commit -m "refactor: normalize time tracking work location state"
```

### Task 2: Replace the toggle with a radio-card field

**Files:**
- Create: `apps/webapp/src/components/time-tracking/work-location-field.tsx`
- Create: `apps/webapp/src/components/time-tracking/work-location-field.test.tsx`

- [ ] **Step 1: Write the failing interaction test**

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkLocationField } from "./work-location-field";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

describe("WorkLocationField", () => {
	it("renders a labeled radio group and changes selection", () => {
		const onChange = vi.fn();

		render(<WorkLocationField value="office" onChange={onChange} />);

		expect(screen.getByText("Where are you working today?")).toBeTruthy();
		expect(screen.getByText("This helps apply the right attendance and compliance rules.")).toBeTruthy();

		fireEvent.click(screen.getByRole("radio", { name: /home/i }));
		expect(onChange).toHaveBeenCalledWith("home");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location-field.test.tsx`
Expected: FAIL because `WorkLocationField` does not exist yet.

- [ ] **Step 3: Implement the field as a semantic radio-card group**

```tsx
<div className="grid gap-3">
	<div className="grid gap-1">
		<h3 className="font-medium text-sm">{t("timeTracking.workLocationLegend", "Where are you working today?")}</h3>
		<p className="text-muted-foreground text-sm">
			{t("timeTracking.workLocationHelp", "This helps apply the right attendance and compliance rules.")}
		</p>
	</div>
	<RadioGroup
		value={value}
		onValueChange={(next) => onChange(normalizeWorkLocationType(next))}
		className="grid grid-cols-2 gap-3 xl:grid-cols-4"
	>
		{options.map((option) => (
			<label key={option.value} className="group rounded-xl border p-3">
				<RadioGroupItem value={option.value} aria-label={option.label} className="sr-only" />
				<option.icon className="size-4" aria-hidden="true" />
				<span className="font-medium text-sm">{option.label}</span>
			</label>
		))}
	</RadioGroup>
</div>
```

- [ ] **Step 4: Add one more focused assertion for visible labels at narrow layouts**

Add to the same test file:

```tsx
it("keeps all option labels visible", () => {
	render(<WorkLocationField value="office" onChange={() => {}} />);
	expect(screen.getByText("Office")).toBeTruthy();
	expect(screen.getByText("Home")).toBeTruthy();
	expect(screen.getByText("Field")).toBeTruthy();
	expect(screen.getByText("Other")).toBeTruthy();
});

it("supports keyboard navigation across the radio options", () => {
	render(<WorkLocationField value="office" onChange={() => {}} />);
	screen.getByRole("radio", { name: /office/i }).focus();
	fireEvent.keyDown(screen.getByRole("radio", { name: /office/i }), { key: "ArrowRight" });
	expect(screen.getByRole("radio", { name: /home/i })).toBeChecked();
});
```

- [ ] **Step 5: Re-run the focused test file**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location-field.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/time-tracking/work-location-field.tsx apps/webapp/src/components/time-tracking/work-location-field.test.tsx
git commit -m "feat: add staged work location field"
```

### Task 3: Recompose the top card into a staged action panel

**Files:**
- Create: `apps/webapp/src/components/time-tracking/clock-in-out-widget.test.tsx`
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`

- [ ] **Step 1: Write the failing widget-state tests**

Cover these cases in `clock-in-out-widget.test.tsx`:

```tsx
it("shows the staged clocked-out panel", () => {
	// mock useClockInOutWidget with isClockedIn false
	expect(screen.getByText("Ready to Start")).toBeTruthy();
	expect(screen.getByText("Where are you working today?")).toBeTruthy();
	expect(screen.getByRole("button", { name: /clock in/i })).toBeTruthy();
});

it("keeps blocking compliance feedback inline above the action", () => {
	// mock canClockIn false + restPeriodEnforcement block
	expect(screen.getByText(/rest period/i)).toBeTruthy();
});

it("shows the current-session panel when clocked in", () => {
	// mock isClockedIn true + activeWorkPeriod
	expect(screen.getByText("Current Session")).toBeTruthy();
	expect(screen.getByText(/started at/i)).toBeTruthy();
});

it("keeps the panel stable during a mutation", () => {
	// mock isMutating true + isClockingOut false
	expect(screen.getByText(/clocking in/i)).toBeTruthy();
	expect(screen.getByText("Where are you working today?")).toBeTruthy();
});

it("keeps the current-session panel stable while clocking out", () => {
	// mock isMutating true + isClockingOut true + isClockedIn true
	expect(screen.getByText(/clocking out/i)).toBeTruthy();
	expect(screen.getByText("Current Session")).toBeTruthy();
});

it("preserves the selected work location when an inline failure is shown", () => {
	// mock local error state or widget error prop after failed clock-in
	expect(screen.getByText(/failed to clock in/i)).toBeTruthy();
	expect(screen.getByRole("radio", { name: /home/i })).toBeChecked();
});

it("keeps the current-session context visible after a clock-out failure", () => {
	// mock local error state or widget error prop after failed clock-out
	expect(screen.getByText(/failed to clock out/i)).toBeTruthy();
	expect(screen.getByText("Current Session")).toBeTruthy();
});

it("keeps the post-clock-out notes flow inside the same panel", () => {
	// mock showNotesInput true
	expect(screen.getByText(/add a note about your work/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run the widget tests to verify they fail**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-out-widget.test.tsx`
Expected: FAIL because the current widget still renders the old generic header and toggle flow.

- [ ] **Step 3: Recompose `ClockInOutWidget` around explicit staged sections**

Implement a structure like:

```tsx
<Card className="@container/widget">
	<CardContent className="flex flex-col gap-5 py-6">
		<PanelHeader
			title={widget.isClockedIn ? t("timeTracking.currentSessionTitle", "Current Session") : t("timeTracking.readyTitle", "Ready to Start")}
			description={widget.isClockedIn ? t("timeTracking.currentSessionSubtitle", "You're currently clocked in") : t("timeTracking.readySubtitle", "Confirm your work location, then start your shift.")}
		/>

		{!widget.isClockedIn && !widget.uiState.showNotesInput ? (
			<WorkLocationField value={widget.uiState.workLocationType} onChange={widget.setWorkLocationType} />
		) : null}

		<ClockActionButton ... />
	</CardContent>
</Card>
```

- [ ] **Step 4: Keep widget parts focused instead of adding boolean modes**

Refactor toward explicit small helpers, for example:

```tsx
export function PanelHeader({ title, description }: { title: string; description: string }) {
	return (
		<div className="grid gap-1">
			<h2 className="font-semibold text-lg">{title}</h2>
			<p className="text-muted-foreground text-sm">{description}</p>
		</div>
	);
}
```

Do not solve the redesign by adding more booleans to one oversized component.

- [ ] **Step 5: Add inline failure and blocking surfaces without changing mutation behavior**

Preserve toasts, but also render nearby feedback when the mocked widget state indicates:

```tsx
{!widget.canClockIn && widget.restPeriodEnforcement === "block" ? (
	<RestPeriodBlocker ... />
) : null}
```

If implementation needs local UI error state for failed clock-in/out, keep it local to the widget and do not change the server contract.

Clock-out failures must preserve the current-session panel and its context in the same way clock-in failures preserve the selected work-location state.

- [ ] **Step 6: Re-run the widget tests**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-out-widget.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget.test.tsx
git commit -m "feat: redesign time tracking staged action panel"
```

### Task 4: Demote supporting surfaces and promote explicit copy

**Files:**
- Create: `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`
- Modify: `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table.tsx`
- Create: `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`
- Modify: `apps/webapp/messages/timeTracking/en.json`
- Modify: `apps/webapp/messages/timeTracking/de.json`
- Modify: `apps/webapp/messages/timeTracking/es.json`
- Modify: `apps/webapp/messages/timeTracking/fr.json`
- Modify: `apps/webapp/messages/timeTracking/it.json`
- Modify: `apps/webapp/messages/timeTracking/pt.json`

- [ ] **Step 1: Write the failing summary and history tests**

Create `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx` with a focused assertion that the `Today` card is rendered as the emphasized variant:

```tsx
/* @vitest-environment jsdom */

expect(screen.getByTestId("summary-card-today")).toHaveAttribute("data-emphasis", "primary");
expect(screen.getByTestId("summary-card-this-week")).toHaveAttribute("data-emphasis", "secondary");
```

Create `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx` with focused assertions for the redesigned title and empty-state guidance:

```tsx
/* @vitest-environment jsdom */

expect(screen.getByText("No entries yet today.")).toBeTruthy();
expect(screen.getByText("Clock in to start tracking your time.")).toBeTruthy();
expect(screen.getByText("Recent Time Entries")).toBeTruthy();
```

- [ ] **Step 2: Run the relevant test files to verify they fail**

Run: `pnpm --filter webapp test -- src/components/time-tracking/weekly-summary-cards.test.tsx src/components/time-tracking/time-entries-table.test.tsx`
Expected: FAIL because the old summary structure and history copy are still in place.

- [ ] **Step 3: Lighten the summary treatment without changing the data model**

Adjust `weekly-summary-cards.tsx` toward a quieter strip, for example:

```tsx
<div className="grid grid-cols-1 gap-3 px-4 lg:px-6 @xl/main:grid-cols-3">
	<SummaryCard emphasized label={t("timeTracking.summary.today", "Today")} ... />
	<SummaryCard label={t("timeTracking.summary.thisWeek", "This Week")} ... />
	<SummaryCard label={t("timeTracking.summary.thisMonth", "This Month")} ... />
</div>
```

Use explicit variant props like `emphasized` only if they represent real design roles; avoid generic style booleans that multiply over time.

Expose the chosen hierarchy in the DOM so the test can verify it, for example:

```tsx
<Card data-testid="summary-card-today" data-emphasis={emphasized ? "primary" : "secondary"}>
```

- [ ] **Step 4: Update the history header and empty state copy**

Target changes:

```tsx
<CardTitle>{t("timeTracking.table.title", "Recent Time Entries")}</CardTitle>

emptyMessage={t(
	"timeTracking.table.emptyState",
	"No entries yet today. Clock in to start tracking your time.",
)}
```

Keep the manual entry action available, but visually secondary.

- [ ] **Step 5: Add explicit translation keys in every locale file**

At minimum add keys for:

```json
{
	"readyTitle": "Ready to Start",
	"readySubtitle": "Confirm your work location, then start your shift.",
	"currentSessionTitle": "Current Session",
	"currentSessionSubtitle": "You're currently clocked in",
	"workLocationLegend": "Where are you working today?",
	"workLocationHelp": "This helps apply the right attendance and compliance rules.",
	"workLocationOffice": "Office",
	"workLocationHome": "Home",
	"workLocationField": "Field",
	"workLocationOther": "Other"
}
```

Do not leave these as fallback-only English literals.

- [ ] **Step 6: Re-run the targeted tests**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location.test.ts src/components/time-tracking/work-location-field.test.tsx src/components/time-tracking/clock-in-out-widget.test.tsx src/components/time-tracking/weekly-summary-cards.test.tsx src/components/time-tracking/time-entries-table.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx apps/webapp/src/components/time-tracking/time-entries-table.tsx apps/webapp/src/components/time-tracking/time-entries-table.test.tsx apps/webapp/messages/timeTracking/en.json apps/webapp/messages/timeTracking/de.json apps/webapp/messages/timeTracking/es.json apps/webapp/messages/timeTracking/fr.json apps/webapp/messages/timeTracking/it.json apps/webapp/messages/timeTracking/pt.json
git commit -m "feat: polish time tracking supporting surfaces"
```

### Task 5: Verify quality gates and ship-readiness

**Files:**
- No new product files expected

- [ ] **Step 1: Run the full relevant webapp test suite slice**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location.test.ts src/components/time-tracking/work-location-field.test.tsx src/components/time-tracking/clock-in-out-widget.test.tsx src/components/time-tracking/weekly-summary-cards.test.tsx src/components/time-tracking/time-entries-table.test.tsx`
Expected: PASS

- [ ] **Step 2: Run the webapp build**

Run: `pnpm --filter webapp build`
Expected: PASS

- [ ] **Step 3: Review the implementation against required quality skills**

Run the following reviews before claiming completion:

- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `web-design-guidelines`

Specifically confirm:

- no unnecessary client data fetching or bundle growth
- no new boolean-prop sprawl in the top panel
- semantic radio controls and visible focus states
- visible labels on all work-location options
- operational hierarchy remains stronger than the summary strip

- [ ] **Step 4: Perform manual responsive QA**

Verify in the browser:

- clocked out on mobile
- clocked out on desktop
- clocked in state
- post-clock-out notes state
- blocked rest-period state
- light and dark themes
- keyboard navigation across the work-location radios and the primary action

- [ ] **Step 5: Final commit**

```bash
git add apps/webapp/src/components/time-tracking apps/webapp/messages/timeTracking
git commit -m "feat: redesign time tracking top section"
```
