# Browser Extension Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the browser extension UI and reliability while preserving existing clock, offline, project, notification, settings, and badge behavior.

**Architecture:** Keep the existing Vite/React/MV3 structure. Add small storage and formatting helpers, then refresh popup/options components around the current hooks and background worker. Do not add webapp API endpoints or change the settings schema.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack React Query, Chrome Extension MV3 APIs, pnpm.

---

## File Structure

- Modify: `apps/extension/src/lib/storage.ts` to add local `lastAction` persistence while keeping existing settings/queue APIs.
- Create: `apps/extension/src/lib/time.ts` for compact local time and elapsed formatting used by popup/status UI.
- Modify: `apps/extension/src/background/background.ts` to mark queued last actions as synced after successful queue processing.
- Modify: `apps/extension/src/popup/hooks/useClock.ts` to expose `lastAction`, write it after online/offline clock mutations, and keep existing optimistic/offline behavior.
- Modify: `apps/extension/src/popup/hooks/useTimer.ts` to reuse shared elapsed formatting.
- Create: `apps/extension/src/popup/components/StatusCard.tsx` for active/inactive/session/last-action context.
- Modify: `apps/extension/src/popup/Popup.tsx` to compose the refreshed popup.
- Modify: popup components in `apps/extension/src/popup/components/*.tsx` to switch from emerald styling to Z8 blue/neutral styling and improve state copy.
- Modify: `apps/extension/src/options/Options.tsx` to refresh the settings UI while preserving stored settings and validation.
- Review: `apps/extension/manifest.json` for permission fit; only change it if implementation proves a permission is unused.

## Task 1: Local Last-Action Storage

**Files:**
- Modify: `apps/extension/src/lib/storage.ts`
- Modify: `apps/extension/src/types/index.ts`

- [ ] **Step 1: Add the last-action types and storage methods**

In `apps/extension/src/lib/storage.ts`, add this interface after `QueuedAction`:

```ts
export interface LastAction {
  type: "clock_in" | "clock_out";
  timestamp: string;
  syncState: "synced" | "queued";
}
```

Add these methods before the closing `};` of `storage`:

```ts
  async getLastAction(): Promise<LastAction | null> {
    try {
      const result = (await chrome.storage.local.get(["lastAction"])) as {
        lastAction?: LastAction | null;
      };
      return result.lastAction || null;
    } catch {
      return null;
    }
  },

  async setLastAction(action: LastAction | null): Promise<void> {
    if (action === null) {
      await chrome.storage.local.remove(["lastAction"]);
      return;
    }

    await chrome.storage.local.set({ lastAction: action });
  },

  async markLastActionSynced(action: Pick<LastAction, "type" | "timestamp">): Promise<void> {
    const lastAction = await this.getLastAction();
    if (
      lastAction?.syncState === "queued" &&
      lastAction.type === action.type &&
      lastAction.timestamp === action.timestamp
    ) {
      await this.setLastAction({ ...lastAction, syncState: "synced" });
    }
  },
```

In `apps/extension/src/types/index.ts`, update the re-export:

```ts
export type { QueuedAction, ExtensionSettings, LastAction } from "@/lib/storage";
```

- [ ] **Step 2: Run the extension build**

Run: `pnpm --filter extension build`

Expected: build may fail only if object comma placement or exported types are wrong. Fix those exact TypeScript syntax errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/lib/storage.ts apps/extension/src/types/index.ts
git commit -m "feat: store extension last action state"
```

## Task 2: Shared Time Formatting

**Files:**
- Create: `apps/extension/src/lib/time.ts`
- Modify: `apps/extension/src/popup/hooks/useTimer.ts`

- [ ] **Step 1: Create shared time helpers**

Create `apps/extension/src/lib/time.ts`:

```ts
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const pad = (value: number) => value.toString().padStart(2, "0");

export function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatClockTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return timeFormatter.format(date);
}

export function formatActionTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  return isToday ? timeFormatter.format(date) : dateTimeFormatter.format(date);
}
```

- [ ] **Step 2: Reuse elapsed formatter in `useTimer`**

In `apps/extension/src/popup/hooks/useTimer.ts`, replace the local `pad` and `formatTime` implementation with:

```ts
import { useEffect, useState } from "react";
import { formatElapsedTime } from "@/lib/time";

