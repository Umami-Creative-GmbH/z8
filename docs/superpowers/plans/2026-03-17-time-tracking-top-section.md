# Time Tracking Top Section Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current tile-like work-location setup with a professional inline clock-in confirmation flow where location is visible, editable, and secondary to the main `Clock In` action.

**Architecture:** Keep `ClockInOutWidget` and `useClockInOutWidget` as the page orchestrators, but change the state model from “location always selected before action” to “location context may be remembered, missing, editable, or locked while submitting.” Build a compact inline clock-in row with a small attached location editor, then recompose the top section around that interaction while keeping compliance, notes, summaries, and history behavior intact.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Radix UI, Tailwind CSS v4, Tolgee/next-intl, Vitest, Testing Library

---

## Execution context

- Execute this plan in the dedicated worktree at `/home/kai/projekte/z8/.worktrees/time-tracking-top-section`.
- That worktree already contains provisional files from the discarded radio-card attempt, including `work-location.ts`, `work-location-field.tsx`, and related tests.
- Rework those provisional files in place or delete them as noted below; do not assume a pristine pre-feature tree.

## File map

- Modify: `apps/webapp/src/components/time-tracking/work-location.ts`
  - Change remembered-location handling to support `null`/required state, centralize inline location copy helpers, and encode the shared page/shell state contract.
- Modify: `apps/webapp/src/components/time-tracking/work-location.test.ts`
  - Cover missing/invalid remembered values, shared clock-in states, and inline copy helpers.
- Create: `apps/webapp/src/components/time-tracking/clock-in-action-row.tsx`
  - Primary inline clock-in row that shows the action, current location context, `Change` affordance, and inline blocked/warning next steps.
- Create: `apps/webapp/src/components/time-tracking/clock-in-action-row.test.tsx`
  - Focused coverage for remembered location, required location, edit toggle, selection, and submit-lock states.
- Create: `apps/webapp/src/components/time-tracking/work-location-inline-picker.tsx`
  - Compact attached location editor using semantic single-select controls.
- Delete: `apps/webapp/src/components/time-tracking/work-location-field.tsx`
- Delete: `apps/webapp/src/components/time-tracking/work-location-field.test.tsx`
  - Remove the radio-card grid pattern that no longer fits the approved design.
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`
  - Support nullable location state, derived clock-in row state, inline editing state, locked submission behavior, and inline blocked/warning row behavior.
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`
  - Replace the large location field with the inline clock-in row and keep blocked/error/notes/session continuity.
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`
  - Keep session, action, notes, and feedback pieces focused; add small row/status helpers only if needed.
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.test.tsx`
  - Re-target top-level tests to the approved inline confirmation flow.
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.tsx` (verification-only or tiny copy/helper alignment)
  - Do not redesign the shell quick clock-in, but verify it does not conflict with the shared state/language contract and only apply minimal helper reuse if truly needed.
- Modify: `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`
  - Keep summaries subordinate to the top action surface.
- Modify: `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`
  - Verify summaries remain secondary after the top-section rework.
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx`
  - Adjust page composition only if spacing/hierarchy needs tightening after the new row lands.
- Modify: `apps/webapp/messages/timeTracking/en.json`
- Modify: `apps/webapp/messages/timeTracking/de.json`
- Modify: `apps/webapp/messages/timeTracking/es.json`
- Modify: `apps/webapp/messages/timeTracking/fr.json`
- Modify: `apps/webapp/messages/timeTracking/it.json`
- Modify: `apps/webapp/messages/timeTracking/pt.json`
  - Add explicit inline clock-in/location copy such as `from {location}`, `Change`, and `Location Required`.

## Implementation notes

- Follow `docs/superpowers/specs/2026-03-17-time-tracking-top-section-design.md` exactly.
- Keep shell quick clock-in out of scope for this phase; do not redesign `time-clock-popover.tsx` here.
- Still encode the shared interaction contract in shared helpers/state so the page implementation is the source of truth for: visible current location, `Change`, and locked pending state.
- If `time-clock-popover.tsx` needs a tiny text/helper alignment to avoid contradictory language, that is allowed; structural redesign is not.
- Prefer focused components over more boolean props on `ClockInOutWidget`.
- Keep location editing compact and temporary; avoid tabs, tile grids, segmented controls, or large cards.
- Preserve existing mutation contracts and compliance logic.

