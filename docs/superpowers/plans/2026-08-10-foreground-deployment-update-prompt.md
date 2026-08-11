# Foreground Deployment Update Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unattended five-minute deployment reloads with a foreground-only, six-hour-rate-limited update prompt that reloads only after explicit user action.

**Architecture:** Keep the existing `/api/app-version` endpoint and global `DeploymentRefreshChecker` mount. Replace TanStack Query interval polling with `visibilitychange` and `focus` listeners backed by refs for cooldown, in-flight, mounted, and prompt state; use the existing localized Sonner update toast copy for the explicit reload decision.

**Tech Stack:** React 19, TypeScript, Sonner, Tolgee, Vitest, Testing Library, jsdom

---

## File Structure

- Modify `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker-utils.ts`: replace hidden-or-idle polling decisions with a pure visible/cooldown decision and rename reload comparison to prompt comparison.
- Modify `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx`: replace interval behavior tests with foreground lifecycle, cooldown, prompt action, in-flight, and unmount regression tests.
- Modify `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx`: remove TanStack Query polling and activity listeners; add foreground event listeners, cooldown guards, fetch lifecycle, localized update toast, and explicit reload action.

No layout, endpoint, translation, service-worker, or barrel-export changes are required.

### Task 1: Define Foreground Eligibility and Prompt Semantics

**Files:**
- Modify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker-utils.ts`
- Test: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx`

- [ ] **Step 1: Replace the old pure-helper tests with failing foreground tests**

Update the utility imports and pure test blocks to describe the new behavior:

```tsx
import {
	shouldCheckDeploymentVersion,
	shouldPromptForBuildHash,
} from "./deployment-refresh-checker-utils";

describe("shouldCheckDeploymentVersion", () => {
	it("allows a visible foreground check after the cooldown", () => {
		expect(
			shouldCheckDeploymentVersion({
				checkCooldownMs: 6 * 60 * 60 * 1000,
				isDocumentHidden: false,
				lastCheckStartedAt: 1_000,
				now: 6 * 60 * 60 * 1000 + 1_000,
			}),
		).toBe(true);
	});

	it("skips checks while the document is hidden", () => {
		expect(
			shouldCheckDeploymentVersion({
				checkCooldownMs: 6 * 60 * 60 * 1000,
				isDocumentHidden: true,
				lastCheckStartedAt: 0,
				now: 6 * 60 * 60 * 1000,
			}),
		).toBe(false);
	});

	it("skips visible checks before the cooldown elapses", () => {
		expect(
			shouldCheckDeploymentVersion({
				checkCooldownMs: 6 * 60 * 60 * 1000,
				isDocumentHidden: false,
				lastCheckStartedAt: 1_000,
				now: 6 * 60 * 60 * 1000,
			}),
		).toBe(false);
	});
});

describe("shouldPromptForBuildHash", () => {
	it("prompts when both hashes exist and differ", () => {
		expect(shouldPromptForBuildHash("client-a", "server-b")).toBe(true);
	});

	it("does not prompt when hashes match", () => {
		expect(shouldPromptForBuildHash("client-a", "client-a")).toBe(false);
	});

	it("does not prompt when a hash is missing", () => {
		expect(shouldPromptForBuildHash("client-a", null)).toBe(false);
		expect(shouldPromptForBuildHash("", "server-b")).toBe(false);
	});
});
```

- [ ] **Step 2: Run the utility tests and verify the expected failure**

Run:

```bash
pnpm --filter webapp test -- src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: FAIL because `shouldPromptForBuildHash` is not exported and the current decision input still expects `idleThresholdMs` and `lastActivityAt`.

- [ ] **Step 3: Implement the minimal pure foreground decisions**

Replace `deployment-refresh-checker-utils.ts` with:

```ts
export type CheckDecisionInput = {
	checkCooldownMs: number;
	isDocumentHidden: boolean;
	lastCheckStartedAt: number;
	now: number;
};

export function shouldCheckDeploymentVersion({
	checkCooldownMs,
	isDocumentHidden,
	lastCheckStartedAt,
	now,
}: CheckDecisionInput) {
	return !isDocumentHidden && now - lastCheckStartedAt >= checkCooldownMs;
}

export function shouldPromptForBuildHash(clientBuildHash: string, serverBuildHash: string | null) {
	return Boolean(clientBuildHash && serverBuildHash && clientBuildHash !== serverBuildHash);
}

