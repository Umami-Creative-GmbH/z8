# Desktop Refresh Work Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the desktop app safely and let users choose the webapp-supported work location when clocking in.

**Architecture:** Keep the feature inside `apps/desktop`: a small frontend selector persists the selected location in `localStorage`, `useClock` passes it to the Tauri command, and Rust sends it as `workLocationType` to the existing `/api/time-entries` API. Offline queue payloads already exist, so queued clock-ins can store the selected location without schema changes.

**Tech Stack:** pnpm workspace, Vite, React 19, Tauri 2, Rust, reqwest, SQLite offline queue.

---

## File Structure

- Modify `apps/desktop/package.json`: refresh safe frontend CSS tooling versions if `pnpm --filter desktop update` changes them.
- Modify `pnpm-lock.yaml`: dependency lockfile updates from the desktop refresh command.
- Modify `apps/desktop/src/types/index.ts`: define `WorkLocationType` and supported option metadata for desktop UI reuse.
- Create `apps/desktop/src/hooks/useWorkLocation.ts`: read/write selected work location from `localStorage` with validation and default fallback.
- Create `apps/desktop/src/components/WorkLocationSelector.tsx`: compact accessible selector shown only before clock-in.
- Modify `apps/desktop/src/hooks/useClock.ts`: accept a work-location value and pass it to the Tauri `clock_in` command.
- Modify `apps/desktop/src/App.tsx`: wire selected location into `clockIn` and render the selector near the clock button.
- Modify `apps/desktop/src/styles.css`: add restrained selector styles that match the current desktop visual language.
- Modify `apps/desktop/src-tauri/src/clock.rs`: validate and serialize work-location values into clock-in request bodies.
- Modify `apps/desktop/src-tauri/src/commands.rs`: accept `work_location_type` in the `clock_in` command and store it in offline queue payloads on network failure.
- Modify `apps/desktop/src-tauri/src/offline.rs`: replay queued clock-ins with their stored work-location payload, falling back to `office` if older queued rows have no payload.

## Task 1: Refresh Safe Desktop Dependencies

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Confirm current outdated desktop packages**

Run:

```bash
pnpm --filter desktop outdated
```

Expected: reports only safe desktop CSS tooling updates similar to `postcss`, `tailwindcss`, and `@tailwindcss/postcss`. If native Tauri packages appear, do not update them in this task.

- [ ] **Step 2: Update only the safe desktop packages**

Run:

```bash
pnpm --filter desktop update postcss tailwindcss @tailwindcss/postcss
```

Expected: `apps/desktop/package.json` and `pnpm-lock.yaml` update. No Tauri, React, Vite, or Rust dependencies are intentionally changed by this command.

- [ ] **Step 3: Verify the desktop frontend still builds**

Run:

```bash
pnpm --filter desktop build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 4: Commit if commit approval is active**

Run only if the user explicitly approved commits for this implementation session:

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore: refresh desktop css tooling"
```

Expected: commit succeeds. If commits are not approved, leave changes uncommitted and continue.

## Task 2: Add Shared Desktop Work Location Types

**Files:**
- Modify: `apps/desktop/src/types/index.ts`

- [ ] **Step 1: Add the desktop work-location type and option metadata**

Edit `apps/desktop/src/types/index.ts` so the top of the file contains this before `ClockStatus`:

```ts
export const WORK_LOCATION_OPTIONS = [
  { value: "office", label: "Office / On-site" },
  { value: "home", label: "Home" },
  { value: "remote", label: "Remote" },
  { value: "other", label: "Other" },
] as const;

export type WorkLocationType = (typeof WORK_LOCATION_OPTIONS)[number]["value"];

export function isWorkLocationType(value: string | null | undefined): value is WorkLocationType {
  return WORK_LOCATION_OPTIONS.some((option) => option.value === value);
}

export interface ClockStatus {
```

Keep the rest of the existing interfaces unchanged.

- [ ] **Step 2: Run TypeScript build to catch export mistakes**

Run:

```bash
pnpm --filter desktop build
```