### Task 1: Rework work-location state for inline confirmation

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/work-location.ts`
- Modify: `apps/webapp/src/components/time-tracking/work-location.test.ts`
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`

- [ ] **Step 1: Write the failing state-model test**

```ts
import { describe, expect, it } from "vitest";
import {
	formatWorkLocationContext,
	normalizeRememberedWorkLocationType,
} from "./work-location";

describe("normalizeRememberedWorkLocationType", () => {
	it("returns null when no remembered location exists", () => {
		expect(normalizeRememberedWorkLocationType(null)).toBeNull();
		expect(normalizeRememberedWorkLocationType(undefined)).toBeNull();
	});

	it("returns null for invalid remembered values", () => {
		expect(normalizeRememberedWorkLocationType("train")).toBeNull();
	});

	it("preserves valid remembered values", () => {
		expect(normalizeRememberedWorkLocationType("home")).toBe("home");
	});
});

describe("formatWorkLocationContext", () => {
	it("formats remembered locations for inline display", () => {
		expect(formatWorkLocationContext("home")).toEqual({ labelKey: "timeTracking.workLocationHome", fallback: "Home" });
	});
});

describe("getClockInInteractionState", () => {
	it("encodes the shared ready/required/editing/submitting/clocked-in states", () => {
		expect(getClockInInteractionState({ isClockedIn: false, isEditing: false, isSubmitting: false, workLocationType: "office" })).toBe("ready");
		expect(getClockInInteractionState({ isClockedIn: false, isEditing: false, isSubmitting: false, workLocationType: null })).toBe("location-required");
		expect(getClockInInteractionState({ isClockedIn: false, isEditing: true, isSubmitting: false, workLocationType: "office" })).toBe("editing-location");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location.test.ts`
Expected: FAIL because the current helper still normalizes missing/invalid values to `office` and does not expose inline-context helpers.

- [ ] **Step 3: Implement the nullable remembered-location model**

Add/update code like:

```ts
export type WorkLocationSelection = WorkLocationType | null;

export type ClockInInteractionState =
	| "ready"
	| "location-required"
	| "editing-location"
	| "submitting"
	| "clocked-in";

export function normalizeRememberedWorkLocationType(
	value: string | null | undefined,
): WorkLocationSelection {
	if (!value) return null;
	return isWorkLocationType(value) ? value : null;
}

export function formatWorkLocationContext(value: WorkLocationType) {
	return WORK_LOCATION_META[value];
}

export function getClockInInteractionState(...) { ... }
```

- [ ] **Step 4: Update widget state to use `WorkLocationSelection`**

Change the hook initialization pattern to preserve `null` when there is no valid remembered value:

```ts
function getInitialWorkLocationType(): WorkLocationSelection {
	if (typeof window === "undefined") {
		return null;
	}

	return normalizeRememberedWorkLocationType(localStorage.getItem("z8-work-location-type"));
}
```

Also add derived state for the approved clock-in row contract, for example:

```ts
const hasSelectedWorkLocation = uiState.workLocationType !== null;
	const isEditingWorkLocation = uiState.isEditingWorkLocation;
	const isClockInSubmitLocked = timeClock.isMutating && !timeClock.isClockingOut;
	const clockInInteractionState = getClockInInteractionState(...);
```

