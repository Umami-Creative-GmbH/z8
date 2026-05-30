# Header Timezone Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact app-header control that shows the user's configured local time and UTC offset, and lets the user change timezone from a popover with an explicit Save action.

**Architecture:** Implement one focused client component, `HeaderTimezoneControl`, that reads user preferences from `UserPreferencesProvider`, formats time with Luxon, and calls the existing `updateTimezone` server action. Export a pure `formatHeaderTimezone` helper from the same file so time/offset behavior can be tested without relying on wall-clock time. Render the component from `SiteHeader` before `NotificationBell`.

**Tech Stack:** Next.js App Router client components, React 19, Luxon `DateTime`, Radix/shadcn `Popover`, existing `TimezonePicker`, existing `Button`, existing `Badge`, Vitest, React Testing Library, `@testing-library/user-event`, `sonner` toasts.

---

## File Structure

- Create `apps/webapp/src/components/header-timezone-control.tsx`: client component, Luxon formatting helper, popover UI, draft state, save handling, route refresh.
- Create `apps/webapp/src/components/header-timezone-control.test.tsx`: deterministic formatter tests and interaction tests for the popover/save flow.
- Modify `apps/webapp/src/components/site-header.tsx`: import and render `HeaderTimezoneControl` before `NotificationBell`.
- Modify `apps/webapp/src/components/site-header.test.tsx`: mock the new control and assert placement before notifications.

## Task 1: Time And Offset Formatter

**Files:**
- Create: `apps/webapp/src/components/header-timezone-control.tsx`
- Test: `apps/webapp/src/components/header-timezone-control.test.tsx`

- [ ] **Step 1: Write the failing formatter tests**

Create `apps/webapp/src/components/header-timezone-control.test.tsx` with this initial test file:

```tsx
/* @vitest-environment jsdom */

import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { formatHeaderTimezone } from "./header-timezone-control";

describe("formatHeaderTimezone", () => {
	it("formats 24-hour local time without seconds and includes the current UTC offset", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Europe/Berlin", timeFormat: "24h" })).toEqual({
			displayTimezone: "Europe/Berlin",
			offsetLabel: "UTC+02:00",
			timeLabel: "14:34",
		});
	});

	it("formats 12-hour local time without seconds", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "America/New_York", timeFormat: "12h" })).toEqual({
			displayTimezone: "America/New_York",
			offsetLabel: "UTC-04:00",
			timeLabel: "8:34 AM",
		});
	});

	it("falls back to UTC when the stored timezone is invalid", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Not/AZone", timeFormat: "24h" })).toEqual({
			displayTimezone: "UTC",
			offsetLabel: "UTC+00:00",
			timeLabel: "12:34",
		});
	});
});
```

- [ ] **Step 2: Run formatter tests to verify they fail**

Run: `pnpm --dir apps/webapp test -- src/components/header-timezone-control.test.tsx`

Expected: FAIL because `./header-timezone-control` does not exist or `formatHeaderTimezone` is not exported.

- [ ] **Step 3: Add the minimal formatter implementation**

Create `apps/webapp/src/components/header-timezone-control.tsx` with this implementation:

```tsx
"use client";

import { DateTime } from "luxon";
import type { TimeFormat } from "@/lib/user-preferences/time-format";

export interface HeaderTimezoneDisplay {
	timeLabel: string;
	offsetLabel: string;
	displayTimezone: string;
}

export function formatHeaderTimezone({
	now,
	timezone,
	timeFormat,
}: {
	now: DateTime;
	timezone: string;
	timeFormat: TimeFormat;
}): HeaderTimezoneDisplay {
	const zonedNow = now.setZone(timezone);
	const displayDateTime = zonedNow.isValid ? zonedNow : now.setZone("UTC");
	const displayTimezone = zonedNow.isValid ? timezone : "UTC";
	const offsetMinutes = displayDateTime.offset;
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
	const offsetRemainderMinutes = String(absoluteOffset % 60).padStart(2, "0");

	return {
		displayTimezone,
		offsetLabel: `UTC${sign}${offsetHours}:${offsetRemainderMinutes}`,
		timeLabel: displayDateTime.toFormat(timeFormat === "12h" ? "h:mm a" : "HH:mm"),
	};
}
```

- [ ] **Step 4: Run formatter tests to verify they pass**

Run: `pnpm --dir apps/webapp test -- src/components/header-timezone-control.test.tsx`

Expected: PASS for the three formatter tests.

- [ ] **Step 5: Commit formatter helper**

