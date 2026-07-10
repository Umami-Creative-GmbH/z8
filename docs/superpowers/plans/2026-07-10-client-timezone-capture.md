# Mobile And Extension Timezone Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture mobile and extension device timezone at clock-action time and preserve the original timezone and organization through extension offline replay.

**Architecture:** Clients submit only canonical instant/organization and validated IANA timezone evidence; the server derives offsets. Mobile remains online-only. Extension uses one immutable captured-action record for online submission, queue storage, optimistic state, and replay so sync-time context cannot replace action-time evidence.

**Tech Stack:** Expo/React Native, Chrome Manifest V3, TypeScript, `temporal-polyfill`, Next.js APIs, Vitest, pnpm.

**Prerequisite:** Complete the Temporal foundation, Core web, and Telegram/shared-clocking plans dated 2026-07-10.

---

## File Map

- Web APIs: strict timestamp/timezone validation and additive organization context.
- Mobile `clock-action.ts`: action-time timezone capture for online requests.
- Extension `clock-action.ts`: one captured action contract.
- Extension queue storage/replay: preserve original timezone and organization.
- No mobile offline queue is added; the approved mobile MVP remains online-only.
- Clients never submit `utcOffsetMinutes` or `timezoneSource`.

### Task 1: Harden Clock APIs And Expose Trusted Organization Context

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/route.ts`
- Modify: `apps/webapp/src/app/api/time-entries/route.test.ts`
- Modify: `apps/webapp/src/app/api/time-entries/status/route.ts`
- Create: `apps/webapp/src/app/api/time-entries/status/route.test.ts`
- Modify: `apps/webapp/src/app/api/mobile/time-clock/route.ts`
- Create: `apps/webapp/src/app/api/mobile/time-clock/route.test.ts`

- [ ] **Step 1: Write failing direct API tests**

Assert valid Kathmandu evidence derives offset `345`, invalid non-null timezone returns 400 before transaction, zone-less offline timestamp returns 400, client `utcOffsetMinutes` is ignored, and null/missing evidence falls back to saved timezone with source `user_setting`.

```ts
expect(createTimeEntry).toHaveBeenCalledWith(
	expect.objectContaining({
		timezone: "Asia/Kathmandu",
		timezoneSource: "browser",
		utcOffsetMinutes: 345,
	}),
	expect.anything(),
);
```

- [ ] **Step 2: Write failing status/mobile organization tests**

Status returns `organizationId` for an active employee and null for unauthenticated/no-employee responses. Mobile accepts `{ organizationId, browserTimezone }`, passes valid evidence to shared clocking, and returns 409 if supplied organization differs from the active session organization.

- [ ] **Step 3: Verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/app/api/time-entries/route.test.ts' \
  'src/app/api/time-entries/status/route.test.ts' \
  'src/app/api/mobile/time-clock/route.test.ts'
```

Expected: FAIL because status lacks organization and validation is permissive.

- [ ] **Step 4: Implement strict server handling**

Parse timestamps through foundation `parseInstant`; use `systemClock.nowInstant()` when omitted. Validate supplied non-null `browserTimezone` with `isValidIanaTimeZone` before DB work. Ignore any client offset field. Resolve capture from the accepted instant and timezone.

Mobile request contract:

```ts
type MobileTimeClockRequest =
	| {
			action: "clock_in";
			workLocationType: WorkLocationType;
			organizationId?: string;
			browserTimezone?: string | null;
	  }
	| {
			action: "clock_out";
			organizationId?: string;
			browserTimezone?: string | null;
	  };
```

Keep fields optional only for shipped-client compatibility. Updated clients always send both. Compare provided organization with authenticated active organization and return 409 on mismatch.

- [ ] **Step 5: Verify and commit**

Run the Step 3 command. Expected: PASS.

```bash
git add apps/webapp/src/app/api/time-entries apps/webapp/src/app/api/mobile/time-clock
git commit -m "fix(api): validate clock action timezone evidence"
```