- [ ] **Step 5: Re-run the focused state test**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/time-tracking/work-location.ts apps/webapp/src/components/time-tracking/work-location.test.ts apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx
git commit -m "refactor: support inline work location confirmation"
```

### Task 2: Build the inline clock-in row and compact location editor

**Files:**
- Create: `apps/webapp/src/components/time-tracking/clock-in-action-row.tsx`
- Create: `apps/webapp/src/components/time-tracking/clock-in-action-row.test.tsx`
- Create: `apps/webapp/src/components/time-tracking/work-location-inline-picker.tsx`
- Delete: `apps/webapp/src/components/time-tracking/work-location-field.tsx`
- Delete: `apps/webapp/src/components/time-tracking/work-location-field.test.tsx`

- [ ] **Step 1: Write the failing row interaction test**

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClockInActionRow } from "./clock-in-action-row";

describe("ClockInActionRow", () => {
	it("shows remembered location inline with the clock-in action", () => {
		render(
			<ClockInActionRow
				workLocationType="home"
				isEditing={false}
				isSubmitting={false}
				onClockIn={() => {}}
				onStartEditing={() => {}}
				onSelectWorkLocation={() => {}}
			/>,
		);

		expect(screen.getByRole("button", { name: /clock in/i })).toBeTruthy();
		expect(screen.getByText("from Home")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
	});

	it("shows location required and disables clock in when nothing is selected", () => {
		render(
			<ClockInActionRow
				workLocationType={null}
				isEditing={false}
				isSubmitting={false}
				onClockIn={() => {}}
				onStartEditing={() => {}}
				onSelectWorkLocation={() => {}}
			/>,
		);

		expect(screen.getByText("Location Required")).toBeTruthy();
		expect(screen.getByRole("button", { name: /clock in/i })).toBeDisabled();
	});

	it("opens the compact location editor from the change action", () => {
		const onStartEditing = vi.fn();
		render(<ClockInActionRow workLocationType="office" isEditing={false} isSubmitting={false} onClockIn={() => {}} onStartEditing={onStartEditing} onSelectWorkLocation={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Change" }));
		expect(onStartEditing).toHaveBeenCalledTimes(1);
	});

	it("keeps the selected location visible and swaps the primary action for the blocking next step", () => {
		render(
			<ClockInActionRow
				workLocationType="office"
				isEditing={false}
				isSubmitting={false}
				blockedMessage="Rest period not complete"
				onRequestException={() => {}}
				onClockIn={() => {}}
				onStartEditing={() => {}}
				onSelectWorkLocation={() => {}}
			/>,
		);

		expect(screen.getByText("from Office")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /clock in/i })).toBeNull();
		expect(screen.getByRole("button", { name: /request exception/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the row test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-action-row.test.tsx`
Expected: FAIL because the inline action row does not exist yet.

- [ ] **Step 3: Implement the compact location editor and inline row**

Use a text-first, attached editor instead of a tile grid. The row should look conceptually like:

```tsx
<div className="rounded-xl border bg-card p-4">
	<div className="flex items-center justify-between gap-3">
		<Button onClick={onClockIn} disabled={!workLocationType || isSubmitting}>Clock In</Button>
		<div className="flex items-center gap-2 text-sm">
			<span>{workLocationType ? t("timeTracking.clockInFrom", "from {location}", { location }) : t("timeTracking.locationRequired", "Location Required")}</span>
			<Button variant="ghost" size="sm" onClick={onStartEditing}>Change</Button>
		</div>
	</div>
	{isEditing ? <WorkLocationInlinePicker ... /> : null}
</div>
```

The picker should use semantic single-select controls and close naturally after selection.

Blocked and warning messaging should render inside the same action surface, not as a detached card below it.

- [ ] **Step 4: Add focused tests for selection and submit-locking**

Extend the same test file with:

```tsx
it("updates the selected location from the compact editor", () => {
	const onSelectWorkLocation = vi.fn();
	render(<ClockInActionRow workLocationType="office" isEditing onClockIn={() => {}} onStartEditing={() => {}} onSelectWorkLocation={onSelectWorkLocation} isSubmitting={false} />);
	fireEvent.click(screen.getByRole("radio", { name: "Home" }));
	expect(onSelectWorkLocation).toHaveBeenCalledWith("home");
});

it("keeps the submitted location visible and locks editing while submitting", () => {
	render(<ClockInActionRow workLocationType="field" isEditing={false} isSubmitting onClockIn={() => {}} onStartEditing={() => {}} onSelectWorkLocation={() => {}} />);
	expect(screen.getByText("from Field")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
});
```

