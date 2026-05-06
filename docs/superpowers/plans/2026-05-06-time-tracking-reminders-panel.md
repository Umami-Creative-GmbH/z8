# Time Tracking Reminders Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate oversized break and water reminder alerts in `/time-tracking` with one compact `SessionReminderPanel` that prioritizes break compliance and keeps hydration actions secondary.

**Architecture:** Add one focused client component that owns the existing break-reminder and water-reminder hook flows, renders nothing when no reminder is due, and renders compact rows when reminders are relevant. Keep backend actions, settings, schemas, and reminder timing logic unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Tabler icons, TanStack Query, Tolgee translations, Vitest, Testing Library.

---

## File Structure

- Create: `apps/webapp/src/components/time-tracking/session-reminder-panel.tsx`
  - Combined compact reminder panel.
  - Contains break status calculation currently in `BreakReminder` and hydration actions currently in `WaterReminder`.
  - Keeps row-level dismiss state scoped by `sessionStartTime`.
- Create: `apps/webapp/src/components/time-tracking/session-reminder-panel.test.tsx`
  - Tests render/no-render behavior, break copy, zero-minute break handling, hydration actions, and compact styling hooks.
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`
  - Replace `BreakReminder` and `WaterReminder` usage with `SessionReminderPanel`.
  - Remove now-unused imports.
- Modify: `apps/webapp/messages/timeTracking/en.json`
  - Add `timeTracking.sessionReminders` translation keys.
- Modify: `apps/webapp/messages/timeTracking/de.json`
  - Add German `timeTracking.sessionReminders` translation keys.
- Optional follow-up after verification: keep existing `break-reminder.tsx` and `water-reminder.tsx` if used elsewhere or delete only if confirmed unused by search.

## Task 1: Add Render Tests For The Combined Panel

**Files:**
- Create: `apps/webapp/src/components/time-tracking/session-reminder-panel.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `apps/webapp/src/components/time-tracking/session-reminder-panel.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReminderPanel } from "@/components/time-tracking/session-reminder-panel";

const getBreakReminderStatusMock = vi.fn();
const useElapsedTimerMock = vi.fn();
const useWaterReminderMock = vi.fn();
const useHydrationStatsMock = vi.fn();

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getBreakReminderStatus: () => getBreakReminderStatusMock(),
}));

vi.mock("@/lib/query", () => ({
	queryKeys: {
		timeClock: {
			breakStatus: () => ["time-clock", "break-status"],
		},
	},
	useElapsedTimer: () => useElapsedTimerMock(),
}));

vi.mock("@/hooks/use-water-reminder", () => ({
	useWaterReminder: (...args: unknown[]) => useWaterReminderMock(...args),
}));

vi.mock("@/hooks/use-hydration-stats", () => ({
	useHydrationStats: (...args: unknown[]) => useHydrationStatsMock(...args),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string | number>) => {
			if (!values) return fallback;
			return Object.entries(values).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function setupDefaults() {
	getBreakReminderStatusMock.mockResolvedValue({
		success: true,
		data: {
			maxUninterrupted: 240,
			breakRequirement: null,
		},
	});
	useElapsedTimerMock.mockReturnValue(60 * 60);
	useWaterReminderMock.mockReturnValue({
		enabled: false,
		showReminder: false,
		isSnoozed: false,
		handleReminderAction: vi.fn(),
		dismiss: vi.fn(),
	});
	useHydrationStatsMock.mockReturnValue({
		todayIntake: 0,
		dailyGoal: 8,
		goalProgress: 0,
		currentStreak: 0,
		logIntake: vi.fn(),
		snooze: vi.fn(),
		isLogging: false,
		isSnoozing: false,
		goalMet: false,
	});
}

describe("SessionReminderPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("does not render while clocked out", () => {
		renderWithQueryClient(<SessionReminderPanel isClockedIn={false} sessionStartTime={null} />);

		expect(screen.queryByText("Session reminders")).not.toBeInTheDocument();
	});

	it("renders nothing when no break or water reminder is due", async () => {
		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		await waitFor(() => expect(getBreakReminderStatusMock).toHaveBeenCalled());
		expect(screen.queryByText("Session reminders")).not.toBeInTheDocument();
	});

	it("shows approaching break copy in a compact panel", async () => {
		useElapsedTimerMock.mockReturnValue(230 * 60);

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Session reminders")).toBeInTheDocument();
		expect(screen.getByText("Break soon")).toBeInTheDocument();
		expect(screen.getByText("10 min until break")).toBeInTheDocument();
		expect(screen.getByText("10 min until break").closest("section")?.className).toContain("rounded-lg");
	});

	it("treats zero remaining break minutes as required now", async () => {
		useElapsedTimerMock.mockReturnValue(240 * 60);

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Break required now")).toBeInTheDocument();
		expect(screen.queryByText("0 min until break")).not.toBeInTheDocument();
	});

	it("renders hydration progress and logs one glass", async () => {
		const logIntake = vi.fn().mockResolvedValue({ goalJustMet: false, goalProgress: 50 });
		const handleReminderAction = vi.fn();
		useWaterReminderMock.mockReturnValue({
			enabled: true,
			showReminder: true,
			isSnoozed: false,
			handleReminderAction,
			dismiss: vi.fn(),
		});
		useHydrationStatsMock.mockReturnValue({
			todayIntake: 3,
			dailyGoal: 8,
			goalProgress: 38,
			currentStreak: 0,
			logIntake,
			snooze: vi.fn(),
			isLogging: false,
			isSnoozing: false,
			goalMet: false,
		});

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Hydration")).toBeInTheDocument();
		expect(screen.getByText("3/8 glasses today")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "+1 glass" }));

		await waitFor(() =>
			expect(logIntake).toHaveBeenCalledWith({ amount: 1, source: "reminder_action" }),
		);
		expect(handleReminderAction).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/time-tracking/session-reminder-panel.test.tsx
```