Expected: build passes because the new exports are not wired in yet and do not break existing code.

- [ ] **Step 3: Commit if commit approval is active**

Run only if the user explicitly approved commits for this implementation session:

```bash
git add apps/desktop/src/types/index.ts
git commit -m "feat: define desktop work location options"
```

Expected: commit succeeds. If commits are not approved, leave changes uncommitted and continue.

## Task 3: Persist Selected Work Location In The Desktop UI

**Files:**
- Create: `apps/desktop/src/hooks/useWorkLocation.ts`

- [ ] **Step 1: Create the hook**

Create `apps/desktop/src/hooks/useWorkLocation.ts` with this content:

```ts
import { useState } from "react";
import { isWorkLocationType, type WorkLocationType } from "../types";

const WORK_LOCATION_KEY = "z8-work-location-type";
const DEFAULT_WORK_LOCATION: WorkLocationType = "office";

function getStoredWorkLocation(): WorkLocationType {
  if (typeof window === "undefined") {
    return DEFAULT_WORK_LOCATION;
  }

  const storedValue = localStorage.getItem(WORK_LOCATION_KEY);
  return isWorkLocationType(storedValue) ? storedValue : DEFAULT_WORK_LOCATION;
}

export function useWorkLocation() {
  const [workLocationType, setWorkLocationTypeState] = useState<WorkLocationType>(
    getStoredWorkLocation,
  );

  const setWorkLocationType = (nextWorkLocationType: WorkLocationType) => {
    setWorkLocationTypeState(nextWorkLocationType);
    localStorage.setItem(WORK_LOCATION_KEY, nextWorkLocationType);
  };

  return { workLocationType, setWorkLocationType };
}
```

- [ ] **Step 2: Run TypeScript build**

Run:

```bash
pnpm --filter desktop build
```

Expected: build passes.

- [ ] **Step 3: Commit if commit approval is active**

Run only if the user explicitly approved commits for this implementation session:

```bash
git add apps/desktop/src/hooks/useWorkLocation.ts
git commit -m "feat: persist desktop work location"
```

Expected: commit succeeds. If commits are not approved, leave changes uncommitted and continue.

## Task 4: Add The Work Location Selector Component

**Files:**
- Create: `apps/desktop/src/components/WorkLocationSelector.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Create the selector component**

Create `apps/desktop/src/components/WorkLocationSelector.tsx` with this content:

```tsx
import { MapPin } from "lucide-react";
import { WORK_LOCATION_OPTIONS, type WorkLocationType } from "../types";

interface WorkLocationSelectorProps {
  value: WorkLocationType;
  onChange: (value: WorkLocationType) => void;
  disabled?: boolean;
}