- [ ] **Step 5: Re-run the focused row tests**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-action-row.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/time-tracking/clock-in-action-row.tsx apps/webapp/src/components/time-tracking/clock-in-action-row.test.tsx apps/webapp/src/components/time-tracking/work-location-inline-picker.tsx apps/webapp/src/components/time-tracking/work-location-field.tsx apps/webapp/src/components/time-tracking/work-location-field.test.tsx
git commit -m "feat: add inline clock-in action row"
```

### Task 3: Recompose `ClockInOutWidget` around the new flow

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.test.tsx`

- [ ] **Step 1: Rewrite the failing widget tests to match the approved flow**

Replace the old field-centric expectations with these states:

```tsx
it("shows a single clock-in row with visible current location", () => {
	// mock remembered location = home
	expect(screen.getByText("Ready to Start")).toBeTruthy();
	expect(screen.getByText("from Home")).toBeTruthy();
	expect(screen.queryByRole("radiogroup", { name: /where are you working/i })).toBeNull();
});

it("shows location required when nothing is remembered", () => {
	// mock workLocationType = null
	expect(screen.getByText("Location Required")).toBeTruthy();
	expect(screen.getByRole("button", { name: /clock in/i })).toBeDisabled();
});

	it("keeps blocked compliance feedback inside the same action surface", () => {
		// mock blocked state
		expect(screen.getByText(/rest period/i)).toBeTruthy();
		expect(screen.getByText("from Office")).toBeTruthy();
		expect(screen.getByRole("button", { name: /request exception/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
	});
```

- [ ] **Step 2: Run the widget tests to verify they fail**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-out-widget.test.tsx`
Expected: FAIL because the widget still renders the old standalone location selector.

- [ ] **Step 3: Recompose the widget around `ClockInActionRow`**

Refactor toward:

```tsx
{!widget.isClockedIn && !widget.uiState.showNotesInput ? (
	<ClockInActionRow
		workLocationType={widget.uiState.workLocationType}
		isEditing={widget.uiState.isEditingWorkLocation}
		isSubmitting={widget.isClockInSubmitLocked}
		onClockIn={widget.handleClockIn}
		onStartEditing={widget.startEditingWorkLocation}
		onSelectWorkLocation={widget.setWorkLocationType}
		onCloseEditing={widget.stopEditingWorkLocation}
		t={widget.t}
	/>
) : null}
```

Keep the header, current-session summary, compliance surfaces, and notes flow in the same card.

- [ ] **Step 4: Normalize blocked and error states inside the hook**

Avoid pushing too much state logic into the component. Add hook-level derived values like:

```ts
const clockInRowStatus = hasSelectedWorkLocation ? "ready" : "location-required";
const isClockInSubmitLocked = timeClock.isMutating && !timeClock.isClockingOut;
```

Blocked and warning states should still allow location edits unless the policy truly forbids them.

The row API should make that explicit, for example:

```tsx
<ClockInActionRow
	blockedMessage={widget.blockedClockInMessage}
	warningMessage={widget.warningClockInMessage}
	onRequestException={widget.handleRequestException}
	...
/>
```

- [ ] **Step 5: Preserve continuity for clocked-in and post-clock-out states**

Keep these expectations true:

```tsx
expect(screen.getByText("Current Session")).toBeTruthy();
expect(screen.getByText("Shift Complete")).toBeTruthy();
expect(screen.queryByText("Ready to Start")).toBeNull();
```

Do not regress the labeled notes field or inline action-error handling.

- [ ] **Step 6: Re-run the widget tests**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-out-widget.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget.test.tsx
git commit -m "feat: align time tracking top section with inline clock-in flow"
```

### Task 4: Update copy, hierarchy, and supporting surfaces

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`
- Modify: `apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.tsx` (only if tiny contract-alignment copy/helper reuse is needed)
- Modify: `apps/webapp/messages/timeTracking/en.json`
- Modify: `apps/webapp/messages/timeTracking/de.json`
- Modify: `apps/webapp/messages/timeTracking/es.json`
- Modify: `apps/webapp/messages/timeTracking/fr.json`
- Modify: `apps/webapp/messages/timeTracking/it.json`
- Modify: `apps/webapp/messages/timeTracking/pt.json`

- [ ] **Step 0: Add a quick-clock-in contract guardrail**

Add or extend a test/helper assertion that locks the shared state/language model in `work-location.ts`, then manually compare `apps/webapp/src/components/time-tracking/time-clock-popover.tsx` against it during this task. Do not redesign the shell popover; only prevent contradictory language or state naming.

- [ ] **Step 1: Write the failing copy/hierarchy tests**

Add focused assertions for the new inline language and supporting hierarchy:

```tsx
expect(screen.getByText("from Home")).toBeTruthy();
expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
expect(screen.getByText("Location Required")).toBeTruthy();
```

Keep the summary test proving that `Today` remains the strongest supporting metric.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-out-widget.test.tsx src/components/time-tracking/weekly-summary-cards.test.tsx`
Expected: FAIL until the new copy keys and hierarchy land.