// Temporary compatibility for the old component during the red-green sequence.
export const shouldReloadForBuildHash = shouldPromptForBuildHash;
```

- [ ] **Step 4: Run the utility tests and verify they pass**

Run:

```bash
pnpm --filter webapp test -- src/components/deployment-refresh/deployment-refresh-checker.test.tsx -t 'should(CheckDeploymentVersion|PromptForBuildHash)'
```

Expected: the pure-helper tests PASS. The temporary alias keeps the old component import valid until Task 2 replaces the component.

### Task 2: Prove the Checker Never Polls or Reloads Automatically

**Files:**
- Modify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx`
- Modify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx`

- [ ] **Step 1: Replace component test setup with translation and toast mocks**

Remove `QueryClient`, `QueryClientProvider`, `ReactNode`, and `CHECK_INTERVAL_MS` from the test. Add hoisted Sonner mocks and the Tolgee identity translator:

```tsx
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CHECK_COOLDOWN_MS,
	DeploymentRefreshChecker,
} from "./deployment-refresh-checker";

const { dismissToastMock, toastMock } = vi.hoisted(() => ({
	dismissToastMock: vi.fn(),
	toastMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("sonner", () => ({
	toast: Object.assign(toastMock, { dismiss: dismissToastMock }),
}));
```

Keep `setDocumentHidden`, `mockFetchBuildHash`, `createDeferred`, and `mockLocationReload`. Replace `renderWithQueryClient` with:

```tsx
function dispatchVisibilityChange(isHidden: boolean) {
	setDocumentHidden(isHidden);
	document.dispatchEvent(new Event("visibilitychange"));
}

async function flushForegroundCheck() {
	await Promise.resolve();
	await Promise.resolve();
}

function getUpdateToastOptions() {
	return toastMock.mock.calls.at(-1)?.[1] as {
		action: { onClick: () => void };
		cancel: { onClick: () => void };
		description: string;
		duration: number;
	};
}
```

Reset `toastMock` and `dismissToastMock` in `beforeEach`. Existing global restoration remains in `afterEach`.

```tsx
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	toastMock.mockReset();
	dismissToastMock.mockReset();
	setDocumentHidden(false);
});
```

- [ ] **Step 2: Add failing lifecycle and cooldown regression tests**

Add these tests under `describe("DeploymentRefreshChecker", ...)`:

```tsx
it("does not poll while time passes without a foreground event", async () => {
	const fetchMock = mockFetchBuildHash("server-b");
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS * 2);
	});

	expect(fetchMock).not.toHaveBeenCalled();
});

it("does not check when a hidden visibility event fires", async () => {
	const fetchMock = mockFetchBuildHash("server-b");
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		dispatchVisibilityChange(true);
		await flushForegroundCheck();
	});

	expect(fetchMock).not.toHaveBeenCalled();
});

it("checks once when the tab returns after the cooldown", async () => {
	const fetchMock = mockFetchBuildHash("client-a");
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		dispatchVisibilityChange(false);
		await flushForegroundCheck();
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(fetchMock).toHaveBeenCalledWith("/api/app-version", {
		cache: "no-store",
		headers: { accept: "application/json" },
	});
});