export function WorkLocationSelector({ value, onChange, disabled }: WorkLocationSelectorProps) {
  return (
    <div className="work-location-selector" aria-label="Work location">
      <div className="work-location-label">
        <MapPin size={14} aria-hidden="true" />
        <span>Work location</span>
      </div>
      <div className="work-location-options" role="radiogroup" aria-label="Work location">
        {WORK_LOCATION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`work-location-option ${value === option.value ? "work-location-option-active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add selector styles**

Add this block in `apps/desktop/src/styles.css` after the `.clock-action-stop` rule:

```css
/* Work Location Selector */
.work-location-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(100%, 320px);
}

.work-location-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.work-location-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}

.work-location-option {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-card);
  color: var(--color-muted-foreground);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 9px 10px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.work-location-option:hover:not(:disabled) {
  background: var(--color-muted);
  color: var(--color-foreground);
}

.work-location-option:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.work-location-option-active {
  border-color: var(--color-primary);
  background: hsl(221.2 83.2% 53.3% / 0.1);
  color: var(--color-primary);
  box-shadow: 0 1px 8px hsl(221.2 83.2% 53.3% / 0.14);
}

.work-location-option:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
```

- [ ] **Step 3: Run TypeScript build**

Run:

```bash
pnpm --filter desktop build
```

Expected: build passes.

- [ ] **Step 4: Commit if commit approval is active**

Run only if the user explicitly approved commits for this implementation session:

```bash
git add apps/desktop/src/components/WorkLocationSelector.tsx apps/desktop/src/styles.css
git commit -m "feat: add desktop work location selector"
```

Expected: commit succeeds. If commits are not approved, leave changes uncommitted and continue.

## Task 5: Wire The Selector Into Clock-In

**Files:**
- Modify: `apps/desktop/src/hooks/useClock.ts`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Update `useClock` to pass a work-location value**

In `apps/desktop/src/hooks/useClock.ts`, change the type import and clock-in mutation to this:

```ts
import type { ClockStatus, WorkLocationType } from "../types";
```

Replace the current `clockInMutation` block with:

```ts
  const clockInMutation = useMutation({
    mutationFn: (workLocationType: WorkLocationType) =>
      invoke<ClockStatus>("clock_in", { workLocationType }),
    onSuccess: (data) => {
      queryClient.setQueryData(["clock-status"], data);
    },
  });
```

- [ ] **Step 2: Update `App.tsx` imports and hook usage**

In `apps/desktop/src/App.tsx`, add these imports:

```ts
import { WorkLocationSelector } from "./components/WorkLocationSelector";
import { useWorkLocation } from "./hooks/useWorkLocation";
```

Inside `AppContent`, after `const { theme, setTheme, resolvedTheme } = useTheme();`, add:

```ts
  const { workLocationType, setWorkLocationType } = useWorkLocation();
```

- [ ] **Step 3: Pass selected location to clock-in**

Replace `handleClockIn` in `apps/desktop/src/App.tsx` with:

```ts
  const handleClockIn = async () => {
    try {
      await clockIn(workLocationType);
      toast.success("Clocked in successfully");
    } catch (error) {
      toast.error("Failed to clock in");
      console.error(error);
    }
  };
```

- [ ] **Step 4: Render selector only when not clocked in**

In `apps/desktop/src/App.tsx`, replace the `<main className="app-main">` contents with:

```tsx
        {!isClockedIn && (
          <WorkLocationSelector
            value={workLocationType}
            onChange={setWorkLocationType}
            disabled={isClockingIn || isClockingOut}
          />
        )}
        <ClockButton
          isClockedIn={isClockedIn}
          startTime={activeWorkPeriod?.startTime ?? null}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          isLoading={isClockingIn || isClockingOut}
        />
```

- [ ] **Step 5: Adjust main layout spacing for selector plus clock button**

In `apps/desktop/src/styles.css`, update `.app-main` to include vertical layout:

```css
.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 24px;
}
```

- [ ] **Step 6: Run TypeScript build**

Run:

```bash
pnpm --filter desktop build
```

Expected: build passes and confirms the React/Tauri invoke call shape compiles.

- [ ] **Step 7: Commit if commit approval is active**

Run only if the user explicitly approved commits for this implementation session:

```bash
git add apps/desktop/src/hooks/useClock.ts apps/desktop/src/App.tsx apps/desktop/src/styles.css
git commit -m "feat: send work location from desktop clock in"
```

Expected: commit succeeds. If commits are not approved, leave changes uncommitted and continue.

## Task 6: Send Work Location From Rust To The Web API

**Files:**
- Modify: `apps/desktop/src-tauri/src/clock.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/offline.rs`

- [ ] **Step 1: Add Rust work-location validation and serialization**

In `apps/desktop/src-tauri/src/clock.rs`, add this type after `ApiResponse<T>`:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkLocationType {
    Office,
    Home,
    Remote,
    Other,
}

impl WorkLocationType {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "office" => Some(Self::Office),
            "home" => Some(Self::Home),
            "remote" => Some(Self::Remote),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Office => "office",
            Self::Home => "home",
            Self::Remote => "remote",
            Self::Other => "other",
        }
    }
}
```

- [ ] **Step 2: Update Rust clock-in request body**

In `apps/desktop/src-tauri/src/clock.rs`, change the `clock_in` signature and body from `pub async fn clock_in(&self, webapp_url: &str, token: &str) -> Result<TimeEntry>` to:

```rust
    pub async fn clock_in(
        &self,
        webapp_url: &str,
        token: &str,
        work_location_type: WorkLocationType,
    ) -> Result<TimeEntry> {
        let url = format!("{}/api/time-entries", webapp_url.trim_end_matches('/'));

        let body = serde_json::json!({
            "type": "clock_in",
            "workLocationType": work_location_type.as_str(),
        });
```

Keep the existing response handling below that block unchanged.

- [ ] **Step 3: Update Tauri command imports and signature**

In `apps/desktop/src-tauri/src/commands.rs`, change the clock import to:

```rust
use crate::clock::{ClockService, ClockStatus, WorkLocationType};
```

Change the `clock_in` command signature to:

```rust
pub async fn clock_in(app_handle: AppHandle, work_location_type: String) -> Result<ClockStatus, String> {
```

After the webapp URL empty check, add:

```rust
    let work_location_type = WorkLocationType::from_str(&work_location_type)
        .ok_or("Invalid work location type".to_string())?;
```

Change the online clock-in call to:

```rust
    match clock_service.clock_in(&webapp_url, &token, work_location_type).await {
```

Change the offline queue enqueue line for `ActionType::ClockIn` to:

```rust
                let _ = queue.enqueue(
                    ActionType::ClockIn,
                    Utc::now().timestamp(),
                    Some(work_location_type.as_str().to_string()),
                );
```

- [ ] **Step 4: Replay queued clock-ins with payload fallback**

In `apps/desktop/src-tauri/src/offline.rs`, change the clock import to:

```rust
use crate::clock::{ClockService, WorkLocationType};
```

Replace the `ActionType::ClockIn` match arm with:

```rust
                ActionType::ClockIn => {
                    let work_location_type = action
                        .payload
                        .as_deref()
                        .and_then(WorkLocationType::from_str)
                        .unwrap_or(WorkLocationType::Office);

                    clock_service
                        .clock_in(&webapp_url, &token, work_location_type)
                        .await
                        .map(|_| ())
                }
```

- [ ] **Step 5: Run Rust check for the Tauri crate**

Run:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: Rust code compiles. If the build environment lacks native system libraries required by Tauri, capture the exact missing dependency in the final implementation summary and still run the frontend build.

- [ ] **Step 6: Run desktop frontend build**

Run:

```bash
pnpm --filter desktop build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 7: Commit if commit approval is active**

Run only if the user explicitly approved commits for this implementation session:

```bash
git add apps/desktop/src-tauri/src/clock.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/offline.rs
git commit -m "feat: persist desktop work location on clock in"
```

Expected: commit succeeds. If commits are not approved, leave changes uncommitted and continue.

## Task 7: Final Verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run frontend build**

Run:

```bash
pnpm --filter desktop build
```

Expected: build passes.

- [ ] **Step 2: Run Rust check**

Run:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: Rust check passes, or fails only because the local machine lacks native Tauri system libraries. Any code-level Rust error must be fixed before completion.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git diff -- apps/desktop/package.json pnpm-lock.yaml apps/desktop/src apps/desktop/src-tauri/src
```

Expected: diff shows only the safe dependency refresh, work-location UI, React/Tauri wiring, Rust API serialization, and offline queue payload replay.

- [ ] **Step 4: Final commit if commit approval is active and changes remain uncommitted**

Run only if the user explicitly approved commits and there are still staged implementation changes:

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src apps/desktop/src-tauri/src
git commit -m "feat: add desktop work location clock in"
```

Expected: commit succeeds. If commits are not approved, leave changes uncommitted and report the modified files.

## Self-Review

- Spec coverage: dependency refresh is covered by Task 1; selector/default/persistence is covered by Tasks 2-5; API flow is covered by Tasks 5-6; offline behavior is covered by Task 6; verification is covered by Task 7.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: frontend uses `WorkLocationType` values `office`, `home`, `remote`, and `other`; Rust validates and serializes the same values; queued payload fallback uses `office` for old rows.
