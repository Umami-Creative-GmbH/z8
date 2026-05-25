# Works Council Org Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an organization-level `worksCouncilEnabled` feature flag that activates Works Council access and sidebar visibility for owners/admins or users with explicit Works Council permission.

**Architecture:** Store feature availability on the Better Auth `organization` table, hydrate it through the same organization settings paths as the other feature flags, and gate sidebar visibility with both the org feature flag and Works Council permission logic. Keep `works_council_settings.enabled` out of feature availability decisions.

**Tech Stack:** Next.js App Router, Better Auth organization plugin, Drizzle/Postgres migrations, CASL authorization, Zustand, React, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/auth.ts`: add `worksCouncilEnabled` to Better Auth organization `additionalFields`.
- Generate/modify `apps/webapp/src/db/auth-schema.ts`: organization table exposes `worksCouncilEnabled` mapped to `works_council_enabled`. This file is generated; prefer `pnpm --filter webapp auth:generate` after editing `auth.ts`.
- Create `apps/webapp/drizzle/0032_works_council_feature_flag.sql`: adds the `works_council_enabled` column with default `false`.
- Modify `apps/webapp/drizzle/meta/_journal.json`: register migration `0032_works_council_feature_flag` with a `when` greater than `1779654701733`.
- Modify `apps/webapp/drizzle/meta/0032_snapshot.json`: copy `0031_snapshot.json` and add `works_council_enabled` to `public.organization.columns`.
- Modify `apps/webapp/src/lib/auth-helpers.ts`: include `worksCouncilEnabled` in `UserOrganization` and `getUserOrganizations`.
- Modify `apps/webapp/src/app/api/auth/context/route.ts`: include `worksCouncilEnabled` in organization settings hydration.
- Modify `apps/webapp/src/hooks/use-organization.ts`: add `worksCouncilEnabled` to `OrganizationSettingsResponse`.
- Modify `apps/webapp/src/stores/organization-settings-store.ts`: add state and selector for `worksCouncilEnabled`.
- Modify `apps/webapp/src/components/settings/settings-config.ts`: add `worksCouncilEnabled` to `FeatureFlag` for consistency with sidebar/search feature state.
- Modify `apps/webapp/src/components/server-app-sidebar.tsx`: pass `worksCouncilEnabled` in feature flags and require it for `showWorksCouncilNav`.
- Modify `apps/webapp/src/app/[locale]/(app)/layout.tsx`: compute Works Council sidebar visibility from org flag plus permission, without using `works_council_settings.enabled`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`: allow `toggleOrganizationFeature(..., "worksCouncilEnabled", ...)`.
- Modify `apps/webapp/src/components/organization/organization-tab.tsx`: pass `worksCouncilEnabled` to the feature card.
- Modify `apps/webapp/src/components/organization/organization-features-card.tsx`: render and toggle the Works Council feature row.
- Modify tests: `app-sidebar.test.tsx`, `route.test.ts`, `organization-settings-store.test.ts`, and `drizzle-migrations.test.ts`.

Do not commit during execution unless the user explicitly asks for commits. If commits are requested later, use the commit commands listed as checkpoints.

---

### Task 1: Add Database and Auth Schema Support

**Files:**
- Modify: `apps/webapp/src/lib/auth.ts:420-443`
- Generate/modify: `apps/webapp/src/db/auth-schema.ts:99-118`
- Create: `apps/webapp/drizzle/0032_works_council_feature_flag.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json:222-228`
- Create: `apps/webapp/drizzle/meta/0032_snapshot.json`
- Test: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Write the failing migration test**

Add these constants near the existing migration constants in `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`:

```ts
const migration0032 = readFileSync(
	new URL("../../../drizzle/0032_works_council_feature_flag.sql", import.meta.url),
	"utf8",
);
const migration0032Snapshot = JSON.parse(
	readFileSync(new URL("../../../drizzle/meta/0032_snapshot.json", import.meta.url), "utf8"),
) as { tables: { "public.organization": { columns: Record<string, { default?: boolean }> } } };
```

Add this test inside `describe("drizzle follow-up migrations", ...)`:

```ts
it("registers the works council feature flag migration", () => {
	expect(
		migrationJournal.entries.some((entry) => entry.tag === "0032_works_council_feature_flag"),
	).toBe(true);
	expect(migration0032).toContain('ADD COLUMN "works_council_enabled" boolean DEFAULT false');
	expect(
		migration0032Snapshot.tables["public.organization"].columns.works_council_enabled?.default,
	).toBe(false);
});
```

- [ ] **Step 2: Run the migration test to verify it fails**

Run: `pnpm --filter webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: FAIL because `0032_works_council_feature_flag.sql` or `0032_snapshot.json` does not exist yet.

- [ ] **Step 3: Add the Better Auth organization field**

In `apps/webapp/src/lib/auth.ts`, add this block after `demoDataEnabled` in `organization.schema.organization.additionalFields`:

```ts
worksCouncilEnabled: {
	type: "boolean",
	required: false,
	defaultValue: false,
	input: false,
},
```

- [ ] **Step 4: Generate the Better Auth schema**

Run: `pnpm --filter webapp auth:generate`

Expected: `apps/webapp/src/db/auth-schema.ts` is regenerated and contains:

```ts
worksCouncilEnabled: boolean("works_council_enabled").default(false),
```

If generation is unavailable, apply the generated-equivalent change manually in `apps/webapp/src/db/auth-schema.ts`, but keep the change minimal because this file is generated.

- [ ] **Step 5: Add the SQL migration**

Create `apps/webapp/drizzle/0032_works_council_feature_flag.sql` with exactly:

```sql
ALTER TABLE "organization" ADD COLUMN "works_council_enabled" boolean DEFAULT false;
```

- [ ] **Step 6: Register the migration journal entry**

Append this entry after `0031_lean_millenium_guard` in `apps/webapp/drizzle/meta/_journal.json`:

```json
{
  "idx": 32,
  "version": "7",
  "when": 1779654701734,
  "tag": "0032_works_council_feature_flag",
  "breakpoints": true
}
```

Keep valid JSON by adding a comma after the previous entry.

- [ ] **Step 7: Add the snapshot**

Copy `apps/webapp/drizzle/meta/0031_snapshot.json` to `apps/webapp/drizzle/meta/0032_snapshot.json`, then add this column to `tables["public.organization"].columns` next to the other feature flags:

```json
"works_council_enabled": {
  "name": "works_council_enabled",
  "type": "boolean",
  "primaryKey": false,
  "notNull": false,
  "default": false
}
```

Also update snapshot metadata if present so its id/tag matches migration 0032, following the exact shape already used by `0031_snapshot.json`.

- [ ] **Step 8: Run the migration test to verify it passes**

Run: `pnpm --filter webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit checkpoint if commits were explicitly requested**

Run only if the user asked for commits:

```bash
git add apps/webapp/src/lib/auth.ts apps/webapp/src/db/auth-schema.ts apps/webapp/drizzle/0032_works_council_feature_flag.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/drizzle/meta/0032_snapshot.json apps/webapp/src/db/__tests__/drizzle-migrations.test.ts
git commit -m "feat: add works council org feature flag schema"
```

---

### Task 2: Hydrate Works Council Feature State

**Files:**
- Modify: `apps/webapp/src/lib/auth-helpers.ts:47-58,237-248`
- Modify: `apps/webapp/src/app/api/auth/context/route.ts:27-47`
- Modify: `apps/webapp/src/hooks/use-organization.ts:27-35`
- Modify: `apps/webapp/src/stores/organization-settings-store.ts:5-61`
- Test: `apps/webapp/src/app/api/auth/context/route.test.ts`
- Test: `apps/webapp/src/stores/organization-settings-store.test.ts`

- [ ] **Step 1: Write the failing API hydration test**

In `apps/webapp/src/app/api/auth/context/route.test.ts`, add `worksCouncilEnabled: true` to the mocked org row and expected `organizationSettings`:

```ts
mockState.findFirst.mockResolvedValue({
	deletedAt: null,
	demoDataEnabled: true,
	id: "org_1",
	projectsEnabled: false,
	shiftsEnabled: false,
	surchargesEnabled: false,
	timezone: "UTC",
	worksCouncilEnabled: true,
});

expect(body.organizationSettings).toEqual({
	deletedAt: null,
	demoDataEnabled: true,
	organizationId: "org_1",
	projectsEnabled: false,
	shiftsEnabled: false,
	surchargesEnabled: false,
	timezone: "UTC",
	worksCouncilEnabled: true,
});
```

- [ ] **Step 2: Write the failing store hydration test**

In `apps/webapp/src/stores/organization-settings-store.test.ts`, update the hydrate call and assertions:

```ts
useOrganizationSettings.getState().hydrate({
	organizationId: "org_1",
	shiftsEnabled: false,
	projectsEnabled: false,
	surchargesEnabled: false,
	demoDataEnabled: true,
	worksCouncilEnabled: true,
	timezone: "UTC",
	deletedAt: null,
});

expect(useOrganizationSettings.getState().worksCouncilEnabled).toBe(true);
expect(useOrganizationSettings.getState().timezone).toBe("UTC");
expect(useOrganizationSettings.getState().isHydrated).toBe(true);
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter webapp test src/app/api/auth/context/route.test.ts src/stores/organization-settings-store.test.ts`

Expected: FAIL because `worksCouncilEnabled` is not returned or stored yet.

- [ ] **Step 4: Add `worksCouncilEnabled` to `UserOrganization`**

In `apps/webapp/src/lib/auth-helpers.ts`, update the interface:

```ts
export interface UserOrganization {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	memberRole: string;
	hasEmployeeRecord: boolean;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
}
```

Update the return mapping:

```ts
worksCouncilEnabled: org.worksCouncilEnabled ?? false,
```

- [ ] **Step 5: Add API context hydration**

In `apps/webapp/src/app/api/auth/context/route.ts`, add `worksCouncilEnabled` to selected columns and response mapping:

```ts
columns: {
	id: true,
	shiftsEnabled: true,
	projectsEnabled: true,
	surchargesEnabled: true,
	demoDataEnabled: true,
	worksCouncilEnabled: true,
	timezone: true,
	deletedAt: true,
},
```

```ts
worksCouncilEnabled: org.worksCouncilEnabled ?? false,
```

- [ ] **Step 6: Add client organization settings type and store state**

In `apps/webapp/src/hooks/use-organization.ts`, update `OrganizationSettingsResponse`:

```ts
interface OrganizationSettingsResponse {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	timezone: string;
	deletedAt: string | null;
}
```

In `apps/webapp/src/stores/organization-settings-store.ts`, add the state field, default, and selector:

```ts
worksCouncilEnabled: boolean;
```

```ts
worksCouncilEnabled: false,
```

```ts
export const useWorksCouncilEnabled = () =>
	useOrganizationSettings((state) => state.worksCouncilEnabled);
```

- [ ] **Step 7: Run hydration tests to verify they pass**

Run: `pnpm --filter webapp test src/app/api/auth/context/route.test.ts src/stores/organization-settings-store.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit checkpoint if commits were explicitly requested**

Run only if the user asked for commits:

```bash
git add apps/webapp/src/lib/auth-helpers.ts apps/webapp/src/app/api/auth/context/route.ts apps/webapp/src/hooks/use-organization.ts apps/webapp/src/stores/organization-settings-store.ts apps/webapp/src/app/api/auth/context/route.test.ts apps/webapp/src/stores/organization-settings-store.test.ts
git commit -m "feat: hydrate works council feature state"
```

---

### Task 3: Add Organization Settings Toggle

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts:807-810`
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx:73-81`
- Modify: `apps/webapp/src/components/organization/organization-features-card.tsx:3-313`

- [ ] **Step 1: Update server action feature type**

In `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`, update the `feature` union:

```ts
feature:
	| "shiftsEnabled"
	| "projectsEnabled"
	| "surchargesEnabled"
	| "demoDataEnabled"
	| "worksCouncilEnabled",
