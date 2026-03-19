# Settings Role Separation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore correct settings separation so owners and org admins see the full organization settings surface, members keep the reduced personal menu, and managers gain only the settings routes whose reads and writes are properly scoped to their active-organization responsibilities.

**Architecture:** Introduce a centralized settings access tier (`member`, `manager`, `orgAdmin`) derived from active-organization membership plus employee role, then drive the settings grid and sidebar from explicit tier-aware config instead of the current binary `adminOnly` flag. Roll manager access out route-by-route behind real authorization checks: a route only becomes manager-visible in the same change that scopes its loader and mutations, otherwise it stays hidden.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, Better Auth membership data, CASL auth helpers, Effect server actions, Vitest

---

## References To Read First

- `AGENTS.md`
- `docs/superpowers/specs/2026-03-18-settings-role-separation-design.md`
- `apps/webapp/src/lib/auth-helpers.ts`
- `apps/webapp/src/components/settings/settings-config.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`

## File Map

### Core access model

- Create: `apps/webapp/src/lib/settings-access.ts`
  - Shared settings tier types, ordering helpers, and entry/group visibility helpers.
- Create: `apps/webapp/src/lib/settings-access.test.ts`
  - Pure unit tests for tier ordering and visibility rules.
- Modify: `apps/webapp/src/lib/auth-helpers.ts`
  - Add server-side tier resolution from active-org membership + employee role.

### Settings overview and navigation

- Modify: `apps/webapp/src/components/settings/settings-config.ts`
  - Replace binary visibility with explicit tier-aware metadata.
- Modify: `apps/webapp/src/components/settings/settings-nav.tsx`
  - Consume settings tier instead of `isAdmin`.
- Modify: `apps/webapp/src/components/settings/settings-grid.tsx`
  - Consume tier-filtered groups and entries without recomputing role rules.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/page.tsx`
  - Resolve tier once and pass it into settings helpers.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`
  - Resolve tier once and pass it into sidebar nav.
- Create: `apps/webapp/src/components/settings/settings-config.test.ts`
  - Matrix tests for member / manager / orgAdmin / owner parity.
- Keep or fold into: `apps/webapp/src/components/settings/import-settings-config.test.ts`
  - Preserve import-entry regression coverage after config refactor.

### Shared route gating helpers

- Modify: `apps/webapp/src/lib/auth-helpers.ts`
  - Add shared helpers such as `getCurrentSettingsAccess()`, `requireOrgAdminSettingsAccess()`, and small predicates for manager-visible routes.

### Manager rollout: organization, team, employee, skill, vacation, work policy

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/rate-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/skills/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/assignment-actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts`

### Remaining manager-visible routes (only when scoped in the same task)

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/projects/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/projects/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/customers/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/customers/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/shifts/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/locations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/locations/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-categories/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-categories/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/surcharges/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/surcharges/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/calendar/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/calendar/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/statistics/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/statistics/actions.ts`

### Verification

- Create: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
  - Route-level access tests for owner parity, manager visibility, hidden-route denial, and manager-read mutation rejection.

## Delivery strategy

Do this in two layers:

1. Fix the owner regression and land tier-aware navigation safely.
2. Expose manager entries one route cluster at a time, only after the route and actions are scoped and covered.

If a route cluster is not ready, leave its entry hidden for managers in `settings-config.ts` until its task is complete.

## Task 1: Build the settings tier core

**Files:**
- Create: `apps/webapp/src/lib/settings-access.ts`
- Create: `apps/webapp/src/lib/settings-access.test.ts`
- Modify: `apps/webapp/src/lib/auth-helpers.ts`

- [ ] **Step 1: Write the failing tier-resolution tests**

