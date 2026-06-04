# Case-Insensitive Auth Email Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Better Auth user-email lookups case-insensitive for sign-in, password reset, and verification resend flows without rewriting stored email values.

**Architecture:** Wrap the existing Better Auth Drizzle adapter in `apps/webapp/src/lib/auth.ts` and add `mode: "insensitive"` only to `findOne` queries against the `user.email` field. All other adapter calls and where clauses pass through unchanged, so Better Auth keeps owning password verification, reset tokens, verification tokens, sessions, and error handling.

**Tech Stack:** Better Auth 1.6.13, `@better-auth/drizzle-adapter`, Drizzle ORM, Next.js 16, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/auth.ts`: add and export the adapter wrapper helper, then wrap the existing `drizzleAdapter(db, { provider: "pg", schema })` call.
- Modify `apps/webapp/src/lib/auth.test.ts`: add focused unit tests for the wrapper behavior.
- No client form changes: `apps/webapp/src/components/login-form.tsx`, `apps/webapp/src/components/forgot-password-form.tsx`, and `apps/webapp/src/app/[locale]/(auth)/verify-email-pending/page.tsx` already submit the entered email to Better Auth.
- Do not edit `apps/webapp/src/db/auth-schema.ts`; this is generated and this change does not require schema changes.

## Task 1: Add Failing Adapter Wrapper Tests

**Files:**
- Modify: `apps/webapp/src/lib/auth.test.ts`

- [ ] **Step 1: Add `vi` to the Vitest import**

Change the import at the top of `apps/webapp/src/lib/auth.test.ts` from:

```ts
import { describe, expect, it } from "vitest";
```

to:

```ts
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Add the helper import**

Change the auth import from:

```ts
import { resolveInvitationTargetTeamId } from "./auth";
```

to:

```ts
import {
	makeEmailLookupCaseInsensitiveAdapter,
	resolveInvitationTargetTeamId,
} from "./auth";
```

- [ ] **Step 3: Add tests that describe the required wrapper behavior**

Append this test block to `apps/webapp/src/lib/auth.test.ts`:

```ts
describe("makeEmailLookupCaseInsensitiveAdapter", () => {
	it("adds insensitive mode to user email findOne queries", async () => {
		const findOne = vi.fn(async () => null);
		const adapter = { findOne } as any;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		await wrapped.findOne({
			model: "user",
			where: [{ field: "email", value: "USER@Example.com" }],
		});

		expect(findOne).toHaveBeenCalledWith({
			model: "user",
			where: [{ field: "email", value: "USER@Example.com", mode: "insensitive" }],
		});
	});

	it("preserves explicit where modes and non-email clauses", async () => {
		const findOne = vi.fn(async () => null);
		const adapter = { findOne } as any;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		await wrapped.findOne({
			model: "user",
			where: [
				{ field: "email", value: "USER@Example.com", mode: "sensitive" },
				{ field: "id", value: "user_1" },
			],
		});

		expect(findOne).toHaveBeenCalledWith({
			model: "user",
			where: [
				{ field: "email", value: "USER@Example.com", mode: "sensitive" },
				{ field: "id", value: "user_1" },
			],
		});
	});

	it("leaves non-user model findOne queries unchanged", async () => {
		const findOne = vi.fn(async () => null);
		const adapter = { findOne } as any;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		await wrapped.findOne({
			model: "account",
			where: [{ field: "email", value: "USER@Example.com" }],
		});

		expect(findOne).toHaveBeenCalledWith({
			model: "account",
			where: [{ field: "email", value: "USER@Example.com" }],
		});
	});
});
```

