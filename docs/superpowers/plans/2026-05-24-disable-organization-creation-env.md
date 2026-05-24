# Disable Organization Creation Env Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-off server env var that disables all new organization creation for dedicated/private deployments.

**Architecture:** Validate `DISABLE_ORGANIZATION_CREATION` in the webapp env module, expose one server-only helper for the effective policy, and apply that helper at all known creation gates. Server-rendered UI continues passing existing `canCreateOrganizations` props, but those props are forced false when creation is disabled.

**Tech Stack:** Next.js App Router, Better Auth organization plugin, Effect services, `@t3-oss/env-nextjs`, Zod, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/env.ts`: add `DISABLE_ORGANIZATION_CREATION` to server validation and runtime env with default `"false"`.
- Modify `apps/webapp/src/env.test.ts`: verify default and accepted `"true"` value.
- Create `apps/webapp/src/lib/organization/creation-policy.ts`: server-only helper for organization creation availability.
- Create `apps/webapp/src/lib/organization/creation-policy.test.ts`: verify helper behavior without loading app auth.
- Modify `apps/webapp/src/lib/auth.ts`: deny Better Auth organization creation when helper says creation is disabled.
- Modify `apps/webapp/src/lib/effect/services/onboarding.service.ts`: reject onboarding organization creation before temporary permission mutation.
- Modify `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`: verify onboarding creation fails before database/auth mutation when disabled.
- Modify `apps/webapp/src/components/app-sidebar.tsx`: pass false to the organization switcher when creation is disabled.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`: pass false to the organizations settings client when creation is disabled.

## Task 1: Validate The Env Var

**Files:**
- Modify: `apps/webapp/src/env.test.ts`
- Modify: `apps/webapp/src/env.ts`

- [ ] **Step 1: Add failing env tests**

Add these tests after the `defaults to the vault secret store provider` test in `apps/webapp/src/env.test.ts`:

```ts
	test("defaults organization creation disabling to false", async () => {
		const { env } = await importEnv({ DISABLE_ORGANIZATION_CREATION: undefined });

		expect(env.DISABLE_ORGANIZATION_CREATION).toBe("false");
	});

	test("accepts disabling organization creation", async () => {
		const { env } = await importEnv({ DISABLE_ORGANIZATION_CREATION: "true" });

		expect(env.DISABLE_ORGANIZATION_CREATION).toBe("true");
	});
```

- [ ] **Step 2: Run env tests to verify failure**

Run: `pnpm --filter webapp test src/env.test.ts`

Expected: FAIL because `env.DISABLE_ORGANIZATION_CREATION` is not defined yet.

- [ ] **Step 3: Add env schema and runtime mapping**

In `apps/webapp/src/env.ts`, add this server schema entry near the other system-level boolean flags, after `SECURITY_HSTS_PRELOAD`:

```ts
		// Dedicated/private deployment controls
		DISABLE_ORGANIZATION_CREATION: z.enum(["true", "false"]).default("false"),
```

In the same file, add this runtime env mapping after `SECURITY_HSTS_PRELOAD: process.env.SECURITY_HSTS_PRELOAD,`:

```ts
		DISABLE_ORGANIZATION_CREATION: process.env.DISABLE_ORGANIZATION_CREATION,
```

- [ ] **Step 4: Run env tests to verify pass**

Run: `pnpm --filter webapp test src/env.test.ts`

Expected: PASS for all `env` tests.

- [ ] **Step 5: Checkpoint diff**

Run: `git diff -- apps/webapp/src/env.ts apps/webapp/src/env.test.ts`

Expected: diff only contains the new env schema/runtime entry and the two tests. Do not commit unless the user explicitly asks for commits.

## Task 2: Add A Shared Creation Policy Helper

**Files:**
- Create: `apps/webapp/src/lib/organization/creation-policy.ts`
- Create: `apps/webapp/src/lib/organization/creation-policy.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/webapp/src/lib/organization/creation-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	canCreateOrganizationsForDeployment,
	isOrganizationCreationDisabled,
} from "./creation-policy";

describe("organization creation policy", () => {
	it("allows creation when the deployment flag is false", () => {
		expect(isOrganizationCreationDisabled("false")).toBe(false);
		expect(canCreateOrganizationsForDeployment(true, "false")).toBe(true);
		expect(canCreateOrganizationsForDeployment(false, "false")).toBe(false);
	});

	it("blocks creation for every user when the deployment flag is true", () => {
		expect(isOrganizationCreationDisabled("true")).toBe(true);
		expect(canCreateOrganizationsForDeployment(true, "true")).toBe(false);
		expect(canCreateOrganizationsForDeployment(false, "true")).toBe(false);
	});
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run: `pnpm --filter webapp test src/lib/organization/creation-policy.test.ts`

Expected: FAIL because `creation-policy.ts` does not exist yet.

- [ ] **Step 3: Implement helper**

Create `apps/webapp/src/lib/organization/creation-policy.ts`:

```ts
import "server-only";