```ts
import { describe, expect, it } from "vitest";
import { compareSettingsTiers, resolveSettingsTierFromContext } from "@/lib/settings-access";

describe("resolveSettingsTierFromContext", () => {
  it("treats owners as org admins", () => {
    expect(resolveSettingsTierFromContext({ memberRole: "owner", employeeRole: "employee" })).toBe("orgAdmin");
  });

  it("treats owner membership without an employee row as orgAdmin", () => {
    expect(resolveSettingsTierFromContext({ memberRole: "owner", employeeRole: null })).toBe("orgAdmin");
  });

  it("treats managers as manager tier", () => {
    expect(resolveSettingsTierFromContext({ memberRole: "member", employeeRole: "manager" })).toBe("manager");
  });

  it("falls back to member-safe tier without active org", () => {
    expect(resolveSettingsTierFromContext(null)).toBe("member");
  });

  it("recomputes from the active organization only", () => {
    expect(resolveSettingsTierFromContext({ memberRole: "member", employeeRole: "manager" })).toBe("manager");
    expect(resolveSettingsTierFromContext({ memberRole: "owner", employeeRole: null })).toBe("orgAdmin");
  });
});
```

- [ ] **Step 2: Run the new unit test to verify it fails**

Run: `pnpm test -- src/lib/settings-access.test.ts`
Expected: FAIL with missing module or missing exported helpers.

- [ ] **Step 3: Add the pure tier helpers**

```ts
export type SettingsAccessTier = "member" | "manager" | "orgAdmin";

const TIER_ORDER: Record<SettingsAccessTier, number> = {
  member: 0,
  manager: 1,
  orgAdmin: 2,
};

export function canAccessTier(current: SettingsAccessTier, required: SettingsAccessTier) {
  return TIER_ORDER[current] >= TIER_ORDER[required];
}
```

- [ ] **Step 4: Add the server-side resolver in `auth-helpers.ts`**

```ts
export async function getCurrentSettingsAccess(): Promise<SettingsAccessTier> {
  const principal = await getPrincipalContext();
  return resolveSettingsTierFromContext({
    memberRole: principal?.orgMembership?.role ?? null,
    employeeRole: principal?.employee?.role ?? null,
    activeOrganizationId: principal?.activeOrganizationId ?? null,
  });
}
```

- [ ] **Step 5: Re-run the focused tests**

Run: `pnpm test -- src/lib/settings-access.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the tier core**

```bash
git add apps/webapp/src/lib/settings-access.ts apps/webapp/src/lib/settings-access.test.ts apps/webapp/src/lib/auth-helpers.ts
git commit -m "fix(settings): add role-aware settings access tiers"
```

## Task 2: Convert the settings menu to explicit tier-based visibility

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/components/settings/settings-nav.tsx`
- Modify: `apps/webapp/src/components/settings/settings-grid.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`
- Create: `apps/webapp/src/components/settings/settings-config.test.ts`
- Modify: `apps/webapp/src/components/settings/import-settings-config.test.ts`

- [ ] **Step 1: Write the failing visibility matrix tests**

```ts
describe("getVisibleSettings", () => {
  it("shows only personal entries for members", () => {
    expect(getVisibleSettings("member", false).map((entry) => entry.id)).toEqual([
      "profile",
      "security",
      "notifications",
      "wellness",
    ]);
  });

  it("shows organizations for managers but not billing", () => {
    const ids = getVisibleSettings("manager", false).map((entry) => entry.id);
    expect(ids).toContain("organizations");
    expect(ids).not.toContain("billing");
  });

  it("keeps group visibility aligned to remaining visible entries", () => {
    const groups = getVisibleGroups("manager", getVisibleSettings("manager", false));
    expect(groups.map((group) => group.id)).toContain("organization");
  });

  it("applies billing and feature filtering after tier filtering", () => {
    const ids = getVisibleSettings("orgAdmin", false).map((entry) => entry.id);
    expect(ids).not.toContain("billing");
    expect(ids).not.toContain("avv");
  });

  it("produces the same visible entries for owner-resolved and admin-resolved orgAdmin contexts", () => {
    const ownerTier = resolveSettingsTierFromContext({ memberRole: "owner", employeeRole: null });
    const adminTier = resolveSettingsTierFromContext({ memberRole: "admin", employeeRole: "admin" });
    expect(getVisibleSettings(ownerTier, false)).toEqual(getVisibleSettings(adminTier, false));
  });

  it("recomputes tier and menu visibility when the same user switches active orgs", () => {
    const user = {
      userId: "user-1",
      memberships: {
        "org-owner": { memberRole: "owner", employeeRole: null },
        "org-manager": { memberRole: "member", employeeRole: "manager" },
      },
    };

    const ownerTier = resolveSettingsTierFromContext(user.memberships["org-owner"]);
    const managerTier = resolveSettingsTierFromContext(user.memberships["org-manager"]);

    expect(ownerTier).toBe("orgAdmin");
    expect(managerTier).toBe("manager");
    expect(getVisibleSettings(ownerTier, false).map((entry) => entry.id)).toContain("billing");
    expect(getVisibleSettings(managerTier, false).map((entry) => entry.id)).not.toContain("billing");
  });
});
```