export function useTimer(startTime: string | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const startDate = new Date(startTime).getTime();

    const updateElapsed = () => {
      const now = Date.now();
      setElapsedSeconds(Math.floor((now - startDate) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return elapsedSeconds;
}

export const formatTime = formatElapsedTime;
```

- [ ] **Step 3: Build**

Run: `pnpm --filter extension build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/lib/time.ts apps/extension/src/popup/hooks/useTimer.ts
git commit -m "refactor: share extension time formatting"
```

## Task 3: Wire Last Action Through Clock And Background Flow

**Files:**
- Modify: `apps/extension/src/popup/hooks/useClock.ts`
- Modify: `apps/extension/src/background/background.ts`

- [ ] **Step 1: Load and update last action in `useClock`**

In `apps/extension/src/popup/hooks/useClock.ts`, add a `lastAction` state next to queue state:

```ts
  const [lastAction, setLastAction] = useState<Awaited<ReturnType<typeof storage.getLastAction>>>(null);
```

Add this effect after the queue-length effect:

```ts
  useEffect(() => {
    let isMounted = true;

    const loadLastAction = async () => {
      const action = await storage.getLastAction();
      if (isMounted) {
        setLastAction(action);
      }
    };

    loadLastAction();

    return () => {
      isMounted = false;
    };
  }, []);
```

In the offline clock-in branch, replace the queue/optimistic block with:

```ts
        await storage.addToQueue({ type: "clock_in", timestamp });
        await storage.setOptimisticState({ isClockedIn: true, startTime: timestamp });
        const action = { type: "clock_in" as const, timestamp, syncState: "queued" as const };
        await storage.setLastAction(action);
        setLastAction(action);
        return { entry: { id: "queued", type: "clock_in" as const, timestamp, employeeId: "" } };
```

After `const result = await api.clockIn();`, add:

```ts
      const action = { type: "clock_in" as const, timestamp, syncState: "synced" as const };
      await storage.setLastAction(action);
      setLastAction(action);
```

In the offline clock-out branch, replace the queue/optimistic block with:

```ts
        await storage.addToQueue({ type: "clock_out", projectId, timestamp });
        await storage.setOptimisticState({ isClockedIn: false, startTime: null });
        const action = { type: "clock_out" as const, timestamp, syncState: "queued" as const };
        await storage.setLastAction(action);
        setLastAction(action);
        return { entry: { id: "queued", type: "clock_out" as const, timestamp, employeeId: "" } };
```

After `const result = await api.clockOut(projectId);`, add:

```ts
      const action = { type: "clock_out" as const, timestamp, syncState: "synced" as const };
      await storage.setLastAction(action);
      setLastAction(action);
```

Add `lastAction` to the returned object.

- [ ] **Step 2: Mark queued last action synced in background worker**

In `apps/extension/src/background/background.ts`, after `await storage.removeFromQueue(action.id);`, add:

```ts
        await storage.markLastActionSynced({
          type: action.type,
          timestamp: action.timestamp,
        });
```

- [ ] **Step 3: Build**

Run: `pnpm --filter extension build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup/hooks/useClock.ts apps/extension/src/background/background.ts
git commit -m "feat: surface extension last action context"
```

## Task 4: Add Refreshed Popup Status Card

**Files:**
- Create: `apps/extension/src/popup/components/StatusCard.tsx`
- Modify: `apps/extension/src/popup/components/Timer.tsx`
- Modify: `apps/extension/src/popup/Popup.tsx`

- [ ] **Step 1: Create `StatusCard`**

Create `apps/extension/src/popup/components/StatusCard.tsx`:

```tsx
import { formatActionTime, formatClockTime } from "@/lib/time";
import type { LastAction } from "@/types";

interface StatusCardProps {
  isClockedIn: boolean;
  isOffline: boolean;
  queueLength: number;
  startTime?: string | null;
  lastAction: LastAction | null;
}

function getLastActionText(action: LastAction | null): string {
  if (!action) {
    return "No recent extension action";
  }

  const label = action.type === "clock_in" ? "Clocked in" : "Clocked out";
  const syncLabel = action.syncState === "queued" ? "queued" : "synced";
  return `${label} at ${formatActionTime(action.timestamp)} (${syncLabel})`;
}

export function StatusCard({
  isClockedIn,
  isOffline,
  queueLength,
  startTime,
  lastAction,
}: StatusCardProps) {
  const statusLabel = isClockedIn ? "Working now" : "Ready when you are";
  const detail = isClockedIn && startTime
    ? `Started at ${formatClockTime(startTime)}`
    : "Use Z8 to keep today accurate.";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">
            Current status
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{statusLabel}</h2>
          <p className="mt-1 text-sm text-slate-500">{detail}</p>
        </div>
        <div className="rounded-full bg-blue-50 p-2 text-blue-600">
          {isClockedIn ? <Clock3 className="h-5 w-5" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-slate-600">
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
          <span>{getLastActionText(lastAction)}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
          <span className="flex items-center gap-1.5">
            {isOffline ? <CloudOff className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" /> : <Cloud className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />}
            {isOffline ? "Offline" : "Online"}
          </span>
          <span>{queueLength} queued</span>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Refresh timer styling**

In `apps/extension/src/popup/components/Timer.tsx`, replace the returned `div` class with:

```tsx
      className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-4 font-mono text-3xl font-semibold text-white shadow-sm"
```

- [ ] **Step 3: Compose popup with `StatusCard`**

In `apps/extension/src/popup/Popup.tsx`, import `StatusCard` and destructure `lastAction` from `useClock()`.

Replace the main returned content inside `PopupContent` with a `div` using this structure:

```tsx
      <div className="space-y-4 p-4">
        <StatusCard
          isClockedIn={isClockedIn}
          isOffline={isOffline}
          queueLength={queueLength}
          startTime={activeWorkPeriod?.startTime}
          lastAction={lastAction}
        />

        {isClockedIn && activeWorkPeriod && (
          <Timer startTime={activeWorkPeriod.startTime} />
        )}

        <ClockButton
          isClockedIn={isClockedIn}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          isLoading={isClockingIn || isClockingOut}
        />

        {isClockedIn && !isOffline && projectsData?.projects && (
          <ProjectSelector
            projects={projectsData.projects}
            selectedId={selectedProjectId}
            onChange={setSelectedProjectId}
          />
        )}

        {isClockedIn && isOffline && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
            Project selection is available when online.
          </p>
        )}
      </div>
```

Change the outer popup wrapper class to:

```tsx
<div className="w-80 bg-slate-50 text-slate-950">
```

- [ ] **Step 4: Build**

Run: `pnpm --filter extension build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/popup/components/StatusCard.tsx apps/extension/src/popup/components/Timer.tsx apps/extension/src/popup/Popup.tsx
git commit -m "feat: refresh extension popup status card"
```

## Task 5: Refresh Popup Supporting States

**Files:**
- Modify: `apps/extension/src/popup/components/Header.tsx`
- Modify: `apps/extension/src/popup/components/ClockButton.tsx`
- Modify: `apps/extension/src/popup/components/ProjectSelector.tsx`
- Modify: `apps/extension/src/popup/components/OfflineBanner.tsx`
- Modify: `apps/extension/src/popup/components/LoginRequired.tsx`
- Modify: `apps/extension/src/popup/components/NoEmployee.tsx`
- Modify: `apps/extension/src/popup/components/ErrorState.tsx`

- [ ] **Step 1: Replace emerald classes with blue/neutral classes**

Use these class replacements consistently:

```txt
bg-emerald-500 -> bg-blue-600
hover:bg-emerald-600 -> hover:bg-blue-700
active:bg-emerald-700 -> active:bg-blue-800
text-emerald-500 -> text-blue-600
text-emerald-600 -> text-blue-700
focus:ring-emerald-500 -> focus:ring-blue-600
border-gray-100 -> border-slate-200
text-gray-900 -> text-slate-950
text-gray-700 -> text-slate-700
text-gray-600 -> text-slate-600
text-gray-500 -> text-slate-500
text-gray-400 -> text-slate-400
bg-gray-100 -> bg-slate-100
hover:bg-gray-200 -> hover:bg-slate-200
```

For `ClockButton`, keep clock-out destructive styling red. Change only the clock-in branch to blue:

```ts
isClockedIn
  ? "bg-red-500 hover:bg-red-600 active:bg-red-700"
  : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
```

- [ ] **Step 2: Improve button focus states**

Every interactive button touched in this task should include:

```txt
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2
```

- [ ] **Step 3: Build**

Run: `pnpm --filter extension build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup/components
git commit -m "style: align extension popup with Z8 brand"
```

## Task 6: Refresh Options Page

**Files:**
- Modify: `apps/extension/src/options/Options.tsx`

- [ ] **Step 1: Update visual classes without changing state logic**

In `Options.tsx`, keep all hooks, validation, save, test, and notification handlers unchanged. Replace emerald/gray styling with blue/slate equivalents using the same class mapping from Task 5.

Also update the main shell classes:

```tsx
<div className="min-h-screen bg-slate-100 py-12 text-slate-950">
```

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
```

Change the brand tile to:

```tsx
<div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
```

- [ ] **Step 2: Improve form focus states**

Ensure the URL input has:

```txt
focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent
```

Ensure checkboxes use:

```txt
text-blue-600 focus:ring-blue-600
```

- [ ] **Step 3: Build**

Run: `pnpm --filter extension build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/options/Options.tsx
git commit -m "style: refresh extension options page"
```

## Task 7: Manifest And Final Verification

**Files:**
- Review: `apps/extension/manifest.json`
- Review: `apps/extension/src/**/*`

- [ ] **Step 1: Review manifest permissions**

Check whether each permission is still used:

```txt
storage: used by settings, queue, optimistic state, last action
alarms: used by background status check
notifications: used by notification helper and options test
host_permissions: required for configured webapp API requests
```

Expected: no permission removal unless code inspection proves a permission is unused.

- [ ] **Step 2: Run final build**

Run: `pnpm --filter extension build`

Expected: PASS.

- [ ] **Step 3: Check changed files**

Run: `git diff --stat`

Expected: changes are limited to the extension refresh files and this plan/spec work.

- [ ] **Step 4: Commit final adjustments if any**

If Task 7 produced code changes:

```bash
git add apps/extension/manifest.json apps/extension/src
git commit -m "chore: verify extension manifest permissions"
```

If Task 7 produced no code changes, skip this commit.

## Self-Review Notes

- Spec coverage: popup UI, options UI, last-action context, background sync metadata, offline distinction, no webapp API changes, no env vars, accessibility, and build verification are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `LastAction`, `syncState`, `getLastAction`, `setLastAction`, and `markLastActionSynced` names are consistent across tasks.