- [ ] **Step 3: Add explicit translation keys for the new action model**

At minimum add keys like:

```json
{
	"clockInFrom": "from {location}",
	"changeWorkLocation": "Change",
	"locationRequired": "Location Required",
	"locationRequiredHint": "Choose where you are working before clocking in."
}
```

Keep existing current-session, error, and notes keys intact.

- [ ] **Step 4: Tighten the top-of-page hierarchy if needed**

If the new clock-in row needs more breathing room, adjust `page.tsx` or `weekly-summary-cards.tsx` so the top action surface stays visually dominant without adding new layout complexity.

If the shell quick clock-in uses conflicting labels that would undermine the shared contract, apply only the smallest helper/copy alignment in `time-clock-popover.tsx` and stop there.

- [ ] **Step 5: Re-run the focused tests**

Run: `pnpm --filter webapp test -- src/components/time-tracking/clock-in-action-row.test.tsx src/components/time-tracking/clock-in-out-widget.test.tsx src/components/time-tracking/weekly-summary-cards.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx apps/webapp/src/components/time-tracking/weekly-summary-cards.test.tsx apps/webapp/src/components/time-tracking/time-clock-popover.tsx apps/webapp/messages/timeTracking/en.json apps/webapp/messages/timeTracking/de.json apps/webapp/messages/timeTracking/es.json apps/webapp/messages/timeTracking/fr.json apps/webapp/messages/timeTracking/it.json apps/webapp/messages/timeTracking/pt.json
git commit -m "feat: polish inline time tracking confirmation flow"
```

### Task 5: Verify the approved flow end to end

**Files:**
- No new product files expected

- [ ] **Step 1: Run the focused time-tracking test slice**

Run: `pnpm --filter webapp test -- src/components/time-tracking/work-location.test.ts src/components/time-tracking/clock-in-action-row.test.tsx src/components/time-tracking/clock-in-out-widget.test.tsx src/components/time-tracking/weekly-summary-cards.test.tsx src/components/time-tracking/time-entries-table.test.tsx src/app/[locale]/(app)/time-tracking/page-data.test.ts`
Expected: PASS

- [ ] **Step 2: Run the full webapp test suite**

Run: `pnpm --filter webapp test`
Expected: PASS

- [ ] **Step 3: Run the webapp build**

Run: `pnpm --filter webapp build`
Expected: PASS

- [ ] **Step 4: Review against required quality skills**

Check the final UI against:

- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `web-design-guidelines`

Specifically confirm:

- no location tile/grid UI remains in the page clock-in flow
- location is visible inline with the action in ready, required, blocked, and pending states
- `Change` is a real button and the attached editor is semantic single-select UI
- pending clock-in keeps the submitted location visible and locked
- summaries remain visibly secondary to the action surface
- `time-clock-popover.tsx` does not introduce contradictory state names or location language relative to the shared contract

- [ ] **Step 5: Manual QA in the browser**

Verify:

- remembered location -> one-click clock-in
- no remembered location -> disabled action + inline required state
- change location flow on desktop
- change location flow on mobile
- blocked compliance flow with inline exception handoff
- warning compliance flow with editable location
- clocked-in continuity
- post-clock-out notes continuity
- light and dark themes

- [ ] **Step 6: Final commit**

```bash
git add apps/webapp/src/components/time-tracking apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx apps/webapp/messages/timeTracking
git commit -m "feat: redesign time tracking clock-in confirmation flow"
```