- [ ] **Step 2: Run the config tests to verify they fail**

Run: `pnpm test -- src/components/settings/settings-config.test.ts src/components/settings/import-settings-config.test.ts`
Expected: FAIL because `getVisibleSettings` still expects a boolean and manager entries are not modeled.

- [ ] **Step 3: Refactor `settings-config.ts` to use explicit visibility**

```ts
export interface SettingsEntry {
  id: string;
  minimumTier: SettingsAccessTier;
  managerScope?: "hidden" | "read" | "manage";
  // existing fields stay here
}

export function getVisibleSettings(tier: SettingsAccessTier, billingEnabled = false) {
  return SETTINGS_ENTRIES.filter((entry) => {
    if (!canAccessTier(tier, entry.minimumTier)) return false;
    if (entry.requiresBilling && !billingEnabled) return false;
    return true;
  });
}
```

- [ ] **Step 4: Update overview page and sidebar to pass the new tier**

```ts
const settingsTier = await getCurrentSettingsAccess();
const visibleSettings = getVisibleSettings(settingsTier);
const visibleGroups = getVisibleGroups(settingsTier, visibleSettings);
```

- [ ] **Step 5: Re-run the focused settings tests**

Run: `pnpm test -- src/components/settings/settings-config.test.ts src/components/settings/import-settings-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the tier-aware settings menu**

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-nav.tsx apps/webapp/src/components/settings/settings-grid.tsx apps/webapp/src/app/[locale]/(app)/settings/page.tsx apps/webapp/src/app/[locale]/(app)/settings/layout.tsx apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/components/settings/import-settings-config.test.ts
git commit -m "fix(settings): separate member manager and org admin menus"
```

## Task 3: Sweep org-admin route guards so owners are no longer blocked

**Files:**
- Modify: `apps/webapp/src/lib/auth-helpers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/billing/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/avv/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/roles/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/locations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-categories/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/projects/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/shifts/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/surcharges/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/customers/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/domains/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/api-keys/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/audit-log/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/webhooks/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/calendar/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/statistics/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/export/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/audit-export/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/demo/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/import/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write the failing owner-parity route tests**

```ts
it("allows an owner into org-admin settings routes", async () => {
  const access = resolveSettingsTierFromContext({ memberRole: "owner", employeeRole: "employee" });
  expect(access).toBe("orgAdmin");
  expect(canAccessSettingsRoute(access, "orgAdmin")).toBe(true);
});