Expected: FAIL because `@/components/time-tracking/session-reminder-panel` does not exist.

## Task 2: Implement The Compact Session Reminder Panel

**Files:**
- Create: `apps/webapp/src/components/time-tracking/session-reminder-panel.tsx`

- [ ] **Step 1: Add the combined panel component**

Create `apps/webapp/src/components/time-tracking/session-reminder-panel.tsx` with this content:

```tsx
"use client";

import {
	IconAlertTriangle,
	IconCoffee,
	IconDroplet,
	IconLoader2,
	IconMoonStars,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getBreakReminderStatus } from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useHydrationStats } from "@/hooks/use-hydration-stats";
import { useWaterReminder } from "@/hooks/use-water-reminder";
import { queryKeys, useElapsedTimer } from "@/lib/query";
import { cn } from "@/lib/utils";

const WARNING_THRESHOLD_MINUTES = 15;

interface SessionReminderPanelProps {
	isClockedIn: boolean;
	sessionStartTime: Date | null;
	onDismiss?: () => void;
}

export function SessionReminderPanel({
	isClockedIn,
	sessionStartTime,
	onDismiss,
}: SessionReminderPanelProps) {
	const { t } = useTranslate();
	const sessionKey = sessionStartTime?.getTime() ?? null;
	const [dismissedBreakSessionKeys, setDismissedBreakSessionKeys] = useState<Set<number>>(
		() => new Set(),
	);
	const [dismissedBreakWithoutSession, setDismissedBreakWithoutSession] = useState(false);
	const [dismissedWaterSessionKeys, setDismissedWaterSessionKeys] = useState<Set<number>>(
		() => new Set(),
	);
	const [dismissedWaterWithoutSession, setDismissedWaterWithoutSession] = useState(false);

	const breakDismissed =
		sessionKey === null ? dismissedBreakWithoutSession : dismissedBreakSessionKeys.has(sessionKey);
	const waterDismissed =
		sessionKey === null ? dismissedWaterWithoutSession : dismissedWaterSessionKeys.has(sessionKey);

	const elapsedSeconds = useElapsedTimer(isClockedIn ? sessionStartTime : null);
	const elapsedMinutes = Math.floor(elapsedSeconds / 60);

	const { data: serverData } = useQuery({
		queryKey: queryKeys.timeClock.breakStatus(),
		queryFn: async () => {
			const result = await getBreakReminderStatus();
			if (!result.success) return null;
			return result.data;
		},
		enabled: isClockedIn && !breakDismissed,
		staleTime: Infinity,
		gcTime: 5 * 60 * 1000,
	});

	const breakStatus = useMemo(() => {
		if (!serverData) return null;

		const maxUninterrupted = serverData.maxUninterrupted;
		let minutesUntilBreakRequired: number | null = null;
		let shouldShow = false;

		if (maxUninterrupted) {
			minutesUntilBreakRequired = maxUninterrupted - elapsedMinutes;
			shouldShow = minutesUntilBreakRequired <= WARNING_THRESHOLD_MINUTES;
		}

		if (serverData.breakRequirement && serverData.breakRequirement.remaining > 0) {
			shouldShow = true;
		}

		return {
			shouldShow,
			uninterruptedMinutes: elapsedMinutes,
			maxUninterrupted,
			minutesUntilBreakRequired,
			breakRequirement: serverData.breakRequirement,
		};
	}, [serverData, elapsedMinutes]);

	const {
		enabled: waterEnabled,
		showReminder: showWaterReminder,
		isSnoozed,
		handleReminderAction,
		dismiss: dismissWaterReminder,
	} = useWaterReminder({
		enabled: isClockedIn,
		workSessionStart: sessionStartTime,
	});

	const {
		todayIntake,
		dailyGoal,
		goalProgress,
		logIntake,
		snooze,
		isLogging,
		isSnoozing,
		goalMet,
	} = useHydrationStats({ enabled: isClockedIn && waterEnabled });

	if (!isClockedIn) return null;

	const showBreakRow = !breakDismissed && Boolean(breakStatus?.shouldShow);
	const showWaterRow = waterEnabled && !waterDismissed && !isSnoozed && showWaterReminder;

	if (!showBreakRow && !showWaterRow) return null;

	const isBreakRequired =
		breakStatus?.minutesUntilBreakRequired !== null &&
		breakStatus?.minutesUntilBreakRequired !== undefined &&
		breakStatus.minutesUntilBreakRequired <= 0;
	const minutesRemaining = Math.max(0, breakStatus?.minutesUntilBreakRequired ?? 0);
	const uninterruptedProgress = breakStatus?.maxUninterrupted
		? Math.min(100, (breakStatus.uninterruptedMinutes / breakStatus.maxUninterrupted) * 100)
		: 0;
	const isMutatingWater = isLogging || isSnoozing;

	const dismissBreak = () => {
		if (sessionKey === null) {
			setDismissedBreakWithoutSession(true);
		} else {
			setDismissedBreakSessionKeys((prev) => new Set(prev).add(sessionKey));
		}
		onDismiss?.();
	};

	const dismissWater = () => {
		if (sessionKey === null) {
			setDismissedWaterWithoutSession(true);
		} else {
			setDismissedWaterSessionKeys((prev) => new Set(prev).add(sessionKey));
		}
		dismissWaterReminder();
		onDismiss?.();
	};

	const handleLogWater = async (amount: number) => {
		try {
			const result = await logIntake({ amount, source: "reminder_action" });
			if (result.goalJustMet || goalMet) {
				toast.success(t("wellness.water.goalMet", "Daily goal reached! Keep up the great work!"));
			} else {
				toast.success(
					t("wellness.water.logged", "Water logged! {progress}% of daily goal", {
						progress: result.goalProgress,
					}),
				);
			}
			handleReminderAction();
		} catch {
			toast.error(t("wellness.water.logError", "Failed to log water intake"));
		}
	};

	const handleSnoozeWater = async () => {
		try {
			await snooze();
			toast.info(t("wellness.water.snoozed", "Water reminders snoozed for today"));
			handleReminderAction();
		} catch {
			toast.error(t("wellness.water.snoozeError", "Failed to snooze reminders"));
		}
	};

	return (
		<section className="rounded-lg border bg-muted/20 p-3 shadow-sm" aria-labelledby="session-reminders-title">
			<div className="mb-2 flex items-center justify-between gap-3">
				<h3 id="session-reminders-title" className="text-sm font-medium">
					{t("timeTracking.sessionReminders.title", "Session reminders")}
				</h3>
				<span className="text-xs text-muted-foreground">
					{t("timeTracking.sessionReminders.subtitle", "During this shift")}
				</span>
			</div>

			<div className="space-y-2">
				{showBreakRow && breakStatus ? (
					<div
						className={cn(
							"rounded-md border bg-background p-3",
							isBreakRequired ? "border-destructive/40" : "border-orange-500/30",
						)}
					>
						<div className="flex items-start gap-3">
							{isBreakRequired ? (
								<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
							) : (
								<IconCoffee className="mt-0.5 size-4 shrink-0 text-orange-500" aria-hidden="true" />
							)}
							<div className="min-w-0 flex-1 space-y-2">
								<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
									<p className="text-sm font-medium">
										{isBreakRequired
											? t("timeTracking.sessionReminders.breakRequired", "Break required now")
											: t("timeTracking.sessionReminders.breakSoon", "Break soon")}
									</p>
									<p className="text-sm text-muted-foreground">
										{isBreakRequired
											? t(
													"timeTracking.sessionReminders.breakRequiredDescription",
													"Take a break before continuing your session.",
												)
											: t("timeTracking.sessionReminders.breakCountdown", "{minutes} min until break", {
													minutes: minutesRemaining,
												})}
									</p>
								</div>

								{breakStatus.maxUninterrupted ? (
									<Progress
										value={uninterruptedProgress}
										className={cn(
											"h-1.5",
											isBreakRequired ? "[&>div]:bg-destructive" : "[&>div]:bg-orange-500",
										)}
									/>
								) : null}

								{breakStatus.breakRequirement && breakStatus.breakRequirement.remaining > 0 ? (
									<p className="text-xs text-muted-foreground">
										{t("timeTracking.sessionReminders.breakRemaining", "{remaining} min break open", {
											remaining: breakStatus.breakRequirement.remaining,
										})}
									</p>
								) : null}
							</div>
							<Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={dismissBreak}>
								<IconX className="size-4" aria-hidden="true" />
								<span className="sr-only">{t("common.dismiss", "Dismiss")}</span>
							</Button>
						</div>
					</div>
				) : null}

				{showWaterRow ? (
					<div className="rounded-md border bg-background p-3">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex min-w-0 items-start gap-3">
								<IconDroplet className="mt-0.5 size-4 shrink-0 text-blue-500" aria-hidden="true" />
								<div className="min-w-0">
									<p className="text-sm font-medium">
										{t("timeTracking.sessionReminders.hydration", "Hydration")}
									</p>
									<p className="text-sm text-muted-foreground">
										{t("timeTracking.sessionReminders.waterProgress", "{intake}/{goal} glasses today", {
											intake: todayIntake,
											goal: dailyGoal,
										})}
									</p>
									<Progress value={goalProgress} className="mt-2 h-1.5 [&>div]:bg-blue-500" />
								</div>
							</div>

							<div className="flex flex-wrap gap-2 sm:justify-end">
								<Button size="sm" variant="secondary" onClick={() => handleLogWater(1)} disabled={isMutatingWater}>
									{isLogging ? <IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" /> : null}
									{t("timeTracking.sessionReminders.logOneGlass", "+1 glass")}
								</Button>
								<Button size="sm" variant="secondary" onClick={() => handleLogWater(2)} disabled={isMutatingWater}>
									{t("timeTracking.sessionReminders.logTwoGlasses", "+2")}
								</Button>
								<Button size="sm" variant="ghost" onClick={handleSnoozeWater} disabled={isMutatingWater}>
									{isSnoozing ? <IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" /> : <IconMoonStars className="mr-1 size-3" aria-hidden="true" />}
									{t("timeTracking.sessionReminders.snoozeWaterToday", "Snooze today")}
								</Button>
								<Button variant="ghost" size="icon" className="size-8" onClick={dismissWater} disabled={isMutatingWater}>
									<IconX className="size-4" aria-hidden="true" />
									<span className="sr-only">{t("common.dismiss", "Dismiss")}</span>
								</Button>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</section>
	);
}
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
pnpm --dir apps/webapp test src/components/time-tracking/session-reminder-panel.test.tsx
```

