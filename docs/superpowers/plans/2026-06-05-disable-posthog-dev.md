# Disable PostHog In Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent local development from sending PostHog client analytics or server-side exception telemetry.

**Architecture:** Add `env.NODE_ENV === "development"` guards at the two existing PostHog entry points. The client provider will render children directly and skip all PostHog calls in development; the server helper will return `null` before constructing a `posthog-node` client.

**Tech Stack:** Next.js, React, Vitest, React Testing Library, PostHog JS, `posthog-node`, Zod-backed `env` helper.

---

## File Structure

- Modify: `apps/webapp/src/components/posthog-provider.tsx` to disable client PostHog in development mode.
- Modify: `apps/webapp/src/components/posthog-provider.test.tsx` to make mocked env mutable and add a development-mode test.
- Modify: `apps/webapp/src/lib/posthog-server.ts` to disable server PostHog in development mode.
- Modify: `apps/webapp/src/lib/posthog-server.test.ts` to add a development-mode test.

### Task 1: Disable Client PostHog In Development

**Files:**
- Modify: `apps/webapp/src/components/posthog-provider.test.tsx`
- Modify: `apps/webapp/src/components/posthog-provider.tsx`

- [ ] **Step 1: Write the failing client provider test**

Update `apps/webapp/src/components/posthog-provider.test.tsx` so the env mock is mutable and add this test:

```tsx
const mockEnv = vi.hoisted(() => ({
	NODE_ENV: "test",
	NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
	NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
}));

vi.mock("@/env", () => ({
	env: mockEnv,
}));

// inside beforeEach
mockEnv.NODE_ENV = "test";
mockEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
mockEnv.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";

it("does not initialize tracking in development mode", () => {
	mockEnv.NODE_ENV = "development";

	render(
		<PostHogProvider helpImproveProduct>
			<div>App</div>
		</PostHogProvider>,
	);

	expect(screen.getByText("App")).toBeTruthy();
	expect(screen.queryByTestId("posthog-provider")).toBeNull();
	expect(initMock).not.toHaveBeenCalled();
	expect(optInMock).not.toHaveBeenCalled();
	expect(optOutMock).not.toHaveBeenCalled();
	expect(resetMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run client provider test and verify it fails**

Run: `pnpm --filter webapp test src/components/posthog-provider.test.tsx`

Expected: FAIL because development mode still initializes PostHog and wraps with `PHProvider`.

- [ ] **Step 3: Implement the minimal client guard**

Update `apps/webapp/src/components/posthog-provider.tsx`:

```tsx
export function PostHogProvider({ children, helpImproveProduct }: PostHogProviderProps) {
	const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
	const isPostHogEnabled = env.NODE_ENV !== "development" && !!projectToken;

	useEffect(() => {
		if (!isPostHogEnabled) {
			return;
		}

		if (!helpImproveProduct) {
			posthog.opt_out_capturing();
			posthog.reset();
			return;
		}

		posthog.init(projectToken, {
			api_host: "/ingest",
			ui_host: env.NEXT_PUBLIC_POSTHOG_HOST,
			defaults: "2026-01-30",
			capture_pageview: "history_change",
			capture_pageleave: true,
		});
		posthog.opt_in_capturing();
	}, [helpImproveProduct, isPostHogEnabled, projectToken]);

	if (!(isPostHogEnabled && helpImproveProduct)) {
		return <>{children}</>;
	}

	return <PHProvider client={posthog}>{children}</PHProvider>;
}
```

- [ ] **Step 4: Run client provider test and verify it passes**

Run: `pnpm --filter webapp test src/components/posthog-provider.test.tsx`

Expected: PASS for all `PostHogProvider` tests.

### Task 2: Disable Server PostHog In Development

**Files:**
- Modify: `apps/webapp/src/lib/posthog-server.test.ts`
- Modify: `apps/webapp/src/lib/posthog-server.ts`

- [ ] **Step 1: Write the failing server helper test**

Add this test to the `getPostHogServer` describe block in `apps/webapp/src/lib/posthog-server.test.ts`:

```ts
it("returns null in development mode even when the PostHog project token is configured", async () => {
	vi.stubEnv("NODE_ENV", "development");
	vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");

	const { getPostHogServer } = await import("./posthog-server");

	expect(getPostHogServer()).toBeNull();
	expect(mockState.PostHogConstructor).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run server helper test and verify it fails**

Run: `pnpm --filter webapp test src/lib/posthog-server.test.ts`

Expected: FAIL because development mode still constructs a PostHog client when a token exists.

- [ ] **Step 3: Implement the minimal server guard**

Update `apps/webapp/src/lib/posthog-server.ts`:

```ts
export function getPostHogServer(): PostHog | null {
	if (env.NODE_ENV === "development") {
		return null;
	}

	const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();

	if (!projectToken) {
		return null;
	}

	if (!posthogInstance) {
		posthogInstance = new PostHog(projectToken, {
			host: env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
			flushAt: 1,
			flushInterval: 0,
		});
	}

	return posthogInstance;
}
```

- [ ] **Step 4: Run server helper test and verify it passes**

Run: `pnpm --filter webapp test src/lib/posthog-server.test.ts`

Expected: PASS for all `getPostHogServer` and cookie parsing tests.

### Task 3: Focused Verification

**Files:**
- Verify: `apps/webapp/src/components/posthog-provider.test.tsx`
- Verify: `apps/webapp/src/lib/posthog-server.test.ts`

- [ ] **Step 1: Run both focused test files**

Run: `pnpm --filter webapp test src/components/posthog-provider.test.tsx src/lib/posthog-server.test.ts`

Expected: PASS for both test files.

- [ ] **Step 2: Check working tree diff**

Run: `git diff -- apps/webapp/src/components/posthog-provider.tsx apps/webapp/src/components/posthog-provider.test.tsx apps/webapp/src/lib/posthog-server.ts apps/webapp/src/lib/posthog-server.test.ts docs/superpowers/specs/2026-06-05-disable-posthog-dev-design.md docs/superpowers/plans/2026-06-05-disable-posthog-dev.md`

Expected: diff only contains the development-mode guards, focused tests, and the approved spec/plan docs.