it("keeps owner and admin route access identical for every org-admin settings route", async () => {
  expect(getOrgAdminSettingsRoutesForTest()).toEqual([
    "/settings/organizations",
    "/settings/billing",
    "/settings/avv",
    "/settings/employees",
    "/settings/roles",
    "/settings/locations",
    "/settings/holidays",
    "/settings/vacation",
    "/settings/travel-expenses",
    "/settings/work-policies",
    "/settings/work-categories",
    "/settings/change-policies",
    "/settings/skills",
    "/settings/shifts",
    "/settings/coverage-rules",
    "/settings/surcharges",
    "/settings/customers",
    "/settings/projects",
    "/settings/enterprise/domains",
    "/settings/enterprise/email",
    "/settings/enterprise/api-keys",
    "/settings/enterprise/audit-log",
    "/settings/webhooks",
    "/settings/calendar",
    "/settings/statistics",
    "/settings/export",
    "/settings/payroll-export",
    "/settings/audit-export",
    "/settings/demo",
    "/settings/import",
  ]);
});

it.each(getOrgAdminSettingsRoutesForTest())("permits owner and admin through %s", async (route) => {
  const ownerTier = resolveSettingsTierFromContext({ memberRole: "owner", employeeRole: null });
  const adminTier = resolveSettingsTierFromContext({ memberRole: "admin", employeeRole: "admin" });

  await expect(canResolvedTierAccessRoute(ownerTier, route)).resolves.toBe(true);
  await expect(canResolvedTierAccessRoute(adminTier, route)).resolves.toBe(true);
});

it("keeps members out of org-admin routes", async () => {
  expect(canAccessSettingsRoute("member", "orgAdmin")).toBe(false);
});
```

- [ ] **Step 2: Run the route-access test to verify it fails**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: FAIL because the helper and route gating are still admin-only.

- [ ] **Step 3: Add a shared org-admin route helper and replace direct role checks**

```ts
export async function requireOrgAdminSettingsAccess() {
  const tier = await getCurrentSettingsAccess();
  if (tier !== "orgAdmin") redirect("/settings");
}
```

- [ ] **Step 4: Re-run the route-access test and a small settings smoke test**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the owner/admin parity sweep**

```bash
git add apps/webapp/src/lib/auth-helpers.ts apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx apps/webapp/src/app/[locale]/(app)/settings/billing/page.tsx apps/webapp/src/app/[locale]/(app)/settings/avv/page.tsx apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx apps/webapp/src/app/[locale]/(app)/settings/roles/page.tsx apps/webapp/src/app/[locale]/(app)/settings/locations/page.tsx apps/webapp/src/app/[locale]/(app)/settings/holidays/page.tsx apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx apps/webapp/src/app/[locale]/(app)/settings/travel-expenses/page.tsx apps/webapp/src/app/[locale]/(app)/settings/work-policies/page.tsx apps/webapp/src/app/[locale]/(app)/settings/work-categories/page.tsx apps/webapp/src/app/[locale]/(app)/settings/change-policies/page.tsx apps/webapp/src/app/[locale]/(app)/settings/projects/page.tsx apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx apps/webapp/src/app/[locale]/(app)/settings/shifts/page.tsx apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/page.tsx apps/webapp/src/app/[locale]/(app)/settings/surcharges/page.tsx apps/webapp/src/app/[locale]/(app)/settings/customers/page.tsx apps/webapp/src/app/[locale]/(app)/settings/enterprise/domains/page.tsx apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/page.tsx apps/webapp/src/app/[locale]/(app)/settings/enterprise/api-keys/page.tsx apps/webapp/src/app/[locale]/(app)/settings/enterprise/audit-log/page.tsx apps/webapp/src/app/[locale]/(app)/settings/webhooks/page.tsx apps/webapp/src/app/[locale]/(app)/settings/calendar/page.tsx apps/webapp/src/app/[locale]/(app)/settings/statistics/page.tsx apps/webapp/src/app/[locale]/(app)/settings/export/page.tsx apps/webapp/src/app/[locale]/(app)/settings/payroll-export/page.tsx apps/webapp/src/app/[locale]/(app)/settings/audit-export/page.tsx apps/webapp/src/app/[locale]/(app)/settings/demo/page.tsx apps/webapp/src/app/[locale]/(app)/settings/import/page.tsx apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "fix(settings): restore owner access across admin routes"
```

## Task 4: Ship the manager-safe organization and team surfaces

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/actions.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write the failing manager team-access tests**

```ts
it("shows Organization & Teams to managers with scoped team permissions", () => {
  const ids = getVisibleSettings("manager", false).map((entry) => entry.id);
  expect(ids).toContain("organizations");
});

