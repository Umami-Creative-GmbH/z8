# Demo Data Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an organization-level `demoDataEnabled` feature flag so owners can disable Demo Data settings while preserving current access by default.

**Architecture:** Follow the existing optional-feature path used by `shiftsEnabled`, `projectsEnabled`, and `surchargesEnabled`. Add the flag to Better Auth organization schema configuration, regenerate the generated schema, hydrate it into the client organization settings store, expose it in the owner-only features card, and gate the Demo Data settings entry through `requiredFeature`.

**Tech Stack:** Next.js 16, React 19, Better Auth, Drizzle, Zustand, Vitest, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/lib/auth.ts` - source Better Auth organization additional fields; add `demoDataEnabled` with default `true`.
- Regenerate: `apps/webapp/src/db/auth-schema.ts` - generated schema output from `pnpm --dir apps/webapp run auth:generate`.
- Create: `apps/webapp/drizzle/0008_demo_data_feature_flag.sql` - database migration adding `demo_data_enabled boolean default true` to `organization`.
- Modify: `apps/webapp/src/stores/organization-settings-store.ts` - add `demoDataEnabled` to store state and selector.
- Modify: `apps/webapp/src/hooks/use-organization.ts` - include `demoDataEnabled` in API response typing.
- Modify: `apps/webapp/src/app/api/auth/context/route.ts` - select and return `demoDataEnabled`.
- Modify: `apps/webapp/src/lib/auth-helpers.ts` - include `demoDataEnabled` where user organizations are mapped if needed by callers.
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx` - pass `demoDataEnabled` into the features card.
- Modify: `apps/webapp/src/components/organization/organization-features-card.tsx` - add a Demo Data feature switch following the existing optimistic update pattern.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts` - allow toggling `demoDataEnabled`.
- Modify: `apps/webapp/src/components/settings/settings-config.ts` - extend `FeatureFlag` and gate the Demo Data entry.
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts` - add coverage for visible/hidden Demo Data settings.

## Tasks

### Task 1: Add Failing Settings Visibility Test

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Add failing test cases**

Append this test before the final `});` in `settings-config.test.ts`:

```ts
	it("hides demo data when the demo data feature is disabled", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: false,
		});

		expect(entries.some((entry) => entry.id === "demo-data")).toBe(false);
	});

	it("shows demo data when the demo data feature is enabled", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: true,
		});

		expect(entries.some((entry) => entry.id === "demo-data")).toBe(true);
	});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm --dir apps/webapp test src/components/settings/settings-config.test.ts`

Expected: TypeScript or assertion failure because `demoDataEnabled` is not yet part of `FeatureFlag`, and Demo Data is not yet gated.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "test: cover demo data feature visibility"
```

### Task 2: Add The Feature Flag To Settings Visibility

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Extend `FeatureFlag`**

Change the `FeatureFlag` type to:

```ts
export type FeatureFlag =
	| "shiftsEnabled"
	| "projectsEnabled"
	| "surchargesEnabled"
	| "demoDataEnabled";
```

- [ ] **Step 2: Gate Demo Data settings**

Update the Demo Data entry in `SETTINGS_ENTRIES`:

```ts
	{
		id: "demo-data",
		titleKey: "settings.demoData.title",
		titleDefault: "Demo Data",
		descriptionKey: "settings.demoData.description",
		descriptionDefault:
			"Generate sample data for testing or clear all time-related data",
		href: "/settings/demo",
		icon: "test-pipe",
		minimumTier: "orgAdmin",
		group: "data",
		requiredFeature: "demoDataEnabled",
	},
```

- [ ] **Step 3: Update existing feature-flag test inputs**

Where tests pass all-disabled feature flags, include:

```ts
demoDataEnabled: false,
```

Where tests need current behavior, include:

```ts
demoDataEnabled: true,
```

- [ ] **Step 4: Run the focused test**

Run: `pnpm --dir apps/webapp test src/components/settings/settings-config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat: gate demo data settings by feature flag"
```

### Task 3: Add Organization Schema And Migration

**Files:**
- Modify: `apps/webapp/src/lib/auth.ts`
- Regenerate: `apps/webapp/src/db/auth-schema.ts`
- Create: `apps/webapp/drizzle/0008_demo_data_feature_flag.sql`

- [ ] **Step 1: Add the Better Auth organization field**

In `apps/webapp/src/lib/auth.ts`, add this next to the other feature booleans:

```ts
						demoDataEnabled: {
							type: "boolean",
							required: false,
							defaultValue: true,
							input: true,
						},
