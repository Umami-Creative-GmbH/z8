# Shadcn Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all native browser date inputs in `apps/webapp/src/components` with a reusable shadcn-style date picker while leaving time inputs unchanged.

**Architecture:** Add one focused `DatePicker` UI component that composes the existing shadcn `Button`, `Calendar`, and `Popover` primitives. The component uses a string boundary (`YYYY-MM-DD`) for normal form fields and callers adapt only the few existing `Date | null` fields at their edges. Existing forms, validation, server actions, and filter state remain unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, shadcn UI, Radix Popover, `react-day-picker`, Tabler icons, Luxon, TanStack Form, Vitest, Testing Library.

---

## File Structure

- Create: `apps/webapp/src/components/ui/date-picker.tsx` - reusable shadcn-style single-date picker with string input/output.
- Create: `apps/webapp/src/components/ui/date-picker.test.tsx` - focused tests for parsing, selecting, clearing, and max-date disabling.
- Modify: `apps/webapp/src/components/absences/request-absence-dialog.tsx` - replace start/end native date fields.
- Modify: `apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.tsx` - replace trip start/end date fields.
- Modify: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx` - replace manual entry date field and preserve max date.
- Modify: `apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx` - replace policy effective date fields.
- Modify: `apps/webapp/src/components/settings/surcharge-rule-editor.tsx` - replace `Date | null` surcharge fields with string adapters.
- Modify: `apps/webapp/src/components/settings/rate-history-card.tsx` - replace rate effective date field.
- Modify: `apps/webapp/src/components/settings/project-dialog.tsx` - replace project date field.
- Modify: `apps/webapp/src/components/settings/payroll-export/export-form.tsx` - replace payroll export date filters.
- Modify: `apps/webapp/src/components/settings/holiday-dialog.tsx` - replace holiday date fields.
- Modify: `apps/webapp/src/components/settings/employee-skills-card.tsx` - replace skill date field.
- Modify: `apps/webapp/src/components/settings/employee-employment-history-card.tsx` - replace employment date field.
- Modify: `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx` - replace import date range fields.
- Modify: `apps/webapp/src/components/settings/audit-log-viewer.tsx` - replace audit filter date fields.
- Modify: `apps/webapp/src/components/settings/audit-export/audit-pack-generator-card.tsx` - replace audit pack date fields.
- Modify: `apps/webapp/src/components/organization/invite-code-dialog.tsx` - replace invite expiry date field.

## Task 1: Add DatePicker Component And Tests

**Files:**
- Create: `apps/webapp/src/components/ui/date-picker.tsx`
- Create: `apps/webapp/src/components/ui/date-picker.test.tsx`

- [ ] **Step 1: Write the focused tests**

Create `apps/webapp/src/components/ui/date-picker.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DatePicker } from "./date-picker";