Expected: PASS. If it fails because `toBeInTheDocument` matchers are unavailable, update the assertions to use `expect(element).toBeTruthy()` rather than adding new test setup.

- [ ] **Step 3: Commit Task 2 changes if commits were requested for this execution**

Run only if the user explicitly requested commits:

```bash
git add apps/webapp/src/components/time-tracking/session-reminder-panel.tsx apps/webapp/src/components/time-tracking/session-reminder-panel.test.tsx
git commit -m "feat: add session reminder panel"
```

## Task 3: Replace The Old Reminder Alerts In The Clock Widget

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`

- [ ] **Step 1: Update imports**

Change the imports at the top of `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx` from:

```tsx
import { BreakReminder } from "@/components/time-tracking/break-reminder";
import {
	ActiveSessionSummary,
	ClockActionButton,
	PostClockOutNotesForm,
	RestPeriodWarnBanner,
	WorkLocationSelector,
} from "@/components/time-tracking/clock-in-out-widget-parts";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WaterReminder } from "@/components/wellness/water-reminder";
```

to:

```tsx
import {
	ActiveSessionSummary,
	ClockActionButton,
	PostClockOutNotesForm,
	RestPeriodWarnBanner,
	WorkLocationSelector,
} from "@/components/time-tracking/clock-in-out-widget-parts";
import { SessionReminderPanel } from "@/components/time-tracking/session-reminder-panel";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
```

- [ ] **Step 2: Replace reminder JSX**

Replace this block in `ClockInOutWidget`:

```tsx
<BreakReminder
	isClockedIn={widget.isClockedIn}
	sessionStartTime={widget.activeWorkPeriod?.startTime ?? null}