```bash
git add apps/webapp/src/components/header-timezone-control.tsx apps/webapp/src/components/header-timezone-control.test.tsx
git commit -m "feat: add header timezone formatter"
```

## Task 2: Header Timezone Popover Component

**Files:**
- Modify: `apps/webapp/src/components/header-timezone-control.tsx`
- Modify: `apps/webapp/src/components/header-timezone-control.test.tsx`

- [ ] **Step 1: Replace the test file with formatter and interaction coverage**

Replace `apps/webapp/src/components/header-timezone-control.test.tsx` with this complete file:

```tsx
/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderTimezoneControl, formatHeaderTimezone } from "./header-timezone-control";

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	updateTimezone: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
	timezone: "Europe/Berlin",
	timeFormat: "24h" as "24h" | "12h",
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => mocks.timeFormat,
	useUserTimezone: () => mocks.timezone,
}));

vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateTimezone: (timezone: string) => mocks.updateTimezone(timezone),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: (message: string) => mocks.toastSuccess(message),
		error: (message: string) => mocks.toastError(message),
	},
}));

vi.mock("@/components/settings/timezone-picker", () => ({
	TimezonePicker: ({ value, onChange, disabled }: { value: string; onChange: (timezone: string) => void; disabled?: boolean }) => (
		<label>
			Timezone picker
			<select aria-label="Timezone picker" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
				<option value="Europe/Berlin">Europe/Berlin</option>
				<option value="America/New_York">America/New_York</option>
			</select>
		</label>
	),
}));

describe("formatHeaderTimezone", () => {
	it("formats 24-hour local time without seconds and includes the current UTC offset", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Europe/Berlin", timeFormat: "24h" })).toEqual({
			displayTimezone: "Europe/Berlin",
			offsetLabel: "UTC+02:00",
			timeLabel: "14:34",
		});
	});

	it("formats 12-hour local time without seconds", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "America/New_York", timeFormat: "12h" })).toEqual({
			displayTimezone: "America/New_York",
			offsetLabel: "UTC-04:00",
			timeLabel: "8:34 AM",
		});
	});

	it("falls back to UTC when the stored timezone is invalid", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Not/AZone", timeFormat: "24h" })).toEqual({
			displayTimezone: "UTC",
			offsetLabel: "UTC+00:00",
			timeLabel: "12:34",
		});
	});
});

describe("HeaderTimezoneControl", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-29T12:34:56.000Z"));
		mocks.timezone = "Europe/Berlin";
		mocks.timeFormat = "24h";
		mocks.refresh.mockReset();
		mocks.updateTimezone.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows the current configured time and UTC offset in the trigger", () => {
		render(<HeaderTimezoneControl />);

		expect(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i })).toBeTruthy();
		expect(screen.getByText("14:34")).toBeTruthy();
		expect(screen.getByText("UTC+02:00")).toBeTruthy();
		expect(screen.queryByText(/14:34:56/)).toBeNull();
	});

	it("opens a popover with a disabled save button until the draft timezone changes", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<HeaderTimezoneControl />);

		await user.click(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i }));

		expect(screen.getByText("Saved timezone")).toBeTruthy();
		expect(screen.getByText("Europe/Berlin")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save timezone" })).toBeDisabled();

		await user.selectOptions(screen.getByLabelText("Timezone picker"), "America/New_York");

		expect(screen.getByRole("button", { name: "Save timezone" })).toBeEnabled();
	});

	it("saves the selected timezone, refreshes the route, and shows success feedback", async () => {
		mocks.updateTimezone.mockResolvedValue({ success: true });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<HeaderTimezoneControl />);

		await user.click(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i }));
		await user.selectOptions(screen.getByLabelText("Timezone picker"), "America/New_York");
		await user.click(screen.getByRole("button", { name: "Save timezone" }));

		await waitFor(() => expect(mocks.updateTimezone).toHaveBeenCalledWith("America/New_York"));
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Timezone updated successfully");
	});

	it("keeps the popover open and preserves the draft timezone when save fails", async () => {
		mocks.updateTimezone.mockResolvedValue({ success: false, error: "Failed to update timezone" });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<HeaderTimezoneControl />);

		await user.click(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i }));
		await user.selectOptions(screen.getByLabelText("Timezone picker"), "America/New_York");
		await user.click(screen.getByRole("button", { name: "Save timezone" }));

		await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Failed to update timezone"));
		expect(mocks.refresh).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Timezone picker")).toHaveValue("America/New_York");
		expect(screen.getByText("Saved timezone")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run: `pnpm --dir apps/webapp test -- src/components/header-timezone-control.test.tsx`

Expected: FAIL because `HeaderTimezoneControl` is not exported or does not render the required UI.

- [ ] **Step 3: Implement the component UI and save behavior**

Replace `apps/webapp/src/components/header-timezone-control.tsx` with this complete implementation:

```tsx
"use client";