### Task 2: Capture Mobile Action-Time Timezone

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/src/features/home/clock-action.ts`
- Create: `apps/mobile/src/features/home/clock-action.test.ts`
- Modify: `apps/mobile/src/features/home/use-home-query.ts`
- Create: `apps/mobile/src/features/home/use-home-query.test.tsx`
- Regenerate: `pnpm-lock.yaml`

- [ ] **Step 1: Add `temporal-polyfill` with pnpm**

```bash
pnpm --filter mobile add temporal-polyfill@1.0.1
```

Expected: mobile manifest and lockfile include the same implementation/version as webapp.

- [ ] **Step 2: Write failing capture tests**

```ts
expect(getActionTimeTimezone(fakeIntl("Asia/Kathmandu"))).toBe("Asia/Kathmandu");
expect(getActionTimeTimezone(fakeIntl("Not/AZone"))).toBeNull();
expect(createMobileClockInAction({
	workLocationType: "remote",
	organizationId: "org-1",
	intlApi: fakeIntl("Europe/Berlin"),
})).toEqual({
	action: "clock_in",
	workLocationType: "remote",
	organizationId: "org-1",
	browserTimezone: "Europe/Berlin",
});
```

Hook test changes fake timezone between clock-in and clock-out and asserts each request captures the value at invocation time.

- [ ] **Step 3: Verify red**

```bash
pnpm --filter mobile exec vitest run 'src/features/home/clock-action.test.ts' 'src/features/home/use-home-query.test.tsx'
```

Expected: FAIL because the helper is missing and payload omits evidence.

- [ ] **Step 4: Implement mobile capture**

```ts
import { Temporal } from "temporal-polyfill";

export function getActionTimeTimezone(
	intlApi: Pick<typeof Intl, "DateTimeFormat"> | null = Intl,
): string | null {
	try {
		const value = intlApi?.DateTimeFormat().resolvedOptions().timeZone;
		if (!value) return null;
		Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value);
		return value;
	} catch {
		return null;
	}
}
```

Export clock-in/out action builders that require `organizationId` and call `getActionTimeTimezone()` inside the builder. In `useHomeQuery`, read active organization immediately before `mutateAsync`; reject if absent.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter mobile exec vitest run 'src/features/home/clock-action.test.ts' 'src/features/home/use-home-query.test.tsx' 'src/features/home'
git add apps/mobile/package.json apps/mobile/src/features/home pnpm-lock.yaml
git commit -m "feat(mobile): send action-time device timezone"
```

Expected: PASS. Do not add queue, NetInfo, offline success, or replay behavior.

### Task 3: Introduce One Extension Captured-Action Contract

**Files:**
- Modify: `apps/extension/package.json`
- Create: `apps/extension/src/lib/clock-action.ts`
- Create: `apps/extension/src/lib/clock-action.test.ts`
- Modify: `apps/extension/src/lib/storage.ts`
- Create: `apps/extension/src/lib/storage.test.ts`
- Modify: `apps/extension/src/lib/api.ts`
- Modify: `apps/extension/src/types/index.ts`
- Regenerate: `pnpm-lock.yaml`

- [ ] **Step 1: Add the existing Temporal implementation**

```bash
pnpm --filter extension add temporal-polyfill@1.0.1
```

- [ ] **Step 2: Write failing action and storage tests**

```ts
expect(captureClockInAction({
	organizationId: "org-1",
	clock: fixedClock("2026-07-10T12:30:00.123Z"),
	intlApi: fakeIntl("Asia/Kathmandu"),
})).toEqual({
	type: "clock_in",
	timestamp: "2026-07-10T12:30:00.123Z",
	organizationId: "org-1",
	browserTimezone: "Asia/Kathmandu",
});
```

Assert API body never contains `utcOffsetMinutes`/`timezoneSource`, null timezone is omitted on wire, and queue storage preserves organization/timezone.

- [ ] **Step 3: Verify red**

```bash
pnpm --filter extension exec vitest run 'src/lib/clock-action.test.ts' 'src/lib/storage.test.ts'
```

- [ ] **Step 4: Implement immutable action types**

```ts
export type CapturedClockAction =
	| {
			type: "clock_in";
			timestamp: string;
			organizationId: string;
			browserTimezone: string | null;
	  }
	| {
			type: "clock_out";
			timestamp: string;
			organizationId: string;
			browserTimezone: string | null;
			projectId?: string;
	  };

export interface QueuedAction extends CapturedClockAction {
	id: string;
	createdAt: string;
}
```

Use an injected clock returning `Temporal.Instant`, serialize with three fractional digits, validate device timezone as in mobile, and implement `toTimeEntryRequest(action)`. Replace positional API calls with `submitClockAction(action)`.