/>

<WaterReminder
	isClockedIn={widget.isClockedIn}
	sessionStartTime={widget.activeWorkPeriod?.startTime ?? null}
/>
```

with:

```tsx
<SessionReminderPanel
	isClockedIn={widget.isClockedIn}
	sessionStartTime={widget.activeWorkPeriod?.startTime ?? null}
/>
```

- [ ] **Step 3: Run the focused test again**

Run:

```bash
pnpm --dir apps/webapp test src/components/time-tracking/session-reminder-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Search whether old components are still referenced**

Run searches with `grep`/Glob tools or command equivalent:

```bash
rg "BreakReminder|WaterReminder" apps/webapp/src
```

Expected: only component definitions remain. Do not delete them in this task unless the search confirms no imports remain and the user wants cleanup.

- [ ] **Step 5: Commit Task 3 changes if commits were requested for this execution**

Run only if the user explicitly requested commits:

```bash
git add apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx
git commit -m "refactor: use unified session reminders"
```

## Task 4: Add Translation Keys

**Files:**
- Modify: `apps/webapp/messages/timeTracking/en.json`
- Modify: `apps/webapp/messages/timeTracking/de.json`

- [ ] **Step 1: Add English keys**

In `apps/webapp/messages/timeTracking/en.json`, add this object under `timeTracking` after `breakReminder`:

```json
"sessionReminders": {
  "breakCountdown": "{minutes} min until break",
  "breakRemaining": "{remaining} min break open",
  "breakRequired": "Break required now",
  "breakRequiredDescription": "Take a break before continuing your session.",
  "breakSoon": "Break soon",
  "hydration": "Hydration",
  "logOneGlass": "+1 glass",
  "logTwoGlasses": "+2",
  "snoozeWaterToday": "Snooze today",
  "subtitle": "During this shift",
  "title": "Session reminders",
  "waterProgress": "{intake}/{goal} glasses today"
}
```

- [ ] **Step 2: Add German keys**

In `apps/webapp/messages/timeTracking/de.json`, add this object under `timeTracking` after `breakReminder`:

```json
"sessionReminders": {
  "breakCountdown": "Noch {minutes} min bis zur Pause",
  "breakRemaining": "{remaining} min Pause offen",
  "breakRequired": "Pause jetzt erforderlich",
  "breakRequiredDescription": "Machen Sie eine Pause, bevor Sie weiterarbeiten.",
  "breakSoon": "Pause bald fällig",
  "hydration": "Trinken",
  "logOneGlass": "+1 Glas",
  "logTwoGlasses": "+2",
  "snoozeWaterToday": "Heute stummschalten",
  "subtitle": "Während dieser Schicht",
  "title": "Session-Hinweise",
  "waterProgress": "{intake}/{goal} Gläser heute"
}
```