- [ ] **Step 4: Run the focused test and verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/lib/auth.test.ts
```

Expected result: FAIL because `makeEmailLookupCaseInsensitiveAdapter` is not exported from `./auth` yet.

## Task 2: Implement the Adapter Wrapper

**Files:**
- Modify: `apps/webapp/src/lib/auth.ts`

- [ ] **Step 1: Add adapter helper types and wrapper function**

Add this code after `async function syncBillingSeats(...)` and before `export const auth = betterAuth({` in `apps/webapp/src/lib/auth.ts`:

```ts
type AuthDatabaseAdapter = ReturnType<typeof drizzleAdapter>;
type AuthFindOneOptions = Parameters<AuthDatabaseAdapter["findOne"]>[0];

function withInsensitiveUserEmailWhere(options: AuthFindOneOptions): AuthFindOneOptions {
	if (options.model !== "user" || !Array.isArray(options.where)) {
		return options;
	}

	let changed = false;
	const where = options.where.map((clause) => {
		if (clause.field !== "email" || clause.mode) {
			return clause;
		}

		changed = true;
		return { ...clause, mode: "insensitive" as const };
	});

	return changed ? { ...options, where } : options;
}

export function makeEmailLookupCaseInsensitiveAdapter(
	adapter: AuthDatabaseAdapter,
): AuthDatabaseAdapter {
	return {
		...adapter,
		findOne: (options) => adapter.findOne(withInsensitiveUserEmailWhere(options)),
	};
}
```

- [ ] **Step 2: Wrap the existing Drizzle adapter**

Change the `database` config in `apps/webapp/src/lib/auth.ts` from:

```ts
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
```

to:

```ts
	database: makeEmailLookupCaseInsensitiveAdapter(
		drizzleAdapter(db, {
			provider: "pg",
			schema,
		}),
	),
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/lib/auth.test.ts
```

Expected result: PASS for `resolveInvitationTargetTeamId`, `billing seat sync hooks`, and `makeEmailLookupCaseInsensitiveAdapter` tests.

## Task 3: Typecheck and Adjust Type Compatibility

**Files:**
- Modify if needed: `apps/webapp/src/lib/auth.ts`
- Modify if needed: `apps/webapp/src/lib/auth.test.ts`

- [ ] **Step 1: Run TypeScript or build-level validation**

Run:

```bash
CI=true pnpm --dir apps/webapp build
```

Expected result: PASS. If it fails because `AuthDatabaseAdapter["findOne"]` can be optional in Better Auth types, use the exact implementation in Step 2.

- [ ] **Step 2: Apply optional-method-safe typing only if TypeScript reports optional `findOne` issues**

Replace the helper type block in `apps/webapp/src/lib/auth.ts` with:

```ts
type AuthDatabaseAdapter = ReturnType<typeof drizzleAdapter>;
type AuthFindOne = NonNullable<AuthDatabaseAdapter["findOne"]>;
type AuthFindOneOptions = Parameters<AuthFindOne>[0];
```

Then keep the wrapper implementation as:

```ts
export function makeEmailLookupCaseInsensitiveAdapter(
	adapter: AuthDatabaseAdapter,
): AuthDatabaseAdapter {
	return {
		...adapter,
		findOne: (options) => adapter.findOne(withInsensitiveUserEmailWhere(options)),
	};
}
```

- [ ] **Step 3: Re-run focused tests after any type adjustment**

Run:

```bash
pnpm --dir apps/webapp test src/lib/auth.test.ts
```

Expected result: PASS.

- [ ] **Step 4: Re-run build validation**

Run:

```bash
CI=true pnpm --dir apps/webapp build
```

Expected result: PASS.

## Task 4: Verify Scope and Inspect Diff

**Files:**
- Inspect: `apps/webapp/src/lib/auth.ts`
- Inspect: `apps/webapp/src/lib/auth.test.ts`
- Inspect: `docs/superpowers/specs/2026-06-04-case-insensitive-auth-email-flows-design.md`
- Inspect: `docs/superpowers/plans/2026-06-04-case-insensitive-auth-email-flows.md`

- [ ] **Step 1: Confirm generated schema was not edited**

Run:

```bash
git diff -- apps/webapp/src/db/auth-schema.ts
```

Expected result: no output.

- [ ] **Step 2: Confirm only intended files changed**

Run:

```bash
git diff --stat
```

Expected result: only the auth implementation, auth test, spec, and plan files are listed for this work. Other unrelated files may exist in a concurrent-work tree; do not revert them.

- [ ] **Step 3: Inspect the implementation diff**

Run:

```bash
git diff -- apps/webapp/src/lib/auth.ts apps/webapp/src/lib/auth.test.ts
```

Expected result: the diff only adds the `findOne` wrapper and tests. It should not lowercase email input, alter token storage, alter session config, or change UI messages.

- [ ] **Step 4: Checkpoint without committing**

Do not commit unless the user explicitly asks for a commit. Report the test and build results with any skipped checks or failures.