import { env } from "@/env";

type OrganizationCreationFlag = "true" | "false";

export function isOrganizationCreationDisabled(
	flag: OrganizationCreationFlag = env.DISABLE_ORGANIZATION_CREATION,
) {
	return flag === "true";
}

export function canCreateOrganizationsForDeployment(
	userCanCreateOrganizations: boolean,
	flag: OrganizationCreationFlag = env.DISABLE_ORGANIZATION_CREATION,
) {
	return !isOrganizationCreationDisabled(flag) && userCanCreateOrganizations;
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run: `pnpm --filter webapp test src/lib/organization/creation-policy.test.ts`

Expected: PASS for both helper tests.

- [ ] **Step 5: Checkpoint diff**

Run: `git diff -- apps/webapp/src/lib/organization/creation-policy.ts apps/webapp/src/lib/organization/creation-policy.test.ts`

Expected: diff only contains the new helper and tests. Do not commit unless the user explicitly asks for commits.

## Task 3: Enforce The Policy In Auth And Server UI

**Files:**
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`

- [ ] **Step 1: Import the helper in Better Auth config**

In `apps/webapp/src/lib/auth.ts`, add this import with the other local imports:

```ts
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy";
```

- [ ] **Step 2: Apply the helper in `allowUserToCreateOrganization`**

Replace the existing `allowUserToCreateOrganization` body in `apps/webapp/src/lib/auth.ts` with:

```ts
			allowUserToCreateOrganization: async (user) => {
				// Check if user has permission to create organizations
				const userRecord = await db.query.user.findFirst({
					where: eq(schema.user.id, user.id),
				});
				const userCanCreateOrganizations =
					userRecord?.role === "admin" || (userRecord?.canCreateOrganizations ?? false);

				return canCreateOrganizationsForDeployment(userCanCreateOrganizations);
			},
```

- [ ] **Step 3: Import the helper in sidebar**

In `apps/webapp/src/components/app-sidebar.tsx`, add this import with the other local imports:

```ts
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy";
```

- [ ] **Step 4: Apply the helper in sidebar props**

In `apps/webapp/src/components/app-sidebar.tsx`, replace the `canCreateOrganizations` prop with:

```tsx
					canCreateOrganizations={canCreateOrganizationsForDeployment(
						session?.user?.canCreateOrganizations || session?.user?.role === "admin",
					)}
```

- [ ] **Step 5: Import the helper in settings organizations page**

In `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`, add this import with the other local imports:

```ts
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy";
```

- [ ] **Step 6: Apply the helper in settings page props**

In `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`, replace the `canCreateOrganizations` prop with:

```tsx
			canCreateOrganizations={canCreateOrganizationsForDeployment(
				authContext.user.canCreateOrganizations || authContext.user.role === "admin",
			)}
```

- [ ] **Step 7: Run policy and type-focused tests**

Run: `pnpm --filter webapp test src/lib/organization/creation-policy.test.ts src/env.test.ts`

Expected: PASS for helper and env tests.

- [ ] **Step 8: Checkpoint diff**

Run: `git diff -- apps/webapp/src/lib/auth.ts apps/webapp/src/components/app-sidebar.tsx 'apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx'`

Expected: Better Auth and both UI prop calculations use `canCreateOrganizationsForDeployment`. Do not commit unless the user explicitly asks for commits.

## Task 4: Block Onboarding Creation Before Permission Mutation

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.ts`

- [ ] **Step 1: Mock the creation policy in onboarding tests**

In `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`, add this hoisted state after the imports:

```ts
const creationPolicyState = vi.hoisted(() => ({
	disabled: false,
}));
```

Add this mock after the existing `@/lib/auth` mock:

```ts
vi.mock("@/lib/organization/creation-policy", () => ({
	isOrganizationCreationDisabled: () => creationPolicyState.disabled,
}));
```

- [ ] **Step 2: Reset the policy state before each onboarding test**

Update the Vitest import in `apps/webapp/src/lib/effect/services/onboarding.service.test.ts` from:

```ts
import { describe, expect, it, vi } from "vitest";
```

to:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
```

Add this before the first `describe` block:

```ts
beforeEach(() => {
	creationPolicyState.disabled = false;
	vi.clearAllMocks();
});
```

- [ ] **Step 3: Add failing onboarding guard test**

Add this new describe block before `describe("OnboardingService.updateProfile", () => {`:

```ts
describe("OnboardingService.createOrganization", () => {
	it("rejects organization creation before enabling temporary creation permission when disabled", async () => {
		creationPolicyState.disabled = true;
		const mockDb = {
			update: vi.fn(),
			insert: vi.fn(),
		};
		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: { id: "user-1" },
						session: { activeOrganizationId: null },
					} as never),
			}),
		);
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* OnboardingService;

					return yield* service.createOrganization({
						name: "Acme Inc.",
						slug: "acme",
					});
				}).pipe(Effect.provide(layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(ValidationError),
		});
		expect(result).toMatchObject({
			left: {
				message: "Organization creation is disabled for this deployment.",
				field: "organization",
			},
		});
		expect(mockDb.update).not.toHaveBeenCalled();
		expect(mockDb.insert).not.toHaveBeenCalled();
		expect(auth.api.createOrganization).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 4: Run onboarding test to verify failure**