it("does not check again before another cooldown elapses", async () => {
	const fetchMock = mockFetchBuildHash("client-a");
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS - 1);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not check without a client build hash", async () => {
	const fetchMock = mockFetchBuildHash("server-b");
	render(<DeploymentRefreshChecker clientBuildHash="" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the lifecycle tests and verify they fail for the old polling implementation**

Run:

```bash
pnpm --filter webapp test -- src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: FAIL because `CHECK_COOLDOWN_MS` does not exist and the old component fetches from a timer/background path instead of foreground events.

- [ ] **Step 4: Add failing prompt-action tests**

Add:

```tsx
it("does not prompt or reload when the build hash matches", async () => {
	mockFetchBuildHash("client-a");
	const reloadMock = mockLocationReload();
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	expect(toastMock).not.toHaveBeenCalled();
	expect(reloadMock).not.toHaveBeenCalled();
});

it("shows an update prompt without reloading when the build hash differs", async () => {
	mockFetchBuildHash("server-b");
	const reloadMock = mockLocationReload();
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	expect(reloadMock).not.toHaveBeenCalled();
	expect(toastMock).toHaveBeenCalledWith("Update available", {
		action: expect.objectContaining({ label: "Reload" }),
		cancel: expect.objectContaining({ label: "Later" }),
		description: "A new version is ready. Reload to update.",
		duration: Infinity,
	});
});

it("reloads exactly once only after the Reload action", async () => {
	mockFetchBuildHash("server-b");
	const reloadMock = mockLocationReload();
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	getUpdateToastOptions().action.onClick();

	expect(reloadMock).toHaveBeenCalledTimes(1);
});

it("does not reload or prompt again after Later", async () => {
	const fetchMock = mockFetchBuildHash("server-b");
	const reloadMock = mockLocationReload();
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	getUpdateToastOptions().cancel.onClick();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	expect(reloadMock).not.toHaveBeenCalled();
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(toastMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: Add failing request-lifecycle tests**

Retain the existing deferred-response pattern but trigger it through foreground events:

```tsx
it("does not overlap foreground checks while a request is in flight", async () => {
	const pendingResponse = createDeferred<Response>();
	const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
	vi.stubGlobal("fetch", fetchMock);
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		dispatchVisibilityChange(false);
		await flushForegroundCheck();
	});

	expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not show a late prompt after unmount", async () => {
	const pendingResponse = createDeferred<Response>();
	vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingResponse.promise));
	const { unmount } = render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	unmount();

	await act(async () => {
		pendingResponse.resolve({
			json: vi.fn().mockResolvedValue({ buildHash: "server-b" }),
			ok: true,
		} as unknown as Response);
		await pendingResponse.promise;
		await flushForegroundCheck();
	});

	expect(toastMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Add failing invalid-response and request-failure tests**

Add coverage for invalid hashes and every ignored fetch failure mode:

```tsx
it.each([null, "", 123])("ignores invalid server build hash %j", async (buildHash) => {
	mockFetchBuildHash(buildHash);
	const reloadMock = mockLocationReload();
	render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
		window.dispatchEvent(new Event("focus"));
		await flushForegroundCheck();
	});

	expect(toastMock).not.toHaveBeenCalled();
	expect(reloadMock).not.toHaveBeenCalled();
});

it.each(["network", "non-2xx", "malformed-json"] as const)(
	"ignores a %s version response until the next cooldown",
	async (failureType) => {
		const fetchMock = vi.fn();
		if (failureType === "network") {
			fetchMock.mockRejectedValue(new Error("offline"));
		} else if (failureType === "non-2xx") {
			fetchMock.mockResolvedValue({ ok: false });
		} else {
			fetchMock.mockResolvedValue({
				json: vi.fn().mockRejectedValue(new SyntaxError("invalid json")),
				ok: true,
			});
		}
		vi.stubGlobal("fetch", fetchMock);
		const reloadMock = mockLocationReload();
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(CHECK_COOLDOWN_MS);
			window.dispatchEvent(new Event("focus"));
			await flushForegroundCheck();
			window.dispatchEvent(new Event("focus"));
			await flushForegroundCheck();
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(toastMock).not.toHaveBeenCalled();
		expect(reloadMock).not.toHaveBeenCalled();
	},
);
```

- [ ] **Step 7: Run the complete rewritten suite and verify it is red**

Run:

```bash
pnpm --filter webapp test -- src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: FAIL because the old checker exports no `CHECK_COOLDOWN_MS`, still polls in the background, does not listen for foreground events, and reloads instead of showing a toast.

- [ ] **Step 8: Implement the event-driven checker**

Delete this temporary compatibility line from `deployment-refresh-checker-utils.ts`:

```ts
export const shouldReloadForBuildHash = shouldPromptForBuildHash;
```

Then replace `deployment-refresh-checker.tsx` with:

```tsx
"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
	shouldCheckDeploymentVersion,
	shouldPromptForBuildHash,
} from "./deployment-refresh-checker-utils";

export const CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;

type AppVersionResponse = {
	buildHash?: unknown;
};

type DeploymentRefreshCheckerProps = {
	clientBuildHash: string;
};

async function fetchAppVersion() {
	const response = await fetch("/api/app-version", {
		cache: "no-store",
		headers: { accept: "application/json" },
	});

	if (!response.ok) return null;

	return (await response.json()) as AppVersionResponse;
}

export function DeploymentRefreshChecker({ clientBuildHash }: DeploymentRefreshCheckerProps) {
	const { t } = useTranslate();
	const tRef = useRef(t);

	useEffect(() => {
		tRef.current = t;
	}, [t]);

	useEffect(() => {
		let mounted = true;
		let requestInFlight = false;
		let promptShown = false;
		let toastId: string | number | undefined;
		let lastCheckStartedAt = Date.now();

		const checkForUpdate = async () => {
			const now = Date.now();
			if (
				!clientBuildHash ||
				requestInFlight ||
				promptShown ||
				!shouldCheckDeploymentVersion({
					checkCooldownMs: CHECK_COOLDOWN_MS,
					isDocumentHidden: document.hidden,
					lastCheckStartedAt,
					now,
				})
			) {
				return;
			}

			lastCheckStartedAt = now;
			requestInFlight = true;

			try {
				const appVersion = await fetchAppVersion();
				if (!mounted || !appVersion || promptShown) return;

				const serverBuildHash =
					typeof appVersion.buildHash === "string" && appVersion.buildHash.length > 0
						? appVersion.buildHash
						: null;

				if (!shouldPromptForBuildHash(clientBuildHash, serverBuildHash)) return;

				promptShown = true;
				const translate = tRef.current;
				toastId = toast(translate("common.sw.update.title", "Update available"), {
					description: translate(
						"common.sw.update.description",
						"A new version is ready. Reload to update.",
					),
					duration: Infinity,
					action: {
						label: translate("common.sw.update.reload", "Reload"),
						onClick: () => window.location.reload(),
					},
					cancel: {
						label: translate("common.sw.update.later", "Later"),
						onClick: () => undefined,
					},
				});
			} catch {
				return;
			} finally {
				requestInFlight = false;
			}
		};

		const handleForegroundEvent = () => {
			void checkForUpdate();
		};

		document.addEventListener("visibilitychange", handleForegroundEvent);
		window.addEventListener("focus", handleForegroundEvent, { passive: true });

		return () => {
			mounted = false;
			document.removeEventListener("visibilitychange", handleForegroundEvent);
			window.removeEventListener("focus", handleForegroundEvent);
			if (toastId !== undefined) toast.dismiss(toastId);
		};
	}, [clientBuildHash]);

	return null;
}
```

- [ ] **Step 9: Run the focused test suite and make it green**

Run:

```bash
pnpm --filter webapp test -- src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: PASS with no warnings.

### Task 3: Verify Integration and Regression Safety

**Files:**
- Verify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx`
- Verify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker-utils.ts`
- Verify: `apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx`
- Verify unchanged: `apps/webapp/src/app/api/app-version/route.test.ts`
- Verify unchanged: `apps/webapp/src/app/[locale]/layout.test.tsx`

- [ ] **Step 1: Run deployment checker and endpoint tests together**

Run:

```bash
pnpm --filter webapp test -- src/components/deployment-refresh/deployment-refresh-checker.test.tsx src/app/api/app-version/route.test.ts
```

Expected: both files PASS.

- [ ] **Step 2: Run the locale layout regression test**

Run:

```bash
pnpm --filter webapp test -- 'src/app/[locale]/layout.test.tsx'
```

Expected: PASS; the global checker remains mounted behind its existing isolated Suspense boundary.

- [ ] **Step 3: Run webapp type checking**

Run:

```bash
pnpm --filter webapp typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run formatting/lint checks on changed source files**

Run:

```bash
pnpm exec ultracite check apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.tsx apps/webapp/src/components/deployment-refresh/deployment-refresh-checker-utils.ts apps/webapp/src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: PASS with no diagnostics. If formatting changes are required, use the repository formatter and rerun the focused tests afterward.

- [ ] **Step 5: Inspect the final diff for prohibited behavior**

Run:

```bash
git diff -- apps/webapp/src/components/deployment-refresh docs/superpowers/specs/2026-08-10-foreground-deployment-update-prompt-design.md docs/superpowers/plans/2026-08-10-foreground-deployment-update-prompt.md
```

Confirm:

- No `refetchInterval`, `refetchIntervalInBackground`, `setInterval`, or background timer remains in deployment refresh code.
- `window.location.reload()` exists only inside the toast's explicit `Reload` action.
- No unrelated files or concurrent user changes are included.

Do not commit unless the user explicitly requests a commit.