```

- [ ] **Step 2: Regenerate Better Auth schema**

Run: `pnpm --dir apps/webapp run auth:generate`

Expected: `apps/webapp/src/db/auth-schema.ts` is updated with `demoDataEnabled: boolean("demo_data_enabled").default(true)`.

- [ ] **Step 3: Add migration SQL**

Create `apps/webapp/drizzle/0008_demo_data_feature_flag.sql`:

```sql
ALTER TABLE "organization" ADD COLUMN "demo_data_enabled" boolean DEFAULT true;
```

- [ ] **Step 4: Run schema-related tests**

Run: `pnpm --dir apps/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/auth.ts apps/webapp/src/db/auth-schema.ts apps/webapp/drizzle/0008_demo_data_feature_flag.sql
git commit -m "feat: add demo data organization feature flag"
```

### Task 4: Hydrate Demo Data Feature State

**Files:**
- Modify: `apps/webapp/src/stores/organization-settings-store.ts`
- Modify: `apps/webapp/src/hooks/use-organization.ts`
- Modify: `apps/webapp/src/app/api/auth/context/route.ts`
- Modify: `apps/webapp/src/lib/auth-helpers.ts`

- [ ] **Step 1: Update the settings store**

Add `demoDataEnabled` to `OrganizationSettings`, `initialState`, and selectors:

```ts
demoDataEnabled: boolean;
```

```ts
demoDataEnabled: true,
```

```ts
export const useDemoDataEnabled = () =>
	useOrganizationSettings((state) => state.demoDataEnabled);
```

- [ ] **Step 2: Update client API response type**

In `use-organization.ts`, update `OrganizationSettingsResponse`:

```ts
interface OrganizationSettingsResponse {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	timezone: string;
	deletedAt: string | null;
}
```

- [ ] **Step 3: Return flag from auth context route**

In `route.ts`, include the column:

```ts
demoDataEnabled: true,
```

and return value:

```ts
demoDataEnabled: org.demoDataEnabled ?? true,
```

- [ ] **Step 4: Update `UserOrganization` mapping**

In `auth-helpers.ts`, add:

```ts
demoDataEnabled: boolean;
```

and in the mapper:

```ts
demoDataEnabled: org.demoDataEnabled ?? true,
```

- [ ] **Step 5: Run TypeScript/build check**

Run: `pnpm --dir apps/webapp build`

Expected: Build succeeds or reports only unrelated existing failures. Any failure caused by `demoDataEnabled` missing from types must be fixed before continuing.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/stores/organization-settings-store.ts apps/webapp/src/hooks/use-organization.ts apps/webapp/src/app/api/auth/context/route.ts apps/webapp/src/lib/auth-helpers.ts
git commit -m "feat: hydrate demo data feature state"
```

### Task 5: Add Owner Toggle UI And Server Action Support

**Files:**
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx`
- Modify: `apps/webapp/src/components/organization/organization-features-card.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`

- [ ] **Step 1: Extend server action feature union**

In `toggleOrganizationFeature`, update the `feature` parameter type:

```ts
feature: "shiftsEnabled" | "projectsEnabled" | "surchargesEnabled" | "demoDataEnabled",
```

- [ ] **Step 2: Pass the prop from organization tab**

Update `OrganizationFeaturesCard` usage:

```tsx
<OrganizationFeaturesCard
	organizationId={organization.id}
	shiftsEnabled={organization.shiftsEnabled ?? false}
	projectsEnabled={organization.projectsEnabled ?? false}
	surchargesEnabled={organization.surchargesEnabled ?? false}
	demoDataEnabled={organization.demoDataEnabled ?? true}
	currentMemberRole={currentMemberRole}
