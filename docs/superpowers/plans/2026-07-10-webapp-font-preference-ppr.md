# Webapp Font Preference PPR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve persisted font-size preferences without accessing browser storage during Next.js Cache Components prerendering.

**Architecture:** `FontSizeProvider` will use `useSyncExternalStore`, supplying a constant server snapshot and a browser-storage client snapshot. The store subscribes to native cross-tab storage events and a private event for same-tab writes, while the existing document-attribute effect remains responsible for applying the selected font size.

**Tech Stack:** React 19, `useSyncExternalStore`, Vitest, Next.js 16 Cache Components, pnpm, Turborepo.

---

### Task 1: Add Failing PPR Regression Tests

**Files:**
- Modify: `apps/webapp/src/components/font-size-preference.test.tsx:115-178`
- Modify: `docker/scripts/prepare-target-runtime.test.mjs:126-155`

- [ ] **Step 1: Add a failing external-preference synchronization test**

Add this test inside the existing `describe("FontSizeProvider", ...)` block:

```tsx
	it("updates when the stored preference changes in another tab", async () => {
		render(
			<FontSizeProvider>
				<Consumer />
			</FontSizeProvider>,
		);

		await screen.findByText("Current: default");
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, "comfortable");
		window.dispatchEvent(new StorageEvent("storage", { key: FONT_SIZE_STORAGE_KEY }));

		expect(await screen.findByText("Current: comfortable")).toBeTruthy();
		expect(document.documentElement.dataset.fontSize).toBe("comfortable");
	});
```

- [ ] **Step 2: Add a failing source-contract test for the server snapshot**

Add this test after the Next.js runtime Dockerfile tests:

```js
test("font size preferences provide a static server snapshot", async () => {
	const contents = await fs.readFile(
		new URL("../../apps/webapp/src/components/font-size-preference.tsx", import.meta.url),
		"utf8",
	);

	assert.match(contents, /useSyncExternalStore\(/);
	assert.match(contents, /function getServerFontSizePreference\(\): FontSizePreference \{\s*return "default";/s);
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm --filter webapp exec vitest run src/components/font-size-preference.test.tsx`

Expected: FAIL because the current state-based provider does not subscribe to `storage` events.

Run: `pnpm node --test docker/scripts/prepare-target-runtime.test.mjs`

Expected: FAIL because the current provider has no `useSyncExternalStore` server snapshot.

### Task 2: Implement the Server-Safe Font Preference Store

**Files:**
- Modify: `apps/webapp/src/components/font-size-preference.tsx:1-57`
- Test: `apps/webapp/src/components/font-size-preference.test.tsx:115-178`
- Test: `docker/scripts/prepare-target-runtime.test.mjs:126-155`

- [ ] **Step 1: Replace state initialization with a server-safe external store**

In `apps/webapp/src/components/font-size-preference.tsx`, import `useSyncExternalStore`, then add these module-level store functions after `getLocalStorage`:

```tsx
const FONT_SIZE_CHANGE_EVENT = "z8-font-size-change";

function subscribeToFontSizePreference(onStoreChange: () => void) {
	window.addEventListener("storage", onStoreChange);
	window.addEventListener(FONT_SIZE_CHANGE_EVENT, onStoreChange);

	return () => {
		window.removeEventListener("storage", onStoreChange);
		window.removeEventListener(FONT_SIZE_CHANGE_EVENT, onStoreChange);
	};
}

function getClientFontSizePreference() {
	return readStoredFontSize(getLocalStorage());
}

function getServerFontSizePreference(): FontSizePreference {
	return "default";
}
```

Replace the lazy `useState` initializer with:

```tsx
	const fontSize = useSyncExternalStore(
		subscribeToFontSizePreference,
		getClientFontSizePreference,
		getServerFontSizePreference,
	);
```

Replace `setFontSize` with:

```tsx
	const setFontSize = (value: FontSizePreference) => {
		writeStoredFontSize(getLocalStorage(), value);
		window.dispatchEvent(new Event(FONT_SIZE_CHANGE_EVENT));
		applyFontSizePreference(value);
	};
```

Keep the existing effect that calls `applyFontSizePreference(fontSize)` so the post-hydration browser snapshot updates the document attribute.

- [ ] **Step 2: Run the focused component test to verify it passes**

Run: `pnpm --filter webapp exec vitest run src/components/font-size-preference.test.tsx`

Expected: PASS with 11 tests, including the external-preference synchronization test.

- [ ] **Step 3: Run all Docker regression tests**

Run: `pnpm node --test docker/scripts/prepare-target-runtime.test.mjs`

Expected: PASS with the existing Docker tests and the new font-size server-snapshot test.

- [ ] **Step 4: Run the CI-equivalent webapp build**

Run:

```bash
pnpm exec turbo prune webapp --docker --out-dir /tmp/opencode/webapp-ppr-verify
pnpm --dir /tmp/opencode/webapp-ppr-verify/full install --lockfile-only
pnpm --dir /tmp/opencode/webapp-ppr-verify/full install --frozen-lockfile
SKIP_ENV_VALIDATION=1 pnpm --dir /tmp/opencode/webapp-ppr-verify/full --filter webapp run generate-licenses
CI=true SKIP_ENV_VALIDATION=1 NEXT_DEPLOYMENT_ID=verification BUILD_HASH=verification NEXT_PUBLIC_BUILD_HASH=verification pnpm --dir /tmp/opencode/webapp-ppr-verify/full --filter webapp exec next build
```

Expected: The build completes static page generation without an `Uncached data was accessed outside of <Suspense>` error from `font-size-preference.tsx`.