describe("DatePicker", () => {
	it("renders the placeholder when empty", () => {
		render(<DatePicker value="" onChange={() => {}} placeholder="Pick a work date" />);

		expect(screen.getByRole("button", { name: /pick a work date/i })).toBeInTheDocument();
	});

	it("formats an existing ISO date value", () => {
		render(<DatePicker value="2026-04-29" onChange={() => {}} />);

		expect(screen.getByRole("button", { name: /apr/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /2026/i })).toBeInTheDocument();
	});

	it("emits an empty string when cleared", () => {
		const onChange = vi.fn();
		render(<DatePicker value="2026-04-29" onChange={onChange} />);

		fireEvent.click(screen.getByRole("button", { name: /apr/i }));
		fireEvent.click(screen.getByRole("button", { name: /clear date/i }));

		expect(onChange).toHaveBeenCalledWith("");
	});

	it("does not expose a clear button when required", () => {
		render(<DatePicker value="2026-04-29" onChange={() => {}} required />);

		fireEvent.click(screen.getByRole("button", { name: /apr/i }));

		expect(screen.queryByRole("button", { name: /clear date/i })).not.toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail before implementation**

Run from `apps/webapp`:

```bash
pnpm test src/components/ui/date-picker.test.tsx
```

Expected: FAIL because `./date-picker` does not exist.

- [ ] **Step 3: Implement the reusable DatePicker**

Create `apps/webapp/src/components/ui/date-picker.tsx`:

```tsx
"use client";

import { IconCalendar, IconX } from "@tabler/icons-react";
import { DateTime } from "luxon";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> & {
	value?: string | null;
	onChange: (value: string) => void;
	placeholder?: string;
	min?: string;
	max?: string;
	onBlur?: () => void;
};

function parseDateOnly(value?: string | null): Date | undefined {
	if (!value) return undefined;
	const date = DateTime.fromISO(value, { zone: "local" });
	if (!date.isValid) return undefined;
	return new Date(date.year, date.month - 1, date.day);
}

function formatDateOnly(date: Date): string {
	return DateTime.fromObject(
		{ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() },
		{ zone: "local" },
	).toISODate() ?? "";
}

function formatDisplayDate(value?: string | null): string | undefined {
	if (!value) return undefined;
	const date = DateTime.fromISO(value, { zone: "local" });
	if (!date.isValid) return undefined;
	return date.toLocaleString(DateTime.DATE_MED);
}

function DatePicker({
	value,
	onChange,
	placeholder = "Pick a date",
	className,
	disabled,
	min,
	max,
	onBlur,
	required,
	...props
}: DatePickerProps) {
	const [open, setOpen] = React.useState(false);
	const selectedDate = parseDateOnly(value);
	const minDate = parseDateOnly(min);
	const maxDate = parseDateOnly(max);
	const displayDate = formatDisplayDate(value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					disabled={disabled}
					className={cn("w-full justify-start text-left font-normal", !displayDate && "text-muted-foreground", className)}
					{...props}
				>
					<IconCalendar className="size-4" />
					<span className="truncate">{displayDate ?? placeholder}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-0">
				<Calendar
					mode="single"
					selected={selectedDate}
					defaultMonth={selectedDate}
					disabled={(date) => Boolean((minDate && date < minDate) || (maxDate && date > maxDate))}
					onSelect={(date) => {
						if (!date) return;
						onChange(formatDateOnly(date));
						onBlur?.();
						setOpen(false);
					}}
				/>
				{!required && value ? (
					<div className="border-t p-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="w-full justify-start"
							onClick={() => {
								onChange("");
								onBlur?.();
								setOpen(false);
							}}
						>
							<IconX className="size-4" />
							Clear date
						</Button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

export { DatePicker, formatDateOnly, parseDateOnly };
```

- [ ] **Step 4: Run the focused tests**

Run from `apps/webapp`:

```bash
pnpm test src/components/ui/date-picker.test.tsx
```

Expected: PASS. If `toBeInTheDocument` matchers are not configured, change assertions to `expect(element).toBeTruthy()` and rerun.

## Task 2: Replace Simple String Date Fields In Dialog Forms

**Files:**
- Modify: `apps/webapp/src/components/absences/request-absence-dialog.tsx`
- Modify: `apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.tsx`
- Modify: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/rate-history-card.tsx`
- Modify: `apps/webapp/src/components/settings/project-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/holiday-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/employee-skills-card.tsx`
- Modify: `apps/webapp/src/components/settings/employee-employment-history-card.tsx`
- Modify: `apps/webapp/src/components/organization/invite-code-dialog.tsx`

- [ ] **Step 1: Import DatePicker in each file that has a simple string date field**

Add this import near the existing UI imports in each file listed above:

```tsx
import { DatePicker } from "@/components/ui/date-picker";
```

- [ ] **Step 2: Replace a normal string field pattern**

Replace this pattern:

```tsx
<Input
	type="date"
	name="date"
	autoComplete="off"
	value={field.state.value}
	onChange={(e) => field.handleChange(e.target.value)}
	onBlur={field.handleBlur}
	required
/>
```

With this pattern:

```tsx
<DatePicker
	name="date"
	value={field.state.value}
	onChange={field.handleChange}
	onBlur={field.handleBlur}
	required
/>
```

- [ ] **Step 3: Preserve max-date behavior in manual time entry**

In `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`, replace the native date input with:

```tsx
<DatePicker
	name="date"
	value={field.state.value}
	onChange={field.handleChange}
	onBlur={field.handleBlur}
	max={DateTime.now().setZone(employeeTimezone).toISODate() || undefined}
	required
/>
```

- [ ] **Step 4: Preserve min-date behavior in absence end date**

In `apps/webapp/src/components/absences/request-absence-dialog.tsx`, replace the end-date input with:

```tsx
<DatePicker
	name="endDate"
	value={field.state.value}
	onChange={field.handleChange}
	onBlur={field.handleBlur}
	min={values.startDate}
	required
/>
```

- [ ] **Step 5: Run a scoped search**

Run from `apps/webapp`:

```bash
pnpm exec rg 'type="date"' src/components/absences src/components/travel-expenses src/components/time-tracking src/components/settings/rate-history-card.tsx src/components/settings/project-dialog.tsx src/components/settings/holiday-dialog.tsx src/components/settings/employee-skills-card.tsx src/components/settings/employee-employment-history-card.tsx src/components/organization/invite-code-dialog.tsx
```

Expected: no matches in the files covered by this task, except files intentionally deferred to later tasks.

## Task 3: Replace Date Object Fields In Surcharge Rules

**Files:**
- Modify: `apps/webapp/src/components/settings/surcharge-rule-editor.tsx`

- [ ] **Step 1: Import DatePicker**

Add this import:

```tsx
import { DatePicker } from "@/components/ui/date-picker";
```

- [ ] **Step 2: Add local date conversion helpers**

Add these helpers near the other local helper functions in `surcharge-rule-editor.tsx`:

```tsx
function dateFieldToString(value: unknown): string {
	if (!value) return "";
	const date = value instanceof Date ? value : new Date(value as string);
	if (Number.isNaN(date.getTime())) return "";
	return DateTime.fromJSDate(date).toISODate() ?? "";
}

function stringToDateField(value: string): Date | null {
	return value ? DateTime.fromISO(value).toJSDate() : null;
}
```

If `DateTime` is not already imported in this file, add:

```tsx
import { DateTime } from "luxon";
```

- [ ] **Step 3: Replace the specific date field**

Replace the native input for `rules[${ruleIndex}].specificDate` with:

```tsx
<DatePicker
	value={dateFieldToString(field.state.value)}
	onChange={(value) => field.handleChange(stringToDateField(value))}
	onBlur={field.handleBlur}
/>
```

- [ ] **Step 4: Replace the date range start field**

Replace the native input for `rules[${ruleIndex}].dateRangeStart` with:

```tsx
<DatePicker
	value={dateFieldToString(field.state.value)}
	onChange={(value) => field.handleChange(stringToDateField(value))}
	onBlur={field.handleBlur}
/>
```

- [ ] **Step 5: Replace the date range end field**

Replace the native input for `rules[${ruleIndex}].dateRangeEnd` with:

```tsx
<DatePicker
	value={dateFieldToString(field.state.value)}
	onChange={(value) => field.handleChange(stringToDateField(value))}
	onBlur={field.handleBlur}
/>
```

- [ ] **Step 6: Run a scoped search**

Run from `apps/webapp`:

```bash
pnpm exec rg 'type="date"' src/components/settings/surcharge-rule-editor.tsx
```

Expected: no matches.

## Task 4: Replace Filter And Wizard Date Fields

**Files:**
- Modify: `apps/webapp/src/components/settings/payroll-export/export-form.tsx`
- Modify: `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx`
- Modify: `apps/webapp/src/components/settings/audit-log-viewer.tsx`
- Modify: `apps/webapp/src/components/settings/audit-export/audit-pack-generator-card.tsx`

- [ ] **Step 1: Import DatePicker in each filter or wizard file**

Add this import in each file listed above:

```tsx
import { DatePicker } from "@/components/ui/date-picker";
```

- [ ] **Step 2: Replace plain state date filters**

Replace patterns like this:

```tsx
<Input
	type="date"
	value={startDate}
	onChange={(e) => {
		setStartDate(e.target.value);
		setPage(0);
	}}
	className="w-[160px]"
/>
```

With:

```tsx
<DatePicker
	value={startDate}
	onChange={(value) => {
		setStartDate(value);
		setPage(0);
	}}
	className="w-[160px]"
/>
```

- [ ] **Step 3: Replace TanStack filter fields using the normal string field pattern**

For form fields in export or wizard components, replace native inputs with:

```tsx
<DatePicker
	value={field.state.value}
	onChange={field.handleChange}
	onBlur={field.handleBlur}
/>
```

Keep any existing `name`, `required`, `min`, `max`, `disabled`, or `className` props by passing them through to `DatePicker`.

- [ ] **Step 4: Run a scoped search**

Run from `apps/webapp`:

```bash
pnpm exec rg 'type="date"' src/components/settings/payroll-export/export-form.tsx src/components/settings/clockin-import/clockin-import-wizard.tsx src/components/settings/audit-log-viewer.tsx src/components/settings/audit-export/audit-pack-generator-card.tsx
```

Expected: no matches.

## Task 5: Final Verification And Cleanup

**Files:**
- Inspect all modified files.

- [ ] **Step 1: Confirm no native date inputs remain under components**

Run from `apps/webapp`:

```bash
pnpm exec rg 'type="date"' src/components
```

Expected: no matches.

- [ ] **Step 2: Confirm native time inputs remain untouched**

Run from `apps/webapp`:

```bash
pnpm exec rg 'type="time"|TimeInput' src/components
```

Expected: matches may remain. Do not replace them.

- [ ] **Step 3: Run component tests**

Run from `apps/webapp`:

```bash
pnpm test src/components/ui/date-picker.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run all available tests that do not require environment secrets**

Run from `apps/webapp`:

```bash
pnpm test
```

Expected: PASS, unless an existing test requires unavailable Phase CLI environment variables. If env variables block the command, record the exact missing variables and continue to the typecheck step.

- [ ] **Step 5: Run TypeScript check**

Run from `apps/webapp`:

```bash
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Review git diff without reverting unrelated work**

Run from repo root:

```bash
git diff -- apps/webapp/src/components docs/superpowers/specs/2026-04-29-shadcn-date-picker-design.md docs/superpowers/plans/2026-04-29-shadcn-date-picker.md
```

Expected: diff only contains the date-picker component, tests, native date input replacements, and the planning docs.

- [ ] **Step 7: Checkpoint instead of committing**

Do not run `git commit` unless the user explicitly asks for a commit. Report the modified files and verification results.

## Self-Review

- Spec coverage: The plan adds one reusable shadcn-based date picker, replaces all known `type="date"` controls under `src/components`, preserves `YYYY-MM-DD` string boundaries, adapts existing `Date | null` surcharge fields, keeps time fields unchanged, and verifies no native date inputs remain.
- Placeholder scan: No placeholder work remains; each task includes exact files, concrete code patterns, and commands with expected outcomes.
- Type consistency: `DatePicker` accepts `value?: string | null`, emits `onChange(value: string)`, and supports `min`, `max`, `required`, `disabled`, `className`, `name`, and ARIA props via `Button` props.
