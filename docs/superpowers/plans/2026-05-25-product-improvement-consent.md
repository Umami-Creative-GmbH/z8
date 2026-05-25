# Product Improvement Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global user preference that controls whether product analytics are tracked, default it to enabled, expose it in onboarding and profile settings, and gate PostHog initialization on that preference.

**Architecture:** Store the preference on the existing global `user_settings` row as `helpImproveProduct`. The server layout reads the authenticated user's setting and passes a boolean into the client `PostHogProvider`, which only initializes PostHog when the env token exists and consent is true. Onboarding and profile settings write the same global setting through authenticated server actions.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM/PostgreSQL migrations, Effect services, TanStack Form, Vitest, Testing Library, PostHog JS.

---

## File Structure

- Modify `apps/webapp/src/db/schema/user-settings.ts`: add typed `helpImproveProduct` column.
- Create `apps/webapp/drizzle/0032_product_improvement_consent.sql`: add the database column with default `true` and `NOT NULL`.
- Modify `apps/webapp/drizzle/meta/_journal.json`: append the 0032 migration with `when` greater than `1779654701733`.
- Create `apps/webapp/src/db/schema/__tests__/user-settings-schema.test.ts`: assert schema column default and migration SQL.
- Modify `apps/webapp/src/lib/validations/onboarding.ts`: include `helpImproveProduct` in onboarding profile schema with default `true`.
- Modify `apps/webapp/src/lib/effect/services/onboarding.service.ts`: persist onboarding profile preference to `user_settings`.
- Modify `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`: assert onboarding profile write persists the preference.
- Modify `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`: add generic consent UI to onboarding profile form.
- Modify `apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx`: assert default checked state and submitted payload.
- Modify `apps/webapp/src/lib/validations/profile.ts`: include profile preference validation.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`: add read/update helpers for the preference and persist it with profile details.
- Modify `apps/webapp/src/components/settings/profile-form.tsx`: add generic opt-out UI and submit the value.
- Modify `apps/webapp/src/components/settings/profile-form.test.tsx`: assert load/submit behavior.
- Modify `apps/webapp/src/components/posthog-provider.tsx`: accept `helpImproveProduct` prop, gate init, and opt out/reset when false.
- Create or modify `apps/webapp/src/components/posthog-provider.test.tsx`: assert PostHog is not initialized when consent is false.
- Modify `apps/webapp/src/app/[locale]/layout.tsx`: read the preference server-side and pass it into `PostHogProvider`.

---

### Task 1: Database Schema And Migration

**Files:**
- Modify: `apps/webapp/src/db/schema/user-settings.ts`
- Create: `apps/webapp/drizzle/0032_product_improvement_consent.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Create: `apps/webapp/src/db/schema/__tests__/user-settings-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `apps/webapp/src/db/schema/__tests__/user-settings-schema.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { userSettings } from "../user-settings";

function columnDefault(columnName: string): unknown {
	return getTableConfig(userSettings).columns.find((column) => column.name === columnName)?.default;
}

function columnNotNull(columnName: string): boolean | undefined {
	return getTableConfig(userSettings).columns.find((column) => column.name === columnName)?.notNull;
}