```

- [ ] **Step 2: Pass the flag to the feature card**

In `apps/webapp/src/components/organization/organization-tab.tsx`, add the prop:

```tsx
<OrganizationFeaturesCard
	organizationId={organization.id}
	shiftsEnabled={organization.shiftsEnabled ?? false}
	projectsEnabled={organization.projectsEnabled ?? false}
	surchargesEnabled={organization.surchargesEnabled ?? false}
	demoDataEnabled={organization.demoDataEnabled ?? true}
	worksCouncilEnabled={organization.worksCouncilEnabled ?? false}
	currentMemberRole={currentMemberRole}
/>
```

- [ ] **Step 3: Add Works Council UI state and handler**

In `apps/webapp/src/components/organization/organization-features-card.tsx`, import `IconGavel`:

```ts
import {
	IconBriefcase,
	IconCalendarTime,
	IconDatabase,
	IconGavel,
	IconLoader2,
	IconPercentage,
} from "@tabler/icons-react";
```

Add the prop:

```ts
worksCouncilEnabled: boolean;
```

Destructure it and add state:

```ts
worksCouncilEnabled,
```

```ts
const [isWorksCouncilEnabled, setIsWorksCouncilEnabled] = useState(worksCouncilEnabled);
```

Add this handler after `handleToggleSurcharges`:

```ts
const handleToggleWorksCouncil = async (enabled: boolean) => {
	if (!canEdit) return;

	setIsWorksCouncilEnabled(enabled);
	setOrgSettings({ worksCouncilEnabled: enabled });

	const result = await toggleOrganizationFeature(organizationId, "worksCouncilEnabled", enabled);

	if (result.success) {
		toast.success(
			enabled
				? t("organization.features.works-council-enabled", "Works Council enabled")
				: t("organization.features.works-council-disabled", "Works Council disabled"),
		);
		startTransition(() => {
			router.refresh();
		});
	} else {
		setIsWorksCouncilEnabled(!enabled);
		setOrgSettings({ worksCouncilEnabled: !enabled });
		toast.error(
			result.error || t("organization.features.update-failed", "Failed to update feature"),
		);
	}
};
```

- [ ] **Step 4: Render the Works Council toggle row**

Insert this row after the Surcharges feature and before Demo Data:

```tsx
{/* Works Council Feature */}
<div className="flex items-center justify-between">
	<div className="flex items-start gap-3">
		<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
			<IconGavel className="size-5 text-primary" />
		</div>
		<div className="space-y-1">
			<Label
				htmlFor="works-council-toggle"
				className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
			>
				{t("organization.features.works-council", "Works Council")}
			</Label>
			<p className="text-sm text-muted-foreground">
				{t(
					"organization.features.works-council-description",
					"Enable the Works Council portal for authorized owners, admins, and assigned reviewers.",
				)}
			</p>
		</div>
	</div>
	<div className="flex items-center gap-2">
		{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
		<Switch
			id="works-council-toggle"
			checked={isWorksCouncilEnabled}
			onCheckedChange={handleToggleWorksCouncil}
			disabled={!canEdit || isPending}
			aria-label={t("organization.features.toggle-works-council", "Toggle Works Council")}
		/>
	</div>
</div>
```

- [ ] **Step 5: Run TypeScript or targeted tests**

Run: `pnpm --filter webapp test src/stores/organization-settings-store.test.ts`

Expected: PASS. Type errors, if any, should point to missing `worksCouncilEnabled` props in test fixtures or component callers.

- [ ] **Step 6: Commit checkpoint if commits were explicitly requested**

Run only if the user asked for commits:

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organization-features-card.tsx
git commit -m "feat: add works council organization toggle"
```

---

### Task 4: Gate Sidebar Visibility With Feature Flag and Permission

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.ts:11-17`
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx:23-42`
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx:75-85,153`
- Test: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Write failing sidebar tests for feature flag gating**

In `apps/webapp/src/components/app-sidebar.test.tsx`, add or update server sidebar tests so mocked organizations include `worksCouncilEnabled`.

Add a test like this, using the existing mock setup style in the file:

```tsx
it("passes works council feature state from the active organization", async () => {
	vi.stubEnv("BILLING_ENABLED", "false");
	canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
	getUserOrganizationsMock.mockResolvedValue([
		{
			id: "org_1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			worksCouncilEnabled: true,
		},
	]);
	getAuthContextMock.mockResolvedValue({
		user: { role: "user" },
		employee: { organizationId: "org_1", role: "admin" },
	});
	getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");

	vi.doMock("@/lib/auth-helpers", () => ({
		getUserOrganizations: getUserOrganizationsMock,
		getAuthContext: getAuthContextMock,
		getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
	}));
	vi.doMock("@/lib/organization/creation-policy.server", () => ({
		canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
	}));

	const { ServerAppSidebar } = await import("./server-app-sidebar");

	render(await ServerAppSidebar({ showWorksCouncilNav: true }));

	expect(screen.getByRole("link", { name: "Works Council" }).getAttribute("href")).toBe(
		"/works-council",
	);
	expect(appSearchSpy).toHaveBeenLastCalledWith(
		expect.objectContaining({
			staticCommands: expect.any(Array),
		}),
	);
});
```

Add a disabled-flag test:

```tsx
it("hides works council navigation when the organization feature flag is disabled", async () => {
	vi.stubEnv("BILLING_ENABLED", "false");
	canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
	getUserOrganizationsMock.mockResolvedValue([
		{
			id: "org_1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			worksCouncilEnabled: false,
		},
	]);
	getAuthContextMock.mockResolvedValue({
		user: { role: "user" },
		employee: { organizationId: "org_1", role: "admin" },
	});
	getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");

	vi.doMock("@/lib/auth-helpers", () => ({
		getUserOrganizations: getUserOrganizationsMock,
		getAuthContext: getAuthContextMock,
		getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
	}));
	vi.doMock("@/lib/organization/creation-policy.server", () => ({
		canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
	}));

	const { ServerAppSidebar } = await import("./server-app-sidebar");

	render(await ServerAppSidebar({ showWorksCouncilNav: true }));

	expect(screen.queryByRole("link", { name: "Works Council" })).toBeNull();
});
```

- [ ] **Step 2: Run sidebar tests to verify they fail**

Run: `pnpm --filter webapp test src/components/app-sidebar.test.tsx`

Expected: FAIL because `ServerAppSidebar` does not include or enforce `worksCouncilEnabled` yet.

- [ ] **Step 3: Add the feature flag type**

In `apps/webapp/src/components/settings/settings-config.ts`, update `FeatureFlag`:

```ts
export type FeatureFlag =
	| "shiftsEnabled"
	| "projectsEnabled"
	| "surchargesEnabled"
	| "demoDataEnabled"
	| "worksCouncilEnabled";
```

- [ ] **Step 4: Gate `ServerAppSidebar` with the active organization flag**

In `apps/webapp/src/components/server-app-sidebar.tsx`, update `featureFlags`:

```ts
const featureFlags = {
	shiftsEnabled: currentOrganization?.shiftsEnabled ?? false,
	projectsEnabled: currentOrganization?.projectsEnabled ?? false,
	surchargesEnabled: currentOrganization?.surchargesEnabled ?? false,
	demoDataEnabled: currentOrganization?.demoDataEnabled ?? true,
	worksCouncilEnabled: currentOrganization?.worksCouncilEnabled ?? false,
};
```

Update the prop passed to `AppSidebar`:

```tsx
showWorksCouncilNav={showWorksCouncilNav && (currentOrganization?.worksCouncilEnabled ?? false)}
```

- [ ] **Step 5: Gate layout permission calculation with org feature state**

In `apps/webapp/src/app/[locale]/(app)/layout.tsx`, import `organization` from auth schema with `member`:

```ts
import { member, organization } from "@/db/auth-schema";
```

Replace the Works Council visibility block with:

```ts
let showWorksCouncilNav = false;
if (activeOrganizationId) {
	const activeOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, activeOrganizationId),
		columns: { worksCouncilEnabled: true },
	});

	if (activeOrganization?.worksCouncilEnabled) {
		const ability = await requireAbility();
		showWorksCouncilNav = canViewWorksCouncilPortal(
			ability,
			activeOrganizationId,
			activeOrganizationId,
		);
	}
}
```

This keeps the org feature flag as the activation source of truth and leaves the existing CASL Works Council permission as the user access check. Confirm existing ability rules already grant org owners/admins `read` on `WorksCouncil`; if not, update `apps/webapp/src/lib/authorization/ability.ts` tests and rules in a focused follow-up within this task.

- [ ] **Step 6: Run sidebar tests to verify they pass**

Run: `pnpm --filter webapp test src/components/app-sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit checkpoint if commits were explicitly requested**