/>
```

- [ ] **Step 3: Add component props and state**

In `OrganizationFeaturesCardProps`, add:

```ts
demoDataEnabled: boolean;
```

In props destructuring, add `demoDataEnabled`, and add state:

```ts
const [isDemoDataEnabled, setIsDemoDataEnabled] = useState(demoDataEnabled);
```

- [ ] **Step 4: Add toggle handler**

Add this handler next to the existing handlers:

```ts
const handleToggleDemoData = async (enabled: boolean) => {
	if (!canEdit) return;

	setIsDemoDataEnabled(enabled);
	setOrgSettings({ demoDataEnabled: enabled });

	const result = await toggleOrganizationFeature(organizationId, "demoDataEnabled", enabled);

	if (result.success) {
		toast.success(
			enabled
				? t("organization.features.demo-data-enabled", "Demo Data enabled")
				: t("organization.features.demo-data-disabled", "Demo Data disabled"),
		);
		startTransition(() => {
			router.refresh();
		});
	} else {
		setIsDemoDataEnabled(!enabled);
		setOrgSettings({ demoDataEnabled: !enabled });
		toast.error(result.error || t("organization.features.update-failed", "Failed to update feature"));
	}
};
```

- [ ] **Step 5: Add UI row**

Import `IconDatabase` from `@tabler/icons-react` and add this row in the card:

```tsx
<div className="flex items-center justify-between">
	<div className="flex items-start gap-3">
		<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
			<IconDatabase className="h-5 w-5 text-primary" />
		</div>
		<div className="space-y-1">
			<Label htmlFor="demo-data-toggle" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
				{t("organization.features.demo-data", "Demo Data")}
			</Label>
			<p className="text-sm text-muted-foreground">
				{t("organization.features.demo-data-description", "Allow admins to generate and clear sample organization data for testing.")}
			</p>
		</div>
	</div>
	<div className="flex items-center gap-2">
		{isPending && <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
		<Switch
			id="demo-data-toggle"
			checked={isDemoDataEnabled}
			onCheckedChange={handleToggleDemoData}
			disabled={!canEdit || isPending}
			aria-label={t("organization.features.toggle-demo-data", "Toggle demo data")}
		/>
	</div>
</div>
```

- [ ] **Step 6: Run focused tests and type check**

Run: `pnpm --dir apps/webapp test src/components/settings/settings-config.test.ts`

Expected: PASS.

Run: `pnpm --dir apps/webapp build`

Expected: Build succeeds or reports only unrelated existing failures. Any failure caused by the new prop, store field, or action union must be fixed.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organization-features-card.tsx apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts
git commit -m "feat: add demo data feature toggle"
```

### Task 6: Final Verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run focused tests**

Run: `pnpm --dir apps/webapp test src/components/settings/settings-config.test.ts`

Expected: PASS.

- [ ] **Step 2: Run app test suite if time allows**

Run: `pnpm --dir apps/webapp test`

Expected: PASS or document unrelated existing failures with file and test names.

- [ ] **Step 3: Run production build**

Run: `pnpm --dir apps/webapp build`

Expected: PASS or document unrelated existing failures with exact error output.

- [ ] **Step 4: Inspect final diff**

Run: `git diff --stat HEAD`

Expected: Only files from this plan are changed, plus generated schema/migration files.

- [ ] **Step 5: Final commit if verification fixes were needed**

```bash
git add <files changed during verification fixes>
git commit -m "fix: complete demo data feature flag wiring"
```

Skip this commit if no verification fixes were needed.

## Self-Review

- Spec coverage: The plan covers the organization feature flag, default-enabled behavior, owner toggle, settings visibility, schema generation, migration, hydration, and tests.
- Placeholder scan: No placeholder-only steps remain; each task includes exact files, code snippets, commands, and expected outcomes.
- Type consistency: The flag name is consistently `demoDataEnabled`; the database column is consistently `demo_data_enabled`; the settings gate uses `requiredFeature: "demoDataEnabled"`.