Run: `pnpm --filter webapp test src/lib/effect/services/onboarding.service.test.ts`

Expected: FAIL because `createOrganization` does not check `isOrganizationCreationDisabled()` yet.

- [ ] **Step 5: Import policy helper in onboarding service**

In `apps/webapp/src/lib/effect/services/onboarding.service.ts`, add this import with the other local imports:

```ts
import { isOrganizationCreationDisabled } from "@/lib/organization/creation-policy";
```

- [ ] **Step 6: Add minimal onboarding guard**

In `apps/webapp/src/lib/effect/services/onboarding.service.ts`, add this block immediately after `const session = yield* authService.getSession();` inside `createOrganization`:

```ts
					if (isOrganizationCreationDisabled()) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Organization creation is disabled for this deployment.",
								field: "organization",
							}),
						);
					}
```

- [ ] **Step 7: Run onboarding tests to verify pass**

Run: `pnpm --filter webapp test src/lib/effect/services/onboarding.service.test.ts`

Expected: PASS for all onboarding service tests.

- [ ] **Step 8: Checkpoint diff**

Run: `git diff -- apps/webapp/src/lib/effect/services/onboarding.service.ts apps/webapp/src/lib/effect/services/onboarding.service.test.ts`

Expected: onboarding creation checks the deployment flag before any DB update, and the test verifies no mutation occurs. Do not commit unless the user explicitly asks for commits.

## Task 5: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter webapp test src/env.test.ts src/lib/organization/creation-policy.test.ts src/lib/effect/services/onboarding.service.test.ts`

Expected: PASS for all focused tests.

- [ ] **Step 2: Run broader verification**

Run: `pnpm --filter webapp test`

Expected: PASS for the webapp test suite. If unrelated existing failures appear, capture exact failing test names and confirm they are unrelated before proceeding.

- [ ] **Step 3: Inspect final diff**

Run: `git diff -- apps/webapp/src/env.ts apps/webapp/src/env.test.ts apps/webapp/src/lib/organization/creation-policy.ts apps/webapp/src/lib/organization/creation-policy.test.ts apps/webapp/src/lib/auth.ts apps/webapp/src/lib/effect/services/onboarding.service.ts apps/webapp/src/lib/effect/services/onboarding.service.test.ts apps/webapp/src/components/app-sidebar.tsx 'apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx' docs/superpowers/specs/2026-05-24-disable-organization-creation-env-design.md docs/superpowers/plans/2026-05-24-disable-organization-creation-env.md`

Expected: final diff matches the approved spec and this plan. Do not commit unless the user explicitly asks for commits.

## Self-Review

- Spec coverage: The plan validates a default-off env var, blocks all users in Better Auth and onboarding, updates server UI props, and adds focused tests.
- Placeholder scan: No placeholder implementation steps remain; every code change includes concrete snippets and exact paths.
- Type consistency: The plan uses `DISABLE_ORGANIZATION_CREATION`, `isOrganizationCreationDisabled`, and `canCreateOrganizationsForDeployment` consistently across tests and implementation.