Run only if the user asked for commits:

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/app/[locale]/(app)/layout.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "feat: gate works council navigation by org feature"
```

---

### Task 5: Final Verification

**Files:**
- Verify all modified files from Tasks 1-4.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter webapp test src/db/__tests__/drizzle-migrations.test.ts src/app/api/auth/context/route.test.ts src/stores/organization-settings-store.test.ts src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader webapp tests if time permits**

Run: `pnpm --filter webapp test`

Expected: PASS. If unrelated failures occur, record them with file/test names and do not modify unrelated code.

- [ ] **Step 3: Run a production build only if environment variables are available**

Run: `CI=true pnpm build`

Expected: PASS. If the build requires unavailable Phase CLI environment variables, skip it and report the missing environment limitation.

- [ ] **Step 4: Inspect git diff**

Run: `git diff -- apps/webapp/src/lib/auth.ts apps/webapp/src/db/auth-schema.ts apps/webapp/drizzle/0032_works_council_feature_flag.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/drizzle/meta/0032_snapshot.json apps/webapp/src/lib/auth-helpers.ts apps/webapp/src/app/api/auth/context/route.ts apps/webapp/src/hooks/use-organization.ts apps/webapp/src/stores/organization-settings-store.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/app/[locale]/(app)/layout.tsx apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organization-features-card.tsx apps/webapp/src/db/__tests__/drizzle-migrations.test.ts apps/webapp/src/app/api/auth/context/route.test.ts apps/webapp/src/stores/organization-settings-store.test.ts apps/webapp/src/components/app-sidebar.test.tsx docs/superpowers/specs/2026-05-25-works-council-org-feature-flag-design.md docs/superpowers/plans/2026-05-25-works-council-org-feature-flag.md`

Expected: Diff only contains Works Council feature flag changes and the approved spec/plan docs.

- [ ] **Step 5: Commit final checkpoint if commits were explicitly requested**

Run only if the user asked for commits:

```bash
git add apps/webapp/src/lib/auth.ts apps/webapp/src/db/auth-schema.ts apps/webapp/drizzle/0032_works_council_feature_flag.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/drizzle/meta/0032_snapshot.json apps/webapp/src/lib/auth-helpers.ts apps/webapp/src/app/api/auth/context/route.ts apps/webapp/src/hooks/use-organization.ts apps/webapp/src/stores/organization-settings-store.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/app/[locale]/(app)/layout.tsx apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organization-features-card.tsx apps/webapp/src/db/__tests__/drizzle-migrations.test.ts apps/webapp/src/app/api/auth/context/route.test.ts apps/webapp/src/stores/organization-settings-store.test.ts apps/webapp/src/components/app-sidebar.test.tsx docs/superpowers/specs/2026-05-25-works-council-org-feature-flag-design.md docs/superpowers/plans/2026-05-25-works-council-org-feature-flag.md
git commit -m "feat: add works council org feature flag"
```

---

## Self-Review

- Spec coverage: The plan adds the org flag, settings toggle, hydration, sidebar gating, migration, and tests. It explicitly avoids using `works_council_settings.enabled` as an activation gate.
- Placeholder scan: No TBD/TODO placeholders are present. Each task includes concrete paths, code snippets, commands, and expected outcomes.
- Type consistency: The property name is consistently `worksCouncilEnabled` in TypeScript and `works_council_enabled` in SQL/Drizzle schema.