it("does not let a manager mutate a team outside their permission scope", async () => {
  await expect(updateTeam("foreign-team", { name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("permission"),
  });
});
```

- [ ] **Step 2: Run the team-focused tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: FAIL because the page still hard-blocks non-admins or the scoped behavior is not wired through.

- [ ] **Step 3: Replace admin-only page capabilities with real team permissions**

```ts
const permissions = await permissionsService.getTeamPermissions(currentEmployee.id);

return {
  canCreateTeams: permissions.orgWide?.canCreateTeams ?? false,
  canManageTeamSettings: permissions.orgWide?.canManageTeamSettings ?? false,
  canManageTeamMembers: permissions.orgWide?.canManageTeamMembers ?? false,
};
```

- [ ] **Step 4: Re-run the focused organization/team tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: PASS for manager route visibility and out-of-scope denial.

- [ ] **Step 5: Commit the organization/team rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx apps/webapp/src/app/[locale]/(app)/settings/teams/page.tsx apps/webapp/src/app/[locale]/(app)/settings/teams/actions.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "feat(settings): allow scoped manager team access"
```

## Task 5: Ship the manager-safe employee and skill surfaces

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/rate-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/skills/actions.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write the failing managed-member tests**

```ts
it("lets managers open employee settings only for managed members", async () => {
  expect(await canManagerAccessEmployee("managed-employee")).toBe(true);
  expect(await canManagerAccessEmployee("foreign-employee")).toBe(false);
});

it("rejects manager mutation attempts for unmanaged employees", async () => {
  await expect(updateEmployeeRole("foreign-employee", { role: "employee" })).rejects.toMatchObject({
    message: expect.stringContaining("managed"),
  });
});
```

- [ ] **Step 2: Run the employee/skills tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: FAIL because `requireAdmin` still blocks managers or does not scope target employees.

- [ ] **Step 3: Replace `requireAdmin` with scoped access helpers**

```ts
export function requireManagedEmployeeAccess(currentEmployee, targetEmployee, mode: "read" | "manage") {
  if (currentEmployee.role === "admin") return Effect.void;
  if (currentEmployee.role === "manager" && isManagedEmployee(targetEmployee.id)) return Effect.void;
  return Effect.fail(new AuthorizationError({ ... }));
}
```

- [ ] **Step 4: Re-run the managed-member tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: PASS for allowed managed-member access and denied foreign-member mutations.

- [ ] **Step 5: Commit the employee/skills rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/employees/page.tsx apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-utils.ts apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts apps/webapp/src/app/[locale]/(app)/settings/employees/rate-mutations.actions.ts apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx apps/webapp/src/app/[locale]/(app)/settings/skills/actions.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "feat(settings): scope manager employee and skill access"
```

## Task 6: Ship the manager-safe vacation and work-policy surfaces

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/assignment-actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write the failing manager assignment/read tests**

```ts
it("lets managers view policy definitions but not edit them", async () => {
  expect(await getWorkPolicies("org-1")).toSucceed();
  await expect(createWorkPolicy({ organizationId: "org-1", name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});

it("lets managers assign vacation policies only for managed members", async () => {
  expect(await assignVacationPolicyToEmployee("managed-employee", "policy-1")).toSucceed();
});
```

- [ ] **Step 2: Run the focused vacation/work-policy tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: FAIL because the route pages still block managers or the actions are admin-only.

- [ ] **Step 3: Separate manager-read and manager-manage branches in actions**

```ts
if (tier === "orgAdmin") {
  // full policy CRUD
} else if (tier === "manager") {
  // read definitions, allow assignments only inside managed scope
} else {
  throw new AuthorizationError(...);
}
```

- [ ] **Step 4: Re-run the focused policy tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: PASS for manager reads and managed-member assignments, FAIL turned PASS for forbidden policy-definition edits.

- [ ] **Step 5: Commit the vacation/work-policy rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts apps/webapp/src/app/[locale]/(app)/settings/vacation/assignment-actions.ts apps/webapp/src/app/[locale]/(app)/settings/work-policies/page.tsx apps/webapp/src/app/[locale]/(app)/settings/work-policies/actions.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "feat(settings): add scoped manager vacation and policy access"
```

## Task 7: Ship manager-scoped projects and customers

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/projects/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/projects/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/customers/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/customers/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing managed-project tests**

```ts
it("keeps Projects hidden from managers until project scoping is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("projects");
});

it("rejects manager writes to projects outside managed-project scope", async () => {
  await expect(updateProject("foreign-project", { name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("project"),
  });
});

it("rejects unscoped customer creation for managers", async () => {
  await expect(createCustomer({ name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("managed project"),
  });
});
```

- [ ] **Step 2: Run the project/customer tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL because the routes are still admin-only or lack managed-project scoping.

- [ ] **Step 3: Scope project and customer routes, then expose their menu entries**

```ts
if (tier === "manager") {
  return queryManagedProjects(currentEmployee.id);
}

// customer create/update must require a managed project link at write time
```

- [ ] **Step 4: Re-run the focused tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS, with managers limited to managed projects and managed-project customers.

- [ ] **Step 5: Commit the project/customer rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/projects/page.tsx apps/webapp/src/app/[locale]/(app)/settings/projects/actions.ts apps/webapp/src/app/[locale]/(app)/settings/customers/page.tsx apps/webapp/src/app/[locale]/(app)/settings/customers/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): scope manager project and customer access"
```

## Task 8: Ship manager-scoped shift templates and coverage targets

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/shifts/page.tsx`
- Modify: `apps/webapp/src/components/settings/shift-template-management.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/actions.ts`
- Modify: `apps/webapp/src/components/settings/coverage-rules-management.tsx`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing own-team and own-area tests**

```ts
it("keeps Shift Templates hidden from managers until own-team scoping is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("shift-templates");
});

it("rejects manager coverage edits outside own areas", async () => {
  await expect(updateCoverageRule("foreign-area", { minimumStaff: 3 })).rejects.toMatchObject({
    message: expect.stringContaining("coverage"),
  });
});
```

- [ ] **Step 2: Run the shift/coverage tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL because the pages are still org-admin only or not scoped.

- [ ] **Step 3: Implement own-team and own-area scoping, then expose the entries**

```ts
if (tier === "manager") {
  return queryShiftTemplatesForManagedTeams(currentEmployee.id);
}

if (tier === "manager") {
  return updateCoverageInOwnAreas(currentEmployee.id, input);
}
```

- [ ] **Step 4: Re-run the focused tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS, with manager access limited to own teams and own areas.

- [ ] **Step 5: Commit the shift/coverage rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/shifts/page.tsx apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/page.tsx apps/webapp/src/app/[locale]/(app)/settings/coverage-rules/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): scope manager shift and coverage access"
```

## Task 9: Ship manager read-only Locations

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/locations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/locations/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing Locations read-only tests**

```ts
it("keeps Locations hidden from managers until read-only scoping is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("locations");
});

it("removes edit affordances from Locations for managers", async () => {
  expect(await renderLocationsPageForManager()).not.toContain("Save");
});

it("rejects direct manager location mutations", async () => {
  await expect(updateLocation("location-1", { name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});
```

- [ ] **Step 2: Run the Locations tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL because the route is still hidden or still mutable for managers.

- [ ] **Step 3: Scope Locations to manager-read, then expose it**

```ts
// loader: only return locations/subareas tied to own teams or own areas
const locations = tier === "manager"
  ? await getLocationsForManagerAreas(currentEmployee.id)
  : await getAllOrganizationLocations(organizationId);

// page/ui: do not render create, edit, or delete affordances for managers
const canEdit = tier === "orgAdmin";

// actions: managers always hit a server-side authorization failure on mutations
if (tier === "manager") throw new AuthorizationError({ message: "Read-only route" });
```

- [ ] **Step 4: Re-run the Locations tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Locations rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/locations/page.tsx apps/webapp/src/app/[locale]/(app)/settings/locations/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): add manager read-only location access"
```

## Task 10: Ship manager read-only Holidays

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing Holidays read-only tests**

```ts
it("keeps Holidays hidden from managers until scoped read access is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("holidays");
});

it("rejects manager holiday mutations while allowing scoped reads", async () => {
  await expect(createHoliday({ organizationId: "org-1", name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});
```

- [ ] **Step 2: Run the Holidays tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Scope Holidays to manager-read, then expose it**

```ts
// loader: only return holiday calendars applied to own teams or managed members
// page/ui: hide create/edit/import controls for managers
// actions: create/update/delete holiday branches reject manager callers with AuthorizationError
```

- [ ] **Step 4: Re-run the Holidays tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Holidays rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/holidays/page.tsx apps/webapp/src/app/[locale]/(app)/settings/holidays/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): add manager read-only holiday access"
```

## Task 11: Ship manager read-only Change Policies

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing Change Policies read-only tests**

```ts
it("keeps Change Policies hidden from managers until read-only scoping is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("change-policies");
});

it("rejects manager change-policy mutations", async () => {
  await expect(updateChangePolicy("policy-1", { name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});
```

- [ ] **Step 2: Run the Change Policies tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Scope Change Policies to manager-read, then expose it**

```ts
// loader: only return change-policy rules applied to own teams or managed members
// page/ui: hide policy editors and save buttons for managers
// actions: manager calls to create/update/delete policies return AuthorizationError
```

- [ ] **Step 4: Re-run the Change Policies tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Change Policies rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/change-policies/page.tsx apps/webapp/src/app/[locale]/(app)/settings/change-policies/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): add manager read-only change policy access"
```

## Task 12: Ship manager read-only Work Categories

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-categories/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-categories/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing Work Categories read-only tests**

```ts
it("keeps Work Categories hidden from managers until read-only scoping is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("work-categories");
});

it("rejects manager work-category mutations", async () => {
  await expect(createWorkCategory({ name: "X" })).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});
```

- [ ] **Step 2: Run the Work Categories tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Scope Work Categories to manager-read, then expose it**

```ts
// loader: only return category definitions used by own teams, own areas, or managed projects
// page/ui: remove category editor affordances for managers
// actions: manager create/update/delete branches reject with AuthorizationError
```

- [ ] **Step 4: Re-run the Work Categories tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Work Categories rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/work-categories/page.tsx apps/webapp/src/app/[locale]/(app)/settings/work-categories/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): add manager read-only work category access"
```

## Task 13: Ship manager read-only Surcharges

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/surcharges/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/surcharges/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing Surcharges read-only tests**

```ts
it("keeps Surcharges hidden from managers until read-only scoping is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("surcharges");
});

it("rejects manager surcharge mutations", async () => {
  await expect(createSurcharge({ name: "Night" })).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});
```

- [ ] **Step 2: Run the Surcharges tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Scope Surcharges to manager-read, then expose it**

```ts
// loader: only return surcharge definitions applied to own teams, own areas, or managed projects
// page/ui: hide create/edit/delete surcharge actions for managers
// actions: manager mutations reject with AuthorizationError
```

- [ ] **Step 4: Re-run the Surcharges tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Surcharges rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/surcharges/page.tsx apps/webapp/src/app/[locale]/(app)/settings/surcharges/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): add manager read-only surcharge access"
```

## Task 14: Ship manager read-only Calendar Sync

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/calendar/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/calendar/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing Calendar Sync read-only tests**

```ts
it("keeps Calendar Sync hidden from managers until read-only scoping is implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("calendar");
});

it("rejects manager calendar mutations", async () => {
  await expect(updateCalendarConfig({ provider: "ics" })).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});
```

- [ ] **Step 2: Run the Calendar Sync tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Scope Calendar Sync to manager-read, then expose it**

```ts
// loader: only return calendar integrations tied to own teams, own areas, or managed projects
// page/ui: render integration details without edit controls for managers
// actions: manager update/remove/sync-setting mutations reject with AuthorizationError
```

- [ ] **Step 4: Re-run the Calendar Sync tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Calendar Sync rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/calendar/page.tsx apps/webapp/src/app/[locale]/(app)/settings/calendar/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): add manager read-only calendar access"
```

## Task 15: Ship manager read-only Statistics

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/statistics/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/statistics/actions.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Extend: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Extend: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing Statistics read-only tests**

```ts
it("keeps Statistics hidden from managers until team-scoped analytics are implemented", () => {
  expect(getVisibleSettings("manager", false).map((entry) => entry.id)).not.toContain("statistics");
});

it("rejects org-wide statistics reads for managers", async () => {
  await expect(getInstanceStats()).rejects.toMatchObject({
    message: expect.stringContaining("Insufficient permissions"),
  });
});
```

- [ ] **Step 2: Run the Statistics tests to verify they fail**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Scope Statistics to manager-read with team-scoped analytics, then expose it**

```ts
// loader: managers call a team-scoped stats query instead of org-wide instance stats
const stats = tier === "manager"
  ? await getManagedTeamStatistics(currentEmployee.id)
  : await getInstanceStats();

// page/ui: remove org-wide/system-health cards managers should not see
// actions: any org-wide statistics mutation/export path rejects manager callers
```

- [ ] **Step 4: Re-run the Statistics tests**

Run: `pnpm test -- src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/settings/settings-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Statistics rollout**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/statistics/page.tsx apps/webapp/src/app/[locale]/(app)/settings/statistics/actions.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/components/settings/settings-config.test.ts
git commit -m "feat(settings): add manager read-only statistics access"
```

## Task 16: Run final verification before handoff

**Files:**
- No new code files unless verification exposes gaps

- [ ] **Step 1: Run the focused settings and route-access suite**

Run: `pnpm test -- src/lib/settings-access.test.ts src/components/settings/settings-config.test.ts src/components/settings/import-settings-config.test.ts src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
Expected: PASS.

- [ ] **Step 2: Run the full webapp test suite**

Run: `pnpm test`
Expected: PASS for the full `webapp` package.

- [ ] **Step 3: Run the webapp production build**

Run: `pnpm build`
Expected: successful Next.js production build.

- [ ] **Step 4: Review the final diff for accidental overexposure**

Run: `git diff --stat` and `git diff`
Expected: only settings access, tests, and route-scoping changes.

- [ ] **Step 5: Create the final implementation commit**

```bash
git add apps/webapp/src/lib/settings-access.ts apps/webapp/src/lib/settings-access.test.ts apps/webapp/src/lib/auth-helpers.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/components/settings/import-settings-config.test.ts apps/webapp/src/components/settings/settings-nav.tsx apps/webapp/src/components/settings/settings-grid.tsx apps/webapp/src/app/[locale]/(app)/settings
git commit -m "fix(settings): restore role-based settings access"
```

## Notes for the implementing agent

- Keep every decision active-organization scoped. Never infer access from another org membership.
- Do not expose a manager menu item until the matching route and mutation layer are already safe.
- Prefer shared helpers over repeated `employee.role !== "admin"` checks.
- Preserve existing feature-flag and billing filters while changing role visibility.
- When a route is manager-read only, hide edit controls and reject mutations server-side.
- Reuse existing manager/team permission primitives where they already exist before inventing new ones.