describe("user settings schema", () => {
	it("stores product improvement consent as enabled by default", () => {
		expect(columnDefault("help_improve_product")).toBe(true);
		expect(columnNotNull("help_improve_product")).toBe(true);

		const migration = readFileSync("drizzle/0032_product_improvement_consent.sql", "utf8");
		expect(migration).toContain(
			'ALTER TABLE "user_settings" ADD COLUMN "help_improve_product" boolean DEFAULT true NOT NULL',
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/db/schema/__tests__/user-settings-schema.test.ts"
```

Expected: FAIL because `help_improve_product` and the migration do not exist yet.

- [ ] **Step 3: Add the Drizzle schema column**

In `apps/webapp/src/db/schema/user-settings.ts`, add this immediately after the onboarding fields and before water reminder settings:

```ts
		// Product improvement consent
		helpImproveProduct: boolean("help_improve_product").default(true).notNull(),
```

- [ ] **Step 4: Add migration SQL**

Create `apps/webapp/drizzle/0032_product_improvement_consent.sql`:

```sql
ALTER TABLE "user_settings" ADD COLUMN "help_improve_product" boolean DEFAULT true NOT NULL;
```

- [ ] **Step 5: Register migration in journal**

Append this entry to `apps/webapp/drizzle/meta/_journal.json` after the `0031_lean_millenium_guard` entry. Use `when: 1779654701734`, which is greater than the existing latest `1779654701733`:

```json
{
  "idx": 32,
  "version": "7",
  "when": 1779654701734,
  "tag": "0032_product_improvement_consent",
  "breakpoints": true
}
```

- [ ] **Step 6: Run schema test to verify it passes**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/db/schema/__tests__/user-settings-schema.test.ts"
```

Expected: PASS.

- [ ] **Step 7: Commit schema and migration**

Run:

```bash
git add "apps/webapp/src/db/schema/user-settings.ts" "apps/webapp/drizzle/0032_product_improvement_consent.sql" "apps/webapp/drizzle/meta/_journal.json" "apps/webapp/src/db/schema/__tests__/user-settings-schema.test.ts"
git commit -m "feat: add product improvement consent setting"
```

---

### Task 2: Onboarding Profile Consent

**Files:**
- Modify: `apps/webapp/src/lib/validations/onboarding.ts`
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`
- Modify: `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx`

- [ ] **Step 1: Write/update failing onboarding UI test**

In `apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx`, add a test that renders the profile onboarding page, verifies the consent is checked by default, unchecks it, submits, and expects the action to receive `helpImproveProduct: false`.

Use this assertion pattern:

```ts
expect(screen.getByRole("checkbox", { name: "Help us improve this app" })).toBeChecked();
fireEvent.click(screen.getByRole("checkbox", { name: "Help us improve this app" }));
fireEvent.click(screen.getByRole("button", { name: "Continue" }));

await waitFor(() => {
	expect(updateProfileOnboardingMock).toHaveBeenCalledWith(
		expect.objectContaining({ helpImproveProduct: false }),
	);
});
```

- [ ] **Step 2: Run onboarding UI test to verify it fails**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/app/[locale]/onboarding/profile/page.test.tsx"
```

Expected: FAIL because the checkbox does not exist.

- [ ] **Step 3: Extend onboarding validation**

In `apps/webapp/src/lib/validations/onboarding.ts`, add the field to `onboardingProfileSchema`:

```ts
	helpImproveProduct: z.boolean().default(true),
```

- [ ] **Step 4: Add onboarding form default**

In `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`, add to `defaultValues`:

```ts
	helpImproveProduct: true,
```

- [ ] **Step 5: Add onboarding consent UI**

In `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`, import the checkbox or switch component used in this app. Prefer existing `Switch` if available at `@/components/ui/switch`; otherwise use `Checkbox` if that is the local pattern.

Add this field after the time format field and before action buttons:

```tsx
<form.Field name="helpImproveProduct">
	{(field) => (
		<div className="rounded-lg border bg-muted/30 p-4">
			<div className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<Label htmlFor="help-improve-product">
						{t("onboarding.profile.helpImproveProduct", "Help us improve this app")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"onboarding.profile.helpImproveProductDesc",
							"Share usage insights so we can make Z8 more reliable and useful. You can change this later in your profile settings.",
						)}
					</p>
				</div>
				<Switch
					id="help-improve-product"
					checked={field.state.value}
					onCheckedChange={field.handleChange}
					disabled={loading}
					aria-label={t("onboarding.profile.helpImproveProduct", "Help us improve this app")}
				/>
			</div>
		</div>
	)}
</form.Field>
```

- [ ] **Step 6: Write failing service persistence test**

In `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`, add or update the `OnboardingService.updateProfile` test so the submitted data includes `helpImproveProduct: false` and the DB upsert assertion includes:

```ts
expect.objectContaining({
	helpImproveProduct: false,
})
```

- [ ] **Step 7: Run service test to verify it fails**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/lib/effect/services/onboarding.service.test.ts"
```

Expected: FAIL because the service does not persist `helpImproveProduct` yet.

- [ ] **Step 8: Persist onboarding preference**

In `apps/webapp/src/lib/effect/services/onboarding.service.ts`, inside `updateProfile`, add `helpImproveProduct: data.helpImproveProduct` to the `userSettings` insert values and conflict update set where week start/time format are already persisted.

The updated values should include:

```ts
	helpImproveProduct: data.helpImproveProduct,
	weekStartDay: data.weekStartDay,
	timeFormat: data.timeFormat,
```

- [ ] **Step 9: Run onboarding tests**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/app/[locale]/onboarding/profile/page.test.tsx" "src/lib/effect/services/onboarding.service.test.ts"
```

Expected: PASS.

- [ ] **Step 10: Commit onboarding changes**

Run:

```bash
git add "apps/webapp/src/lib/validations/onboarding.ts" "apps/webapp/src/lib/effect/services/onboarding.service.ts" "apps/webapp/src/lib/effect/services/onboarding.service.test.ts" "apps/webapp/src/app/[locale]/onboarding/profile/page.tsx" "apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx"
git commit -m "feat: collect product improvement consent during onboarding"
```

---

### Task 3: Profile Settings Preference

**Files:**
- Modify: `apps/webapp/src/lib/validations/profile.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
- Modify: `apps/webapp/src/components/settings/profile-form.tsx`
- Modify: `apps/webapp/src/components/settings/profile-form.test.tsx`

- [ ] **Step 1: Write failing profile form test**

In `apps/webapp/src/components/settings/profile-form.test.tsx`, extend `renderProfileForm` so the `user` prop can include `helpImproveProduct?: boolean`. Add a test that renders with `helpImproveProduct: false`, verifies the switch/checkbox is off, toggles it on, submits, and expects:

```ts
await waitFor(() => {
	expect(updateProfileDetailsMock).toHaveBeenCalledWith(
		expect.objectContaining({ helpImproveProduct: true }),
	);
});
```

- [ ] **Step 2: Run profile form test to verify it fails**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/components/settings/profile-form.test.tsx"
```

Expected: FAIL because the preference is not rendered or submitted.

- [ ] **Step 3: Extend profile validation**

In `apps/webapp/src/lib/validations/profile.ts`, add `helpImproveProduct: z.boolean().default(true)` to `profileDetailsUpdateSchema`.

- [ ] **Step 4: Extend profile action input**

In `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`, add `helpImproveProduct?: boolean` to `StructuredProfileDetailsInput` and `updateProfileDetails` input type.

- [ ] **Step 5: Persist profile preference**

In `updateProfileDetails`, after `syncActiveEmployeeProfile` succeeds, upsert `userSettings` for `session.user.id`:

```ts
yield* _(
	dbService.query("updateProfilePreferences", async () => {
		await dbService.db
			.insert(userSettings)
			.values({
				userId: session.user.id,
				helpImproveProduct: result.data.helpImproveProduct ?? true,
			})
			.onConflictDoUpdate({
				target: userSettings.userId,
				set: {
					helpImproveProduct: result.data.helpImproveProduct ?? true,
				},
			});
	}),
);
```

- [ ] **Step 6: Expose current preference to profile form**

Find the server component that renders `ProfileForm` and passes the `user` prop. Query `userSettings.helpImproveProduct` for the current user and pass `helpImproveProduct: settings?.helpImproveProduct ?? true` into `ProfileForm`.

- [ ] **Step 7: Add profile form field**

In `apps/webapp/src/components/settings/profile-form.tsx`:

1. Add `helpImproveProduct: boolean` to `ProfileFormValues`.
2. Add `helpImproveProduct?: boolean` to the `user` prop shape.
3. Add `helpImproveProduct: user.helpImproveProduct ?? true` to default values.
4. Include `helpImproveProduct: value.helpImproveProduct` in the `updateProfileDetails` payload.
5. Add the same generic UI copy as onboarding near the personal preferences section.

Use this field body:

```tsx
<form.Field name="helpImproveProduct">
	{(field) => (
		<div className="rounded-lg border bg-muted/30 p-4">
			<div className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<Label htmlFor="profile-help-improve-product">
						{t("settings.profile.helpImproveProduct", "Help us improve this app")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.profile.helpImproveProductDescription",
							"Share usage insights so we can make Z8 more reliable and useful.",
						)}
					</p>
				</div>
				<Switch
					id="profile-help-improve-product"
					checked={field.state.value}
					onCheckedChange={field.handleChange}
					disabled={isSubmitting}
					aria-label={t("settings.profile.helpImproveProduct", "Help us improve this app")}
				/>
			</div>
		</div>
	)}
</form.Field>
```

- [ ] **Step 8: Run profile tests**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/components/settings/profile-form.test.tsx"
```

Expected: PASS.

- [ ] **Step 9: Commit profile preference changes**

Run:

```bash
git add "apps/webapp/src/lib/validations/profile.ts" "apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts" "apps/webapp/src/components/settings/profile-form.tsx" "apps/webapp/src/components/settings/profile-form.test.tsx"
git commit -m "feat: add product improvement preference to profile"
```

---

### Task 4: Gate PostHog Provider By Consent

**Files:**
- Modify: `apps/webapp/src/components/posthog-provider.tsx`
- Create or modify: `apps/webapp/src/components/posthog-provider.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/layout.tsx`

- [ ] **Step 1: Write failing provider test**

Create `apps/webapp/src/components/posthog-provider.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { initMock, optOutMock, resetMock } = vi.hoisted(() => ({
	initMock: vi.fn(),
	optOutMock: vi.fn(),
	resetMock: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
		NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
	},
}));

vi.mock("posthog-js", () => ({
	default: {
		init: initMock,
		opt_out_capturing: optOutMock,
		reset: resetMock,
	},
}));

vi.mock("posthog-js/react", () => ({
	PostHogProvider: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="posthog-provider">{children}</div>
	),
}));

import { PostHogProvider } from "./posthog-provider";

describe("PostHogProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not initialize tracking when product improvement consent is disabled", () => {
		render(
			<PostHogProvider helpImproveProduct={false}>
				<div>App</div>
			</PostHogProvider>,
		);

		expect(screen.getByText("App")).toBeTruthy();
		expect(screen.queryByTestId("posthog-provider")).toBeNull();
		expect(initMock).not.toHaveBeenCalled();
		expect(optOutMock).toHaveBeenCalled();
		expect(resetMock).toHaveBeenCalled();
	});

	it("initializes tracking when product improvement consent is enabled", () => {
		render(
			<PostHogProvider helpImproveProduct>
				<div>App</div>
			</PostHogProvider>,
		);

		expect(screen.getByTestId("posthog-provider")).toBeTruthy();
		expect(initMock).toHaveBeenCalledWith(
			"phc_test",
			expect.objectContaining({ api_host: "/ingest" }),
		);
	});
});
```

- [ ] **Step 2: Run provider test to verify it fails**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/components/posthog-provider.test.tsx"
```

Expected: FAIL because `helpImproveProduct` is not a provider prop yet.

- [ ] **Step 3: Update provider implementation**

Modify `apps/webapp/src/components/posthog-provider.tsx` to accept the prop and gate initialization:

```tsx
"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { env } from "@/env";

export function PostHogProvider({
	children,
	helpImproveProduct,
}: {
	children: React.ReactNode;
	helpImproveProduct: boolean;
}) {
	const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
	const canTrack = Boolean(projectToken && helpImproveProduct);

	useEffect(() => {
		if (!canTrack || !projectToken) {
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
	}, [canTrack, projectToken]);

	if (!canTrack) {
		return <>{children}</>;
	}

	return <PHProvider client={posthog}>{children}</PHProvider>;
}
```

- [ ] **Step 4: Add server-side preference reader in layout**

In `apps/webapp/src/app/[locale]/layout.tsx`, import `eq`, `db`, `userSettings`, and `auth`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
```

Add helper above `LocaleLayout`:

```ts
async function getHelpImproveProduct(): Promise<boolean> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return false;
	}

	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { helpImproveProduct: true },
	});

	return settings?.helpImproveProduct ?? true;
}
```

Then in `LocaleLayout`, before `return`, read the preference:

```ts
	const helpImproveProduct = await getHelpImproveProduct();
