# Sign-In Prerender Boundary Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Next.js from reporting client-clock and blocking-route errors while prerendering the locale sign-in route.

**Architecture:** Give the invisible `DeploymentRefreshChecker` its own `Suspense` boundary inside `ApplicationContent`. Split the auth layout into a synchronous boundary owner and async request-dependent content so host-specific, organization-scoped auth configuration remains dynamic beneath Suspense.

**Tech Stack:** Next.js 16.2, React 19, TanStack Query 5, Vitest 4

## Global Constraints

- Preserve the deployment checker's five-minute freshness and polling behavior.
- Keep the existing translation Suspense boundary unchanged.
- Preserve host validation and organization-scoped domain authentication configuration.
- Use `pnpm` for every test command.
- Do not modify unrelated concurrent work.

---

### Task 1: Isolate the Deployment Refresh Checker

**Files:**
- Modify: `apps/webapp/src/app/[locale]/layout.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/layout.tsx:86-99`

**Interfaces:**
- Consumes: React's existing `Suspense` import and `DeploymentRefreshChecker` component.
- Produces: A dedicated `Suspense` boundary whose fallback is `null` and whose only child is `DeploymentRefreshChecker`.

- [ ] **Step 1: Write the failing regression test**

Add this test to the `LocaleLayout` describe block in `apps/webapp/src/app/[locale]/layout.test.tsx`:

```tsx
it("isolates the deployment refresh checker behind a Suspense boundary", () => {
	const source = readFileSync("src/app/[locale]/layout.tsx", "utf8");

	expect(source).toMatch(
		/<Suspense fallback=\{null\}>\s*<DeploymentRefreshChecker[^>]+\/>\s*<\/Suspense>/,
	);
});
```

- [ ] **Step 2: Run the test and verify the regression is red**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/layout.test.tsx'
```

Expected: FAIL only for `isolates the deployment refresh checker behind a Suspense boundary`, because the checker is not yet wrapped by a dedicated boundary.

- [ ] **Step 3: Add the minimal boundary**

Replace the checker line inside `ApplicationContent` in `apps/webapp/src/app/[locale]/layout.tsx` with:

```tsx
<Suspense fallback={null}>
	<DeploymentRefreshChecker clientBuildHash={env.NEXT_PUBLIC_BUILD_HASH ?? "development"} />
</Suspense>
```

- [ ] **Step 4: Run focused unit tests and verify green**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/layout.test.tsx' src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: Both test files pass with zero failures.

- [ ] **Step 5: Run static validation**

Run:

```bash
pnpm --dir apps/webapp exec tsc --project tsconfig.typecheck.json --noEmit --incremental false
```

Expected: Exit code 0 with no TypeScript errors.

Run:

```bash
git diff --check
```

Expected: Exit code 0 with no whitespace errors.

- [ ] **Step 6: Verify the running sign-in route**

Run:

```bash
curl -sS -D /tmp/z8-sign-in.headers -o /tmp/z8-sign-in.html --max-time 15 http://localhost:3000/en/sign-in
```

Expected: HTTP 200 and `x-nextjs-prerender: 1`. Confirm the Next.js dev console no longer reports `next-prerender-current-time-client` for this request.

- [ ] **Step 7: Commit the implementation**

```bash
git add 'apps/webapp/src/app/[locale]/layout.tsx' 'apps/webapp/src/app/[locale]/layout.test.tsx' docs/superpowers/plans/2026-07-12-deployment-refresh-prerender.md
git commit -m "fix: isolate deployment refresh prerendering"
```

### Task 2: Isolate Request-Dependent Auth Layout Content

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx:1-31`

**Interfaces:**
- Consumes: React `Suspense`, the existing auth layout children, and all existing request/domain helpers.
- Produces: A synchronous default `AuthLayout` boundary and an async named `AuthLayoutContent` component containing request-dependent work.

- [ ] **Step 1: Write the failing regression test**

Import `Suspense` and `isValidElement` from React, then add:

```tsx
it("places request-dependent auth content behind Suspense", () => {
	const layout = AuthLayout({ children: <div>Auth content</div> });

	expect(layout).not.toBeInstanceOf(Promise);
	expect(isValidElement(layout)).toBe(true);
	if (!isValidElement(layout)) throw new Error("Expected AuthLayout to return a React element");
	expect(layout.type).toBe(Suspense);
});
```

- [ ] **Step 2: Run the auth layout test and verify red**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(auth)/layout.test.tsx'
```

Expected: FAIL for `places request-dependent auth content behind Suspense` because the current default layout returns a Promise.

- [ ] **Step 3: Add the request-time boundary**

Change the layout structure to:

```tsx
import { Suspense } from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<Suspense fallback={null}>
			<AuthLayoutContent>{children}</AuthLayoutContent>
		</Suspense>
	);
}
```

Rename the existing declaration from:

```tsx
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
```

to:

```tsx
export async function AuthLayoutContent({ children }: { children: React.ReactNode }) {
```

Leave the complete body of the renamed function unchanged. Update existing behavior tests to import and call `AuthLayoutContent` directly so they continue testing resolved request/domain behavior; keep the new boundary test on default `AuthLayout`.

- [ ] **Step 4: Run all focused tests and verify green**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/layout.test.tsx' 'src/app/[locale]/(auth)/layout.test.tsx' src/components/deployment-refresh/deployment-refresh-checker.test.tsx
```

Expected: All three test files pass with zero failures.

- [ ] **Step 5: Repeat static, diagnostic, and live-route verification**

Run the TypeScript, `git diff --check`, React Doctor changed-scope, and localhost sign-in commands from Task 1. Expected: no new errors in changed files, HTTP 200, and no `next-prerender-current-time-client` or `blocking-route` console error.

- [ ] **Step 6: Commit both boundary fixes**

```bash
git add 'apps/webapp/src/app/[locale]/layout.tsx' 'apps/webapp/src/app/[locale]/layout.test.tsx' 'apps/webapp/src/app/[locale]/(auth)/layout.tsx' 'apps/webapp/src/app/[locale]/(auth)/layout.test.tsx' docs/superpowers/plans/2026-07-12-deployment-refresh-prerender.md
git commit -m "fix: isolate sign-in prerender dependencies"
```