import { IconLoader2, IconWorld } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { useTimeFormat, useUserTimezone } from "@/components/providers/user-preferences-provider";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";

export interface HeaderTimezoneDisplay {
	timeLabel: string;
	offsetLabel: string;
	displayTimezone: string;
}

export function formatHeaderTimezone({ now, timezone, timeFormat }: { now: DateTime; timezone: string; timeFormat: TimeFormat }): HeaderTimezoneDisplay {
	const zonedNow = now.setZone(timezone);
	const displayDateTime = zonedNow.isValid ? zonedNow : now.setZone("UTC");
	const displayTimezone = zonedNow.isValid ? timezone : "UTC";
	const offsetMinutes = displayDateTime.offset;
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
	const offsetRemainderMinutes = String(absoluteOffset % 60).padStart(2, "0");

	return {
		displayTimezone,
		offsetLabel: `UTC${sign}${offsetHours}:${offsetRemainderMinutes}`,
		timeLabel: displayDateTime.toFormat(timeFormat === "12h" ? "h:mm a" : "HH:mm"),
	};
}

export function HeaderTimezoneControl() {
	const savedTimezone = useUserTimezone();
	const timeFormat = useTimeFormat();
	const { refresh } = useRouter();
	const [open, setOpen] = useState(false);
	const [draftTimezone, setDraftTimezone] = useState(savedTimezone);
	const [now, setNow] = useState(() => DateTime.now());
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		const interval = window.setInterval(() => setNow(DateTime.now()), 60_000);
		return () => window.clearInterval(interval);
	}, []);

	useEffect(() => {
		if (!open) setDraftTimezone(savedTimezone);
	}, [open, savedTimezone]);

	const display = formatHeaderTimezone({ now, timezone: savedTimezone, timeFormat });
	const hasChanged = draftTimezone !== savedTimezone;

	const handleSave = () => {
		startTransition(async () => {
			const result = await updateTimezone(draftTimezone).then((response) => response, () => null);

			if (!result) {
				toast.error("An error occurred while updating timezone");
				return;
			}

			if (!result.success) {
				toast.error(result.error || "Failed to update timezone");
				return;
			}

			toast.success("Timezone updated successfully");
			setOpen(false);
			refresh();
		});
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					className="hidden h-8 items-center gap-2 rounded-full border bg-background px-2.5 text-sm font-medium shadow-xs sm:flex"
					aria-label={`Current timezone ${display.displayTimezone}, current time ${display.timeLabel}, ${display.offsetLabel}`}
				>
					<IconWorld className="size-4 text-muted-foreground" aria-hidden="true" />
					<span className="tabular-nums">{display.timeLabel}</span>
					<Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[0.68rem] tabular-nums">
						{display.offsetLabel}
					</Badge>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80 space-y-4" align="end">
				<div className="space-y-1">
					<p className="font-medium text-sm">Timezone</p>
					<p className="text-muted-foreground text-xs">Saved timezone</p>
					<p className="break-all text-sm">{savedTimezone}</p>
				</div>
				<TimezonePicker value={draftTimezone} onChange={setDraftTimezone} disabled={isPending} />
				<Button className="w-full" onClick={handleSave} disabled={!hasChanged || isPending}>
					<IconLoader2 className={cn("mr-2 size-4 animate-spin", !isPending && "hidden")} />
					Save timezone
				</Button>
			</PopoverContent>
		</Popover>
	);
}
```

- [ ] **Step 4: Run component tests to verify they pass**

Run: `pnpm --dir apps/webapp test -- src/components/header-timezone-control.test.tsx`

Expected: PASS for formatter and component tests.

- [ ] **Step 5: Commit component implementation**

```bash
git add apps/webapp/src/components/header-timezone-control.tsx apps/webapp/src/components/header-timezone-control.test.tsx
git commit -m "feat: add header timezone control"
```

## Task 3: Wire The Control Into SiteHeader

**Files:**
- Modify: `apps/webapp/src/components/site-header.tsx`
- Modify: `apps/webapp/src/components/site-header.test.tsx`

- [ ] **Step 1: Update the failing placement test**

Modify `apps/webapp/src/components/site-header.test.tsx` so the provider mock includes `useUserTimezone`, the new component is mocked, and the dashboard button order expects `Timezone` before `Notifications`:

```tsx
vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
	useUserTimezone: () => "Europe/Berlin",
}));