```

Pass it to the provider:

```tsx
<PostHogProvider helpImproveProduct={helpImproveProduct}>
```

- [ ] **Step 5: Run provider test**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run "src/components/posthog-provider.test.tsx"
```

Expected: PASS.

- [ ] **Step 6: Commit provider gating**

Run:

```bash
git add "apps/webapp/src/components/posthog-provider.tsx" "apps/webapp/src/components/posthog-provider.test.tsx" "apps/webapp/src/app/[locale]/layout.tsx"
git commit -m "fix: gate product tracking on user consent"
```

---

### Task 5: Final Verification

**Files:**
- Review all files changed in Tasks 1-4.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/vitest" run \
  "src/db/schema/__tests__/user-settings-schema.test.ts" \
  "src/app/[locale]/onboarding/profile/page.test.tsx" \
  "src/lib/effect/services/onboarding.service.test.ts" \
  "src/components/settings/profile-form.test.tsx" \
  "src/components/posthog-provider.test.tsx"
```

Expected: all listed test files pass.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/tsc" --noEmit --project "/home/kai/projects/z8/apps/webapp/tsconfig.json"
```

Expected: exit code 0 with no output.

- [ ] **Step 3: Run Biome on changed files**

Run with the final changed file list:

```bash
"/home/kai/projects/z8/apps/webapp/node_modules/.bin/biome" check \
  "src/db/schema/user-settings.ts" \
  "src/db/schema/__tests__/user-settings-schema.test.ts" \
  "src/lib/validations/onboarding.ts" \
  "src/lib/effect/services/onboarding.service.ts" \
  "src/lib/effect/services/onboarding.service.test.ts" \
  "src/app/[locale]/onboarding/profile/page.tsx" \
  "src/app/[locale]/onboarding/profile/page.test.tsx" \
  "src/lib/validations/profile.ts" \
  "src/app/[locale]/(app)/settings/profile/actions.ts" \
  "src/components/settings/profile-form.tsx" \
  "src/components/settings/profile-form.test.tsx" \
  "src/components/posthog-provider.tsx" \
  "src/components/posthog-provider.test.tsx" \
  "src/app/[locale]/layout.tsx"
```

Expected: no errors.

- [ ] **Step 4: Confirm no UI copy mentions PostHog**

Run:

```bash
rg "PostHog|posthog" "apps/webapp/src/app/[locale]/onboarding/profile" "apps/webapp/src/components/settings/profile-form.tsx"
```

Expected: no matches.

- [ ] **Step 5: Review git diff**

Run:

```bash
git diff --stat
git diff
```

Expected: changes are limited to the files listed in this plan, and no unrelated worktree changes are included.

- [ ] **Step 6: Final commit if needed**

If Task 5 made formatting or small verification fixes, commit them:

```bash
git add <only files changed for this feature>
git commit -m "chore: verify product improvement consent"
```

If there are no new changes after previous task commits, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: data model, onboarding UI, profile UI, provider gating, server-side preference source, and tests are all covered.
- Placeholder scan: no TBD/TODO/fill-in-later placeholders remain. Steps include exact files, commands, and implementation snippets.
- Type consistency: the setting name is consistently `helpImproveProduct` in TypeScript and `help_improve_product` in SQL.
