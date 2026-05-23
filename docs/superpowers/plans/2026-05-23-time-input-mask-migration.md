# Time Input Mask Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `react-imask` in the webapp time input with a local, dependency-free `HH:mm` typed-input mask.

**Architecture:** Keep `TimeInput` as the only changed component. Replace `IMaskInput` with a normal React input and a tiny formatter that normalizes typed text before existing parse/emit logic runs. Keep `timepicker-ui` integration, AM/PM behavior, and stored `HH:mm` values unchanged.

**Tech Stack:** Next.js/React 19, TypeScript, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/components/ui/time-input.tsx`
  - Remove `react-imask` imports.
  - Add `formatTypedTimeInput(rawValue: string): string` near the existing time helpers.
  - Render a standard `<input>` with the existing class names and props.
  - Run formatted values through the existing `handleMaskedValueChange` path.
- Modify: `apps/webapp/src/components/ui/time-input.test.tsx`
  - Add explicit regression coverage for digit-only masking and four-digit truncation.
  - Keep existing behavior tests unchanged unless they need updated expectations for the standard input.
- Modify: `apps/webapp/package.json`
  - Remove `react-imask` from dependencies.
- Modify: `pnpm-lock.yaml`
  - Refresh via pnpm after removing the dependency.

---

### Task 1: Add Regression Tests For Local Time Masking

**Files:**
- Modify: `apps/webapp/src/components/ui/time-input.test.tsx`

- [ ] **Step 1: Add tests for digit cleanup, colon insertion, and truncation**

Insert these tests after the existing `emits normalized values from valid 24-hour typing` test:

```tsx
	it("formats typed digits into an HH:mm display value", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" timeFormat="24h" value="" onChange={handleChange} />);

		const input = screen.getByLabelText<HTMLInputElement>("Start time");
		fireEvent.change(input, { target: { value: "1430" } });

		expect(input.value).toBe("14:30");
		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("14:30");
	});

	it("ignores non-digits and limits typed time input to four digits", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" timeFormat="24h" value="" onChange={handleChange} />);

		const input = screen.getByLabelText<HTMLInputElement>("Start time");
		fireEvent.change(input, { target: { value: "ab12345cd" } });

		expect(input.value).toBe("12:34");
		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("12:34");
	});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run: `pnpm --dir apps/webapp test src/components/ui/time-input.test.tsx`

Expected: FAIL. The new tests should fail because the current `IMaskInput` test environment does not apply the planned local formatter to raw `change` event values.

---

### Task 2: Replace `IMaskInput` With A Standard Input

**Files:**
- Modify: `apps/webapp/src/components/ui/time-input.tsx`

- [ ] **Step 1: Remove `react-imask` imports**

Change the import block from:

```tsx
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { IMask, IMaskInput } from "react-imask";
import { TimepickerUI } from "timepicker-ui";
```

to:

```tsx
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { TimepickerUI } from "timepicker-ui";
```

- [ ] **Step 2: Add the typed-input formatter**

Add this helper after `formatTimeForMaskedInput`:

```tsx
function formatTypedTimeInput(value: string): string {
	const digits = value.replace(/\D/g, "").slice(0, 4);

	if (digits.length <= 2) {
		return value.endsWith(":") && digits.length === 2 ? `${digits}:` : digits;
	}

	return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
```

- [ ] **Step 3: Remove `maskBlocks`**

Delete this block from inside `TimeInput`:

```tsx
	const maskBlocks = {
		HH: {
			mask: IMask.MaskedRange,
			from: pickerFormat === "12h" ? 1 : 0,
			to: pickerFormat === "12h" ? 12 : 23,
			maxLength: 2,
		},
		mm: {
			mask: IMask.MaskedRange,
			from: 0,
			to: 59,
			maxLength: 2,
		},
	};
```

- [ ] **Step 4: Format user input before parsing**

Replace `handleMaskedValueChange` with:

```tsx
	function handleMaskedValueChange(nextRawDisplayValue: string) {
		const nextDisplayValue = formatTypedTimeInput(nextRawDisplayValue);
		setDisplayValue(nextDisplayValue);
		if (nextDisplayValue === "") {
			emitChange("");
			return;
		}

		const nextValue = parseMaskedTime(nextDisplayValue, pickerFormat, period);
		if (nextValue) {
			emitChange(nextValue);
		}
	}
```

- [ ] **Step 5: Render a standard input**

Replace the `<IMaskInput ... />` element with:

```tsx
				<input
					{...props}
					aria-invalid={props["aria-invalid"]}
					autoComplete={props.autoComplete ?? "off"}
					className="min-w-0 flex-1 border-0 bg-transparent px-3 py-1 text-base outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
					data-slot="time-input-field"
					inputMode={props.inputMode ?? "numeric"}
					onChange={(event) => handleMaskedValueChange(event.currentTarget.value)}
					ref={inputRef}
					type="text"
					value={typeof displayValue === "string" ? displayValue : ""}
				/>
```

- [ ] **Step 6: Run the targeted tests and verify they pass**

Run: `pnpm --dir apps/webapp test src/components/ui/time-input.test.tsx`

Expected: PASS. Existing picker, 12h/24h, clearing, incomplete input, and new local-mask tests should pass.

---

### Task 3: Remove `react-imask` From Dependencies

**Files:**
- Modify: `apps/webapp/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Remove the package**

Run: `pnpm --dir apps/webapp remove react-imask`

Expected: `apps/webapp/package.json` no longer contains `react-imask`, and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Verify no code references remain**

Run: `pnpm --dir apps/webapp why react-imask`

Expected: no dependency tree for `react-imask` remains.

Run: `rg "react-imask|IMask|IMaskInput" apps/webapp pnpm-lock.yaml`

Expected: no matches.

---

### Task 4: Final Verification

**Files:**
- Verify all modified files from prior tasks.

- [ ] **Step 1: Run targeted component tests**

Run: `pnpm --dir apps/webapp test src/components/ui/time-input.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run relevant package checks if available**

Run: `pnpm --dir apps/webapp test`

Expected: PASS, unless unrelated existing failures are clearly documented.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff -- apps/webapp/src/components/ui/time-input.tsx apps/webapp/src/components/ui/time-input.test.tsx apps/webapp/package.json pnpm-lock.yaml docs/superpowers/specs/2026-05-23-time-input-mask-migration-design.md docs/superpowers/plans/2026-05-23-time-input-mask-migration.md`

Expected: Diff only contains the local time mask migration, dependency removal, and the planning/spec documents.

---

## Self-Review

- Spec coverage: The plan removes `react-imask`, keeps `TimeInput` behavior local, preserves picker integration, preserves storage format, and avoids unrelated mask abstractions.
- Placeholder scan: No placeholders or deferred implementation notes remain.
- Type consistency: `formatTypedTimeInput(value: string): string` is introduced before use, and the standard input keeps `inputRef` as `HTMLInputElement`.