vi.mock("@/components/header-timezone-control", () => ({
	HeaderTimezoneControl: () => <button type="button">Timezone</button>,
}));
```

Update the first test's expected button list to:

```tsx
expect(buttons).toEqual([
	"Toggle sidebar",
	"Customize dashboard",
	"Timezone",
	"Notifications",
	"Clock In",
]);
```

Add this assertion to the second test after the notifications assertion:

```tsx
expect(screen.getByRole("button", { name: "Timezone" })).toBeTruthy();
```

- [ ] **Step 2: Run the site header test to verify it fails**

Run: `pnpm --dir apps/webapp test -- src/components/site-header.test.tsx`

Expected: FAIL because `SiteHeader` does not render `HeaderTimezoneControl` yet.

- [ ] **Step 3: Render HeaderTimezoneControl before notifications**

Modify `apps/webapp/src/components/site-header.tsx` by adding this import:

```tsx
import { HeaderTimezoneControl } from "@/components/header-timezone-control";
```

Then update the action row to render the timezone control before notifications:

```tsx
<div className="ml-auto flex items-center gap-2">
	{isDashboardRoute ? <DashboardHeaderCustomize /> : null}
	<HeaderTimezoneControl />
	<NotificationBell />
	<TimeClockPopover timeFormat={timeFormat} />
</div>
```

- [ ] **Step 4: Run the site header test to verify it passes**

Run: `pnpm --dir apps/webapp test -- src/components/site-header.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit header integration**

```bash
git add apps/webapp/src/components/site-header.tsx apps/webapp/src/components/site-header.test.tsx
git commit -m "feat: show timezone control in app header"
```

## Task 4: Verification And Cleanup

**Files:**
- Verify: `apps/webapp/src/components/header-timezone-control.tsx`
- Verify: `apps/webapp/src/components/header-timezone-control.test.tsx`
- Verify: `apps/webapp/src/components/site-header.tsx`
- Verify: `apps/webapp/src/components/site-header.test.tsx`

- [ ] **Step 1: Run focused tests**

Run: `pnpm --dir apps/webapp test -- src/components/header-timezone-control.test.tsx src/components/site-header.test.tsx`

Expected: PASS for both test files.

- [ ] **Step 2: Run the full webapp test suite**

Run: `pnpm --dir apps/webapp test`

Expected: PASS. If unrelated existing tests fail, capture the failing test names and confirm the focused tests still pass.

- [ ] **Step 3: Run React/UI quality checks from repo policy**

Use the required review skills before final completion:

```text
Use superpowers:vercel-react-best-practices to review the component for React/Next.js performance patterns.
Use superpowers:web-design-guidelines to review the header control accessibility and responsive behavior.
Use superpowers:vercel-composition-patterns to review whether the component boundary is focused and composable.
```

Expected: no blocking findings. If a finding is valid, fix it and rerun focused tests.

- [ ] **Step 4: Run production build when feasible**

Run: `CI=true pnpm build`

Expected: PASS. If the build cannot run because required Phase CLI environment variables are unavailable to agents, skip it and record the skipped build and reason in the final response.

- [ ] **Step 5: Inspect the final diff**

Run: `git diff --stat && git diff -- apps/webapp/src/components/header-timezone-control.tsx apps/webapp/src/components/header-timezone-control.test.tsx apps/webapp/src/components/site-header.tsx apps/webapp/src/components/site-header.test.tsx`

Expected: diff only includes the header timezone control, its tests, and header integration.

- [ ] **Step 6: Commit verification fixes if code changes were needed**

If Step 3, Step 4, or Step 5 required code changes, commit them:

```bash
git add apps/webapp/src/components/header-timezone-control.tsx apps/webapp/src/components/header-timezone-control.test.tsx apps/webapp/src/components/site-header.tsx apps/webapp/src/components/site-header.test.tsx
git commit -m "fix: polish header timezone control"
```

If no code changes were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: header placement, current time, UTC offset pill, click popover, existing picker reuse, explicit Save behavior, route refresh, error handling, invalid timezone fallback, and tests are each covered by a task.
- Marker scan: no unresolved markers or unspecified implementation steps remain.
- Type consistency: the plan uses `TimeFormat`, `HeaderTimezoneDisplay`, `formatHeaderTimezone`, and `HeaderTimezoneControl` consistently across tests and implementation.
