# Deployment Refresh Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Periodically detect stale browser bundles after redeploys and hard-refresh only when the tab is hidden or the user is idle.

**Architecture:** Add a no-store `/api/app-version` route that returns the current deployment hash from `env.NEXT_PUBLIC_BUILD_HASH`. Add a global client component mounted in the locale layout; it tracks recent user activity, checks the version endpoint every five minutes, and reloads once when the server hash differs from the client hash and the page is safe to refresh.

**Tech Stack:** Next.js 16 App Router, React 19, Vitest, Testing Library, TypeScript, existing `@/env` validation.

---

## File Structure

- Create `apps/webapp/src/app/api/app-version/route.ts`: unauthenticated route handler that returns `{ buildHash }` and no-store cache headers.
- Create `apps/webapp/src/app/api/app-version/route.test.ts`: route tests for JSON payload and cache headers.
- Create `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx`: client component plus pure helper functions for eligibility and changed-hash decisions.
- Create `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx`: helper and component tests using jsdom and fake timers.
- Create `apps/webapp/src/components/deployment-refresh/index.ts`: barrel export for the checker.
- Modify `apps/webapp/src/app/[locale]/layout.tsx`: mount `DeploymentRefreshChecker` near existing global client-only operational components.

## Task 1: App Version Route

**Files:**
- Create: `apps/webapp/src/app/api/app-version/route.test.ts`
- Create: `apps/webapp/src/app/api/app-version/route.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/webapp/src/app/api/app-version/route.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";

const { GET } = await import("./route");

describe("GET /api/app-version", () => {
	 it("returns the current build hash", async () => {
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ buildHash: "development" });
	});

	it("prevents caching stale deployment metadata", async () => {
		const response = await GET();

		expect(response.headers.get("cache-control")).toBe(
			"no-store, no-cache, must-revalidate, proxy-revalidate",
		);
		expect(response.headers.get("pragma")).toBe("no-cache");
		expect(response.headers.get("expires")).toBe("0");
	});
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/app/api/app-version/route.test.ts
```

Expected: FAIL because `./route` does not exist.

- [ ] **Step 3: Implement the app-version route**

Create `apps/webapp/src/app/api/app-version/route.ts` with this content:

```ts
import { env } from "@/env";

const CACHE_HEADERS = {
	"cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
	expires: "0",
	pragma: "no-cache",
};

export function GET() {
	return Response.json(
		{ buildHash: env.NEXT_PUBLIC_BUILD_HASH ?? "development" },
		{ headers: CACHE_HEADERS },
	);
}
```

- [ ] **Step 4: Run the route test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/app/api/app-version/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the route**

Run:

```bash
git add apps/webapp/src/app/api/app-version/route.ts apps/webapp/src/app/api/app-version/route.test.ts
git commit -m "feat: expose app deployment version"
```

## Task 2: Deployment Refresh Checker Helpers

**Files:**
- Create: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx`
- Create: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx`

- [ ] **Step 1: Write failing helper tests**

Create `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
	shouldCheckDeploymentVersion,
	shouldReloadForBuildHash,
} from "./deployment-refresh-checker";

describe("shouldCheckDeploymentVersion", () => {
	it("allows checks when the document is hidden", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: true,
				lastActivityAt: 1_000,
				now: 1_001,
			}),
		).toBe(true);
	});

	it("allows checks when the visible document is idle", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: false,
				lastActivityAt: 1_000,
				now: 301_000,
			}),
		).toBe(true);
	});

	it("skips checks when the visible document was recently active", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: false,
				lastActivityAt: 1_000,
				now: 299_999,
			}),
		).toBe(false);
	});
});

describe("shouldReloadForBuildHash", () => {
	it("reloads when both hashes exist and differ", () => {
		expect(shouldReloadForBuildHash("client-a", "server-b")).toBe(true);
	});

	it("does not reload when hashes match", () => {
		expect(shouldReloadForBuildHash("client-a", "client-a")).toBe(false);
	});

	it("does not reload when a hash is missing", () => {
		expect(shouldReloadForBuildHash("client-a", null)).toBe(false);
		expect(shouldReloadForBuildHash("", "server-b")).toBe(false);
	});
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: FAIL because `deployment-refresh-checker.tsx` does not exist.

- [ ] **Step 3: Implement minimal helper functions and a placeholder component**

Create `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx` with this content:

```tsx
"use client";

type CheckDecisionInput = {
	idleThresholdMs: number;
	isDocumentHidden: boolean;
	lastActivityAt: number;
	now: number;
};