For legacy queue reads, normalize missing timezone to null but leave missing organization absent so replay can reject it instead of inventing sync-time organization.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter extension exec vitest run 'src/lib/clock-action.test.ts' 'src/lib/storage.test.ts'
pnpm --filter extension build
git add apps/extension/package.json apps/extension/src/lib apps/extension/src/types/index.ts pnpm-lock.yaml
git commit -m "feat(extension): capture scoped clock action evidence"
```

Expected: tests and build PASS.

### Task 4: Use Captured Actions For Extension Online And Offline Paths

**Files:**
- Modify: `apps/extension/src/popup/hooks/useClock.ts`
- Create: `apps/extension/src/popup/hooks/useClock.test.tsx`
- Modify: `apps/extension/src/types/index.ts`

- [ ] **Step 1: Write failing hook tests**

Cover online clock-in/out, offline queueing, timezone change between actions, missing trusted organization, project on clock-out, and optimistic state retaining organization.

```ts
expect(api.submitClockAction).toHaveBeenCalledWith({
	type: "clock_in",
	timestamp: "2026-07-10T12:30:00.000Z",
	organizationId: "org-1",
	browserTimezone: "Europe/Berlin",
});
```

- [ ] **Step 2: Verify red**

```bash
pnpm --filter extension exec vitest run 'src/popup/hooks/useClock.test.tsx'
```

Expected: FAIL because current hook calls positional API methods and queues partial records.

- [ ] **Step 3: Capture once per mutation**

Read `status.organizationId`; throw if absent. Create one action before checking network state. Submit that exact object online or queue it offline. Use the same `action.timestamp` for optimistic/last-action state; do not call a second clock.

Add `organizationId` to optimistic state and the additive status response type.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter extension exec vitest run 'src/popup/hooks/useClock.test.tsx' 'src/lib/clock-action.test.ts' 'src/lib/storage.test.ts'
pnpm --filter extension build
git add apps/extension/src/popup/hooks/useClock* apps/extension/src/types/index.ts
git commit -m "feat(extension): submit action-time clock evidence"
```

Expected: PASS.

### Task 5: Preserve Evidence During Extension Replay

**Files:**
- Create: `apps/extension/src/background/queue-processor.ts`
- Create: `apps/extension/src/background/queue-processor.test.ts`
- Modify: `apps/extension/src/background/background.ts`

- [ ] **Step 1: Write failing queue-processor tests**

Assert replay sends stored Berlin timezone even if current device zone differs; missing legacy timezone remains omitted; missing legacy organization is permanently rejected without request; actions process sequentially; 2xx removes and marks synced; 400/409 removes as permanent; 401/5xx/network retains and stops.

- [ ] **Step 2: Verify red**

```bash
pnpm --filter extension exec vitest run 'src/background/queue-processor.test.ts'
```

Expected: FAIL because queue logic is embedded in the MV3 side-effect module.

- [ ] **Step 3: Implement pure sequential processor**

```ts
export async function processQueuedActions(dependencies: {
	getQueuedActions(): Promise<Array<QueuedAction | LegacyQueuedAction>>;
	removeFromQueue(id: string): Promise<void>;
	markLastActionSynced(action: { type: string; timestamp: string }): Promise<void>;
	submit(body: TimeEntryClockRequest): Promise<Response>;
	onSynced(action: QueuedAction): Promise<void>;
	onPermanentFailure(action: QueuedAction | LegacyQueuedAction, message: string): Promise<void>;
}): Promise<{ processedCount: number; stopped: boolean }>;
```

The module must not reference `Intl`, current status, or active organization. It constructs requests only from stored records and requires stored organization ID. Keep `background.ts` limited to MV3 listeners, lock flag, dependency wiring, and notifications.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter extension exec vitest run 'src/background/queue-processor.test.ts' 'src/popup/hooks/useClock.test.tsx' 'src/lib/clock-action.test.ts' 'src/lib/storage.test.ts'
pnpm --filter extension build
git add apps/extension/src/background
git commit -m "fix(extension): preserve clock evidence during queue sync"
```

Expected: PASS.

### Task 6: Run Cross-Client Verification

**Files:**
- No production files.

- [ ] **Step 1: Run focused server/client suites**

```bash
pnpm --filter webapp exec vitest run 'src/app/api/time-entries/route.test.ts' 'src/app/api/time-entries/status/route.test.ts' 'src/app/api/mobile/time-clock/route.test.ts' 'src/lib/time-tracking/timezone-capture.test.ts'
pnpm --filter mobile exec vitest run 'src/features/home'
pnpm --filter extension exec vitest run 'src/lib/clock-action.test.ts' 'src/lib/storage.test.ts' 'src/popup/hooks/useClock.test.tsx' 'src/background/queue-processor.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run builds**

```bash
pnpm --filter mobile build
pnpm --filter extension build
CI=true pnpm --filter webapp build
```

Expected: all builds PASS.

- [ ] **Step 3: Run repository verification**

```bash
pnpm test
CI=true pnpm build
```

Expected: PASS. Mobile and extension send action-time timezone, extension replay preserves action-time timezone/organization, and server derives every offset.