- [ ] **Step 3: Validate JSON by running tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/time-tracking/session-reminder-panel.test.tsx
```

Expected: PASS. If JSON syntax is invalid, Vitest or TypeScript import resolution may fail before tests run; fix missing commas or braces.

- [ ] **Step 4: Commit Task 4 changes if commits were requested for this execution**

Run only if the user explicitly requested commits:

```bash
git add apps/webapp/messages/timeTracking/en.json apps/webapp/messages/timeTracking/de.json
git commit -m "feat: add session reminder copy"
```

## Task 5: Final Verification And Cleanup Decision

**Files:**
- Inspect: `apps/webapp/src/components/time-tracking/break-reminder.tsx`
- Inspect: `apps/webapp/src/components/wellness/water-reminder.tsx`
- Inspect: `apps/webapp/src/components/time-tracking/session-reminder-panel.tsx`
- Inspect: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/time-tracking/session-reminder-panel.test.tsx src/components/time-tracking/manual-time-entry-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run package tests if time allows**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated tests fail, record the failing test names and error messages in the final response without changing unrelated code.

- [ ] **Step 3: Run a source search for obsolete imports**

Run:

```bash
rg "@/components/time-tracking/break-reminder|@/components/wellness/water-reminder|<BreakReminder|<WaterReminder" apps/webapp/src
```

Expected: no imports/usages in `ClockInOutWidget`. Component definition files may remain.

- [ ] **Step 4: Decide whether to delete old components**

If the search shows no usages and the user wants cleanup, delete:

```text
apps/webapp/src/components/time-tracking/break-reminder.tsx
apps/webapp/src/components/wellness/water-reminder.tsx
```

If the user did not request cleanup, leave them in place to minimize the change.

- [ ] **Step 5: Commit final changes if commits were requested for this execution**

Run only if the user explicitly requested commits:

```bash
git add apps/webapp/src/components/time-tracking/session-reminder-panel.tsx apps/webapp/src/components/time-tracking/session-reminder-panel.test.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx apps/webapp/messages/timeTracking/en.json apps/webapp/messages/timeTracking/de.json
git commit -m "feat: unify time tracking reminders"
```

## Self-Review Notes

- Spec coverage: the plan covers a unified panel, break priority, hydration secondary actions, zero-minute break handling, responsive compact layout, accessibility via real buttons and labels, unchanged backend/settings logic, and focused tests.
- Placeholder scan: no unfinished markers or unspecified implementation steps remain.
- Type consistency: the plan uses `SessionReminderPanel`, `isClockedIn`, `sessionStartTime`, existing `useWaterReminder`, existing `useHydrationStats`, existing `getBreakReminderStatus`, and existing `queryKeys.timeClock.breakStatus()` consistently.