export function shouldCheckDeploymentVersion({
	idleThresholdMs,
	isDocumentHidden,
	lastActivityAt,
	now,
}: CheckDecisionInput) {
	return isDocumentHidden || now - lastActivityAt >= idleThresholdMs;
}

export function shouldReloadForBuildHash(clientBuildHash: string, serverBuildHash: string | null) {
	return Boolean(clientBuildHash && serverBuildHash && clientBuildHash !== serverBuildHash);
}

export function DeploymentRefreshChecker() {
	return null;
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the helpers**

Run:

```bash
git add apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx
git commit -m "feat: add deployment refresh decisions"
```

## Task 3: Deployment Refresh Checker Component

**Files:**
- Modify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx`
- Modify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx`

- [ ] **Step 1: Add failing component tests**

Replace `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CHECK_INTERVAL_MS,
	DeploymentRefreshChecker,
	shouldCheckDeploymentVersion,
	shouldReloadForBuildHash,
} from "./deployment-refresh-checker";

function setDocumentHidden(hidden: boolean) {
	Object.defineProperty(document, "hidden", {
		configurable: true,
		value: hidden,
	});
}

function mockReload() {
	const reload = vi.fn();
	Object.defineProperty(window, "location", {
		configurable: true,
		value: { ...window.location, reload },
	});
	return reload;
}

describe("shouldCheckDeploymentVersion", () => {
	it("allows checks when the document is hidden", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: true,
				lastActivityAt: 1_000,
				now: 1_001,
			}),
		).toBe(true);
	});

	it("allows checks when the visible document is idle", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: false,
				lastActivityAt: 1_000,
				now: 301_000,
			}),
		).toBe(true);
	});

	it("skips checks when the visible document was recently active", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: false,
				lastActivityAt: 1_000,
				now: 299_999,
			}),
		).toBe(false);
	});
});

describe("shouldReloadForBuildHash", () => {
	it("reloads when both hashes exist and differ", () => {
		expect(shouldReloadForBuildHash("client-a", "server-b")).toBe(true);
	});

	it("does not reload when hashes match", () => {
		expect(shouldReloadForBuildHash("client-a", "client-a")).toBe(false);
	});

	it("does not reload when a hash is missing", () => {
		expect(shouldReloadForBuildHash("client-a", null)).toBe(false);
		expect(shouldReloadForBuildHash("", "server-b")).toBe(false);
	});
});

describe("DeploymentRefreshChecker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		setDocumentHidden(false);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("does not fetch while the visible page is active", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		window.dispatchEvent(new Event("pointerdown"));
		await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reloads once when a hidden page sees a different build hash", async () => {
		const reload = mockReload();
		setDocumentHidden(true);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ buildHash: "server-b" }, { status: 200 }),
			),
		);
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
		await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("does not reload when the server build hash matches", async () => {
		const reload = mockReload();
		setDocumentHidden(true);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ buildHash: "client-a" }, { status: 200 }),
			),
		);
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

		expect(reload).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: FAIL because the component does not accept `clientBuildHash`, does not export `CHECK_INTERVAL_MS`, and does not fetch/reload.

- [ ] **Step 3: Implement the full checker component**

Replace `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx` with this content:

```tsx
"use client";

import { useEffect, useRef } from "react";

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_THRESHOLD_MS = CHECK_INTERVAL_MS;
const ACTIVITY_EVENTS = ["focus", "keydown", "mousedown", "pointerdown", "touchstart", "wheel"];

type CheckDecisionInput = {
	idleThresholdMs: number;
	isDocumentHidden: boolean;
	lastActivityAt: number;
	now: number;
};

type AppVersionResponse = {
	buildHash?: unknown;
};

type DeploymentRefreshCheckerProps = {
	clientBuildHash: string;
};

export function shouldCheckDeploymentVersion({
	idleThresholdMs,
	isDocumentHidden,
	lastActivityAt,
	now,
}: CheckDecisionInput) {
	return isDocumentHidden || now - lastActivityAt >= idleThresholdMs;
}

export function shouldReloadForBuildHash(clientBuildHash: string, serverBuildHash: string | null) {
	return Boolean(clientBuildHash && serverBuildHash && clientBuildHash !== serverBuildHash);
}

export function DeploymentRefreshChecker({ clientBuildHash }: DeploymentRefreshCheckerProps) {
	const lastActivityAtRef = useRef(Date.now());
	const reloadStartedRef = useRef(false);

	useEffect(() => {
		const recordActivity = () => {
			lastActivityAtRef.current = Date.now();
		};

		for (const eventName of ACTIVITY_EVENTS) {
			window.addEventListener(eventName, recordActivity, { passive: true });
		}

		return () => {
			for (const eventName of ACTIVITY_EVENTS) {
				window.removeEventListener(eventName, recordActivity);
			}
		};
	}, []);

	useEffect(() => {
		if (!clientBuildHash) return;

		const checkForNewDeployment = async () => {
			if (reloadStartedRef.current) return;

			if (
				!shouldCheckDeploymentVersion({
					idleThresholdMs: IDLE_THRESHOLD_MS,
					isDocumentHidden: document.hidden,
					lastActivityAt: lastActivityAtRef.current,
					now: Date.now(),
				})
			) {
				return;
			}

			try {
				const response = await fetch("/api/app-version", {
					cache: "no-store",
					headers: { accept: "application/json" },
				});

				if (!response.ok) return;

				const payload = (await response.json()) as AppVersionResponse;
				const serverBuildHash =
					typeof payload.buildHash === "string" && payload.buildHash.length > 0
						? payload.buildHash
						: null;

				if (!shouldReloadForBuildHash(clientBuildHash, serverBuildHash)) return;

				reloadStartedRef.current = true;
				window.location.reload();
			} catch {
				// Version checks are best-effort; the next interval can try again.
			}
		};

		const intervalId = window.setInterval(checkForNewDeployment, CHECK_INTERVAL_MS);

		return () => window.clearInterval(intervalId);
	}, [clientBuildHash]);

	return null;
}
```

- [ ] **Step 4: Run component tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the component**

Run:

```bash
git add apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx
git commit -m "feat: refresh stale deployments when idle"
```

## Task 4: Mount The Checker Globally

**Files:**
- Create: `apps/webapp/src/components/deployment-refresh/index.ts`
- Modify: `apps/webapp/src/app/[locale]/layout.tsx`

- [ ] **Step 1: Write the barrel export**

Create `apps/webapp/src/components/deployment-refresh/index.ts` with this content:

```ts
export { DeploymentRefreshChecker } from "./deployment-refresh-checker";
```

- [ ] **Step 2: Mount the checker in the locale layout**

Modify `apps/webapp/src/app/[locale]/layout.tsx`:

Add this import near the other component imports:

```ts
import { DeploymentRefreshChecker } from "@/components/deployment-refresh";
```

In `AppProviders`, add the checker after `<SWUpdatePrompt />`:

```tsx
<OfflineBanner />
<SWUpdatePrompt />
<DeploymentRefreshChecker clientBuildHash={env.NEXT_PUBLIC_BUILD_HASH ?? "development"} />
{children}
```

The complete `AppProviders` function should become:

```tsx
function AppProviders({ children, locale }: { children: ReactNode; locale: string }) {
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
			<FontSizeProvider>
				<TranslationProvider locale={locale}>
					<QueryProvider>
						<BProgressBar />
						<TooltipProvider delayDuration={0}>
							<OfflineBanner />
							<SWUpdatePrompt />
							<DeploymentRefreshChecker clientBuildHash={env.NEXT_PUBLIC_BUILD_HASH ?? "development"} />
							{children}
							<Toaster position="bottom-right" richColors />
						</TooltipProvider>
					</QueryProvider>
				</TranslationProvider>
			</FontSizeProvider>
		</ThemeProvider>
	);
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test src/app/api/app-version/route.test.ts src/components/deployment-refresh/deployment-refresh-checker.test.tsx src/env-usage.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the global mount**

Run:

```bash
git add apps/webapp/src/app/[locale]/layout.tsx apps/webapp/src/components/deployment-refresh/index.ts
git commit -m "feat: mount deployment refresh checker"
```

## Task 5: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run the webapp test suite**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended files are changed if commits were skipped; otherwise a clean working tree except unrelated user or peer-agent changes.

## Self-Review

- Spec coverage: The route covers the server deployment hash; the checker covers five-minute interval checks, hidden/idle gating, no auth or tenant data, hard reload on mismatch, and silent retry on errors.
- Placeholder scan: No placeholder tasks remain; every code-producing step includes concrete code.
- Type consistency: The plan consistently uses `buildHash`, `clientBuildHash`, `CHECK_INTERVAL_MS`, `shouldCheckDeploymentVersion`, and `shouldReloadForBuildHash` across tests and implementation.
