# App Search Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global sidebar-launched command palette that searches authorized pages, settings, users/employees, and teams.

**Architecture:** Use a hybrid search model. Static page and settings destinations are built locally from existing sidebar/settings visibility rules, while employee and team records come from a server action that applies active-organization and role/capability scoping before returning display-safe results.

**Tech Stack:** Next.js App Router, React 19, TypeScript, `cmdk`, existing shadcn-style command/sidebar components, Tolgee translations, Drizzle ORM, Vitest, Testing Library, `@tanstack/react-hotkeys`.

---

## File Structure

- Create `apps/webapp/src/lib/app-search/types.ts`: shared result and input types.
- Create `apps/webapp/src/lib/app-search/static-results.ts`: pure static destination builder that mirrors sidebar and settings visibility.
- Create `apps/webapp/src/lib/app-search/static-results.test.ts`: unit tests for role, settings tier, billing, and feature-flag visibility.
- Create `apps/webapp/src/lib/app-search/live-results.ts`: pure live-record query helpers for employees and teams.
- Create `apps/webapp/src/lib/app-search/live-results.test.ts`: unit tests for query guards and scoped result mapping.
- Create `apps/webapp/src/app/[locale]/(app)/search/actions.ts`: server action wrapper that resolves current user context and calls live search helpers.
- Create `apps/webapp/src/components/app-search.tsx`: client command dialog and keyboard shortcut implementation.
- Create `apps/webapp/src/components/app-search.test.tsx`: component tests for opening, shortcut wiring, rendering, error state, and navigation.
- Modify `apps/webapp/src/components/app-sidebar.tsx`: add search button and mount `AppSearch`.
- Modify `apps/webapp/src/components/server-app-sidebar.tsx`: pass settings tier, billing flag, and organization feature flags needed by static search.
- Modify `apps/webapp/src/components/app-sidebar.test.tsx`: cover search button rendering and server prop forwarding.
- Modify `apps/webapp/package.json` and `pnpm-lock.yaml`: add `@tanstack/react-hotkeys`.

---

### Task 1: Add Dependency And Static Search Results

**Files:**
- Modify: `apps/webapp/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/webapp/src/lib/app-search/types.ts`
- Create: `apps/webapp/src/lib/app-search/static-results.ts`
- Create: `apps/webapp/src/lib/app-search/static-results.test.ts`

- [ ] **Step 1: Add `@tanstack/react-hotkeys`**

Run:

```bash
pnpm --filter webapp add @tanstack/react-hotkeys
```

Expected: `apps/webapp/package.json` includes `@tanstack/react-hotkeys` in `dependencies`, and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Write failing static result tests**

Create `apps/webapp/src/lib/app-search/static-results.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStaticAppSearchResults } from "./static-results";

const t = (_key: string, defaultValue: string) => defaultValue;

const enabledFeatures = {
	shiftsEnabled: true,
	projectsEnabled: true,
	surchargesEnabled: true,
	demoDataEnabled: true,
};

describe("buildStaticAppSearchResults", () => {
	it("shows personal pages and member settings for employees", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "employee",
			settingsAccessTier: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(results.map((result) => result.href)).toEqual(
			expect.arrayContaining(["/", "/time-tracking", "/settings/profile", "/settings/security"]),
		);
		expect(results.some((result) => result.href === "/settings/employees")).toBe(false);
		expect(results.some((result) => result.href === "/settings/organizations")).toBe(false);
		expect(results.some((result) => result.href === "/team")).toBe(false);
		const settingsResult = results.find((result) => result.href === "/settings/profile");
		expect(settingsResult).toMatchObject({ type: "setting", title: "Profile" });
	});

	it("shows manager navigation and manager settings without org-admin settings", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "manager",
			settingsAccessTier: "manager",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(results.some((result) => result.href === "/team")).toBe(true);
		expect(results.some((result) => result.href === "/approvals/inbox")).toBe(true);
		expect(results.some((result) => result.href === "/settings/employees")).toBe(true);
		expect(results.some((result) => result.href === "/settings/teams")).toBe(true);
		expect(results.some((result) => result.href === "/settings/billing")).toBe(false);
		expect(results.some((result) => result.href === "/compliance")).toBe(false);
	});

	it("shows org-admin-only destinations when allowed", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		expect(results.some((result) => result.href === "/compliance")).toBe(true);
		expect(results.some((result) => result.href === "/settings/organizations")).toBe(true);
		expect(results.some((result) => result.href === "/settings/billing")).toBe(true);
		expect(results.some((result) => result.href === "/settings/roles")).toBe(true);
	});

	it("honors billing and feature flags", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "manager",
			settingsAccessTier: "manager",
			billingEnabled: false,
			showComplianceNav: false,
			featureFlags: {
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: false,
			},
		});

		expect(results.some((result) => result.href === "/scheduling")).toBe(false);
		expect(results.some((result) => result.href === "/settings/shifts")).toBe(false);
		expect(results.some((result) => result.href === "/settings/projects")).toBe(false);
		expect(results.some((result) => result.href === "/settings/surcharges")).toBe(false);
		expect(results.some((result) => result.href === "/settings/billing")).toBe(false);
	});

	it("deduplicates destinations by type and href", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		const keys = results.map((result) => `${result.type}:${result.href}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
```

- [ ] **Step 3: Run static result tests to verify failure**

Run:

```bash
pnpm --filter webapp test -- src/lib/app-search/static-results.test.ts
```

Expected: FAIL because `./static-results` does not exist.

- [ ] **Step 4: Create shared app search types**

Create `apps/webapp/src/lib/app-search/types.ts`:

```ts
import type { FeatureFlagState } from "@/components/settings/settings-config";
import type { SettingsAccessTier } from "@/lib/settings-access";

export type AppSearchResultType = "page" | "setting" | "employee" | "team";

export interface AppSearchResult {
	type: AppSearchResultType;
	id: string;
	title: string;
	subtitle?: string;
	href: string;
}

export type AppSearchTranslate = (key: string, defaultValue: string) => string;

export type AppSearchEmployeeRole = "admin" | "manager" | "employee" | null;

export interface StaticAppSearchInput {
	t: AppSearchTranslate;
	employeeRole: AppSearchEmployeeRole;
	settingsAccessTier: SettingsAccessTier;
	billingEnabled: boolean;
	showComplianceNav: boolean;
	featureFlags?: FeatureFlagState;
}

export interface LiveAppSearchResults {
	employees: AppSearchResult[];
	teams: AppSearchResult[];
}
```

- [ ] **Step 5: Implement static search result builder**

Create `apps/webapp/src/lib/app-search/static-results.ts`:

```ts
import {
	getResolvedSettingsVisibility,
	type FeatureFlagState,
} from "@/components/settings/settings-config";
import type { AppSearchResult, StaticAppSearchInput } from "./types";

function isManagerOrAbove(role: StaticAppSearchInput["employeeRole"]): boolean {
	return role === "admin" || role === "manager";
}

function hasFeature(featureFlags: FeatureFlagState | undefined, key: keyof FeatureFlagState): boolean {
	return featureFlags?.[key] ?? false;
}

function uniqueResults(results: AppSearchResult[]): AppSearchResult[] {
	const seen = new Set<string>();
	return results.filter((result) => {
		const key = `${result.type}:${result.href}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function buildStaticAppSearchResults(input: StaticAppSearchInput): AppSearchResult[] {
	const { t } = input;
	const pageResults: AppSearchResult[] = [
		{
			type: "page",
			id: "dashboard",
			title: t("nav.dashboard", "Dashboard"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/",
		},
		{
			type: "page",
			id: "time-tracking",
			title: t("nav.time-tracking", "Time Tracking"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/time-tracking",
		},
		{
			type: "page",
			id: "my-requests",
			title: t("nav.my-requests", "My Requests"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/my-requests",
		},
		{
			type: "page",
			id: "calendar",
			title: t("nav.calendar", "Calendar"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/calendar",
		},
		{
			type: "page",
			id: "organization",
			title: t("nav.org-explorer", "Org Explorer"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/organization",
		},
		{
			type: "page",
			id: "absences",
			title: t("nav.absences", "Absences"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/absences",
		},
		{
			type: "page",
			id: "travel-expenses",
			title: t("nav.travel-expenses", "Travel Expenses"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/travel-expenses",
		},
		{
			type: "page",
			id: "reports",
			title: t("nav.reports", "Reports"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/reports",
		},
	];

	if (isManagerOrAbove(input.employeeRole)) {
		pageResults.push(
			{
				type: "page",
				id: "team",
				title: t("nav.team", "Team"),
				subtitle: t("appSearch.group.pages", "Pages"),
				href: "/team",
			},
			{
				type: "page",
				id: "approvals",
				title: t("nav.approvals", "Approvals"),
				subtitle: t("appSearch.group.pages", "Pages"),
				href: "/approvals/inbox",
			},
		);

		if (hasFeature(input.featureFlags, "shiftsEnabled")) {
			pageResults.push({
				type: "page",
				id: "scheduling",
				title: t("nav.scheduling", "Scheduling"),
				subtitle: t("appSearch.group.pages", "Pages"),
				href: "/scheduling",
			});
		}
	}

	if (input.showComplianceNav) {
		pageResults.push({
			type: "page",
			id: "compliance",
			title: t("nav.compliance", "Compliance"),
			subtitle: t("appSearch.group.pages", "Pages"),
			href: "/compliance",
		});
	}

	pageResults.push({
		type: "page",
		id: "settings",
		title: t("nav.settings", "Settings"),
		subtitle: t("appSearch.group.pages", "Pages"),
		href: "/settings",
	});

	const { visibleSettings } = getResolvedSettingsVisibility({
		accessTier: input.settingsAccessTier,
		billingEnabled: input.billingEnabled,
		featureFlags: input.featureFlags,
	});

	const settingResults = visibleSettings.map<AppSearchResult>((entry) => ({
		type: "setting",
		id: `setting-${entry.id}`,
		title: t(entry.titleKey, entry.titleDefault),
		subtitle: t(entry.descriptionKey, entry.descriptionDefault),
		href: entry.href,
	}));

	return uniqueResults([...pageResults, ...settingResults]);
}
```

- [ ] **Step 6: Run static result tests to verify pass**

Run:

```bash
pnpm --filter webapp test -- src/lib/app-search/static-results.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit static search foundation**

Run:

```bash
git add apps/webapp/package.json pnpm-lock.yaml apps/webapp/src/lib/app-search/types.ts apps/webapp/src/lib/app-search/static-results.ts apps/webapp/src/lib/app-search/static-results.test.ts
git commit -m "feat: add authorized app search destinations"
```

Expected: commit succeeds.

---

### Task 2: Add Server-Scoped Live Record Search

**Files:**
- Create: `apps/webapp/src/lib/app-search/live-results.ts`
- Create: `apps/webapp/src/lib/app-search/live-results.test.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/search/actions.ts`

- [ ] **Step 1: Write failing live search helper tests**

Create `apps/webapp/src/lib/app-search/live-results.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildEmployeeSearchConditions, getSearchableTeamIds, mapEmployeeSearchRow, mapTeamSearchRow, normalizeAppSearchQuery } from "./live-results";

vi.mock("@/db", () => ({
	db: {},
}));

describe("live app search helpers", () => {
	it("normalizes short and whitespace queries to null", () => {
		expect(normalizeAppSearchQuery(" ")).toBeNull();
		expect(normalizeAppSearchQuery("a")).toBeNull();
		expect(normalizeAppSearchQuery(" alice ")).toBe("alice");
	});

	it("maps employee rows to safe search results", () => {
		expect(
			mapEmployeeSearchRow({
				employeeId: "emp_1",
				firstName: "Ada",
				lastName: "Lovelace",
				name: null,
				email: "ada@example.com",
				position: "Engineer",
				teamName: "Research",
			}),
		).toEqual({
			type: "employee",
			id: "employee-emp_1",
			title: "Ada Lovelace",
			subtitle: "Engineer · Research",
			href: "/settings/employees/emp_1",
		});
	});

	it("maps team rows to safe search results", () => {
		expect(mapTeamSearchRow({ teamId: "team_1", name: "Operations", description: "Ops team" })).toEqual({
			type: "team",
			id: "team-team_1",
			title: "Operations",
			subtitle: "Ops team",
			href: "/settings/teams/team_1",
		});
	});

	it("returns all team ids for org admins and scoped team ids for managers", () => {
		expect(
			getSearchableTeamIds({
				accessTier: "orgAdmin",
				teams: ["team_1", "team_2"],
				permissionsByTeamId: new Map(),
			}),
		).toEqual(["team_1", "team_2"]);

		expect(
			getSearchableTeamIds({
				accessTier: "manager",
				teams: ["team_1", "team_2", "team_3"],
				permissionsByTeamId: new Map([
					["team_1", { canCreateTeams: false, canManageTeamMembers: true, canManageTeamSettings: false, canApproveTeamRequests: false }],
					["team_2", { canCreateTeams: false, canManageTeamMembers: false, canManageTeamSettings: false, canApproveTeamRequests: true }],
					["team_3", { canCreateTeams: false, canManageTeamMembers: false, canManageTeamSettings: true, canApproveTeamRequests: false }],
				]),
			}),
		).toEqual(["team_1", "team_3"]);

		expect(
			getSearchableTeamIds({
				accessTier: "member",
				teams: ["team_1"],
				permissionsByTeamId: new Map(),
			}),
		).toEqual([]);
	});

	it("describes employee scope by settings access tier", () => {
		expect(buildEmployeeSearchConditions({ accessTier: "member", organizationId: "org_1", currentEmployeeId: "emp_1" })).toEqual({ canSearchEmployees: false });
		expect(buildEmployeeSearchConditions({ accessTier: "orgAdmin", organizationId: "org_1", currentEmployeeId: null })).toEqual({ canSearchEmployees: true, managerId: null });
		expect(buildEmployeeSearchConditions({ accessTier: "manager", organizationId: "org_1", currentEmployeeId: "mgr_1" })).toEqual({ canSearchEmployees: true, managerId: "mgr_1" });
		expect(buildEmployeeSearchConditions({ accessTier: "manager", organizationId: "org_1", currentEmployeeId: null })).toEqual({ canSearchEmployees: false });
	});
});
```

- [ ] **Step 2: Run live helper tests to verify failure**

Run:

```bash
pnpm --filter webapp test -- src/lib/app-search/live-results.test.ts
```

Expected: FAIL because `./live-results` does not exist.

- [ ] **Step 3: Implement live search helpers**

Create `apps/webapp/src/lib/app-search/live-results.ts`:

```ts
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { db } from "@/db";
import { employee, employeeManagers, team } from "@/db/schema";
import type { PermissionFlags } from "@/lib/effect/services/permissions.service";
import type { SettingsAccessTier } from "@/lib/settings-access";
import type { AppSearchResult, LiveAppSearchResults } from "./types";

const LIVE_SEARCH_LIMIT = 6;

export interface EmployeeSearchRow {
	employeeId: string;
	firstName: string | null;
	lastName: string | null;
	name: string | null;
	email: string;
	position: string | null;
	teamName: string | null;
}

export interface TeamSearchRow {
	teamId: string;
	name: string;
	description: string | null;
}

export function normalizeAppSearchQuery(query: string): string | null {
	const normalized = query.trim();
	return normalized.length >= 2 ? normalized : null;
}

function compactParts(parts: Array<string | null | undefined>): string | undefined {
	const compacted = parts.filter((part): part is string => Boolean(part?.trim()));
	return compacted.length > 0 ? compacted.join(" · ") : undefined;
}

export function mapEmployeeSearchRow(row: EmployeeSearchRow): AppSearchResult {
	const fullName = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
	const title = fullName || row.name || row.email;

	return {
		type: "employee",
		id: `employee-${row.employeeId}`,
		title,
		subtitle: compactParts([row.position, row.teamName, row.email]),
		href: `/settings/employees/${row.employeeId}`,
	};
}

export function mapTeamSearchRow(row: TeamSearchRow): AppSearchResult {
	return {
		type: "team",
		id: `team-${row.teamId}`,
		title: row.name,
		subtitle: row.description ?? undefined,
		href: `/settings/teams/${row.teamId}`,
	};
}

export function buildEmployeeSearchConditions(input: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	currentEmployeeId: string | null;
}): { canSearchEmployees: false } | { canSearchEmployees: true; managerId: string | null } {
	if (input.accessTier === "member") {
		return { canSearchEmployees: false };
	}

	if (input.accessTier === "orgAdmin") {
		return { canSearchEmployees: true, managerId: null };
	}

	if (!input.currentEmployeeId) {
		return { canSearchEmployees: false };
	}

	return { canSearchEmployees: true, managerId: input.currentEmployeeId };
}

export function getSearchableTeamIds(input: {
	accessTier: SettingsAccessTier;
	teams: string[];
	permissionsByTeamId: Map<string, PermissionFlags>;
}): string[] {
	if (input.accessTier === "orgAdmin") {
		return input.teams;
	}

	if (input.accessTier !== "manager") {
		return [];
	}

	return input.teams.filter((teamId) => {
		const permissions = input.permissionsByTeamId.get(teamId);
		return Boolean(permissions?.canManageTeamMembers || permissions?.canManageTeamSettings);
	});
}

export async function searchLiveAppResults(input: {
	organizationId: string | null;
	query: string;
	accessTier: SettingsAccessTier;
	currentEmployeeId: string | null;
	permissionsByTeamId: Map<string, PermissionFlags>;
}): Promise<LiveAppSearchResults> {
	const normalizedQuery = normalizeAppSearchQuery(input.query);
	if (!input.organizationId || !normalizedQuery) {
		return { employees: [], teams: [] };
	}

	const pattern = `%${normalizedQuery}%`;
	const employeeScope = buildEmployeeSearchConditions({
		accessTier: input.accessTier,
		organizationId: input.organizationId,
		currentEmployeeId: input.currentEmployeeId,
	});

	const allTeams = await db.query.team.findMany({
		columns: { id: true },
		where: eq(team.organizationId, input.organizationId),
	});
	const searchableTeamIds = getSearchableTeamIds({
		accessTier: input.accessTier,
		teams: allTeams.map((currentTeam) => currentTeam.id),
		permissionsByTeamId: input.permissionsByTeamId,
	});

	const [employeeRows, teamRows] = await Promise.all([
		employeeScope.canSearchEmployees
			? db
					.select({
						employeeId: employee.id,
						firstName: user.firstName,
						lastName: user.lastName,
						name: user.name,
						email: user.email,
						position: employee.position,
						teamName: team.name,
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.where(
						and(
							eq(employee.organizationId, input.organizationId),
							eq(employee.isActive, true),
							employeeScope.managerId
								? sql<boolean>`exists (
									select 1 from ${employeeManagers}
									where ${employeeManagers.employeeId} = ${employee.id}
									and ${employeeManagers.managerId} = ${employeeScope.managerId}
								)`
								: undefined,
							or(
								ilike(user.firstName, pattern),
								ilike(user.lastName, pattern),
								ilike(user.name, pattern),
								ilike(user.email, pattern),
								ilike(employee.position, pattern),
							),
						),
					)
					.orderBy(asc(user.name), asc(user.email), asc(employee.id))
					.limit(LIVE_SEARCH_LIMIT)
			: [],
		searchableTeamIds.length > 0
			? db
					.select({
						teamId: team.id,
						name: team.name,
						description: team.description,
					})
					.from(team)
					.where(
						and(
							eq(team.organizationId, input.organizationId),
							inArray(team.id, searchableTeamIds),
							or(ilike(team.name, pattern), ilike(team.description, pattern)),
						),
					)
					.orderBy(asc(team.name), asc(team.id))
					.limit(LIVE_SEARCH_LIMIT)
			: [],
	]);

	return {
		employees: employeeRows.map(mapEmployeeSearchRow),
		teams: teamRows.map(mapTeamSearchRow),
	};
}
```

- [ ] **Step 4: Run live helper tests to verify pass**

Run:

```bash
pnpm --filter webapp test -- src/lib/app-search/live-results.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add live search server action**

Create `apps/webapp/src/app/[locale]/(app)/search/actions.ts`:

```ts
"use server";

import { getCurrentSettingsAccessTier, getPrincipalContext } from "@/lib/auth-helpers";
import { searchLiveAppResults } from "@/lib/app-search/live-results";
import type { LiveAppSearchResults } from "@/lib/app-search/types";

export type SearchAppRecordsActionResult =
	| { success: true; data: LiveAppSearchResults }
	| { success: false; error: string; data: LiveAppSearchResults };

const EMPTY_RESULTS: LiveAppSearchResults = { employees: [], teams: [] };

export async function searchAppRecordsAction(query: string): Promise<SearchAppRecordsActionResult> {
	try {
		const [principal, accessTier] = await Promise.all([
			getPrincipalContext(),
			getCurrentSettingsAccessTier(),
		]);

		if (!principal || !accessTier || !principal.activeOrganizationId) {
			return { success: true, data: EMPTY_RESULTS };
		}

		const data = await searchLiveAppResults({
			organizationId: principal.activeOrganizationId,
			query,
			accessTier,
			currentEmployeeId: principal.employee?.id ?? null,
			permissionsByTeamId: principal.permissions.byTeamId,
		});

		return { success: true, data };
	} catch {
		return {
			success: false,
			error: "Could not load people or teams",
			data: EMPTY_RESULTS,
		};
	}
}
```

- [ ] **Step 6: Run TypeScript-focused test command for live search files**

Run:

```bash
pnpm --filter webapp test -- src/lib/app-search/live-results.test.ts
```

Expected: PASS with no TypeScript compile errors for the new action imports.

- [ ] **Step 7: Commit live record search**

Run:

```bash
git add "apps/webapp/src/lib/app-search/live-results.ts" "apps/webapp/src/lib/app-search/live-results.test.ts" "apps/webapp/src/app/[locale]/(app)/search/actions.ts"
git commit -m "feat: add scoped app record search"
```

Expected: commit succeeds.

---

### Task 3: Add Command Palette Component

**Files:**
- Create: `apps/webapp/src/components/app-search.tsx`
- Create: `apps/webapp/src/components/app-search.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/webapp/src/components/app-search.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSearchResult } from "@/lib/app-search/types";

const { pushMock, searchActionMock, hotkeyRegistrations } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	searchActionMock: vi.fn(),
	hotkeyRegistrations: [] as Array<{ hotkey: string; callback: (event: KeyboardEvent) => void; options?: Record<string, unknown> }>,
}));

vi.mock("@tanstack/react-hotkeys", () => ({
	useHotkey: (hotkey: string, callback: (event: KeyboardEvent) => void, options?: Record<string, unknown>) => {
		hotkeyRegistrations.push({ hotkey, callback, options });
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string) => defaultValue ?? _key }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/[locale]/(app)/search/actions", () => ({
	searchAppRecordsAction: searchActionMock,
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (open ? <div>{children}</div> : null),
	DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

import { AppSearch } from "./app-search";

const staticResults: AppSearchResult[] = [
	{ type: "page", id: "dashboard", title: "Dashboard", href: "/" },
	{ type: "setting", id: "setting-profile", title: "Profile", subtitle: "Manage profile", href: "/settings/profile" },
];

describe("AppSearch", () => {
	beforeEach(() => {
		pushMock.mockReset();
		searchActionMock.mockReset();
		hotkeyRegistrations.length = 0;
		vi.useRealTimers();
	});

	it("opens with the trigger button and navigates to a static result", async () => {
		searchActionMock.mockResolvedValue({ success: true, data: { employees: [], teams: [] } });

		render(<AppSearch staticResults={staticResults} />);

		fireEvent.click(screen.getByRole("button", { name: /search/i }));
		expect(screen.getByRole("dialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("option", { name: /profile manage profile/i }));

		expect(pushMock).toHaveBeenCalledWith("/settings/profile");
	});

	it("registers Mod+K with TanStack hotkeys", () => {
		render(<AppSearch staticResults={staticResults} />);

		expect(hotkeyRegistrations).toEqual([
			expect.objectContaining({ hotkey: "Mod+K", options: expect.objectContaining({ preventDefault: true }) }),
		]);
	});

	it("opens when the registered hotkey fires", () => {
		render(<AppSearch staticResults={staticResults} />);

		hotkeyRegistrations[0].callback(new KeyboardEvent("keydown", { key: "k", metaKey: true }));

		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("loads live results after typing and navigates to employee detail", async () => {
		vi.useFakeTimers();
		searchActionMock.mockResolvedValue({
			success: true,
			data: {
				employees: [{ type: "employee", id: "employee-emp_1", title: "Ada Lovelace", href: "/settings/employees/emp_1" }],
				teams: [],
			},
		});

		render(<AppSearch staticResults={staticResults} />);
		fireEvent.click(screen.getByRole("button", { name: /search/i }));
		fireEvent.change(screen.getByPlaceholderText("Search pages, settings, people, and teams..."), { target: { value: "ada" } });
		vi.advanceTimersByTime(250);

		await waitFor(() => expect(screen.getByRole("option", { name: /ada lovelace/i })).toBeTruthy());
		fireEvent.click(screen.getByRole("option", { name: /ada lovelace/i }));

		expect(searchActionMock).toHaveBeenCalledWith("ada");
		expect(pushMock).toHaveBeenCalledWith("/settings/employees/emp_1");
	});

	it("keeps static results available when live search fails", async () => {
		vi.useFakeTimers();
		searchActionMock.mockResolvedValue({ success: false, error: "Could not load people or teams", data: { employees: [], teams: [] } });

		render(<AppSearch staticResults={staticResults} />);
		fireEvent.click(screen.getByRole("button", { name: /search/i }));
		fireEvent.change(screen.getByPlaceholderText("Search pages, settings, people, and teams..."), { target: { value: "ada" } });
		vi.advanceTimersByTime(250);

		await waitFor(() => expect(screen.getByText("Could not load people or teams")).toBeTruthy());
		expect(screen.getByRole("option", { name: /dashboard/i })).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run component tests to verify failure**

Run:

```bash
pnpm --filter webapp test -- src/components/app-search.test.tsx
```

Expected: FAIL because `./app-search` does not exist.

- [ ] **Step 3: Implement `AppSearch`**

Create `apps/webapp/src/components/app-search.tsx`:

```tsx
"use client";

import { IconSearch } from "@tabler/icons-react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState, useTransition } from "react";
import { searchAppRecordsAction } from "@/app/[locale]/(app)/search/actions";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { AppSearchResult, LiveAppSearchResults } from "@/lib/app-search/types";
import { useRouter } from "@/navigation";

const EMPTY_LIVE_RESULTS: LiveAppSearchResults = { employees: [], teams: [] };

function ResultItem({ result, onSelect }: { result: AppSearchResult; onSelect: (result: AppSearchResult) => void }) {
	return (
		<CommandItem value={`${result.title} ${result.subtitle ?? ""}`} onSelect={() => onSelect(result)}>
			<div className="flex min-w-0 flex-col">
				<span className="truncate font-medium">{result.title}</span>
				{result.subtitle ? <span className="text-muted-foreground truncate text-xs">{result.subtitle}</span> : null}
			</div>
		</CommandItem>
	);
}

export function AppSearch({ staticResults }: { staticResults: AppSearchResult[] }) {
	const { t } = useTranslate();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [liveResults, setLiveResults] = useState<LiveAppSearchResults>(EMPTY_LIVE_RESULTS);
	const [liveError, setLiveError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	useHotkey(
		"Mod+K",
		(event) => {
			event.preventDefault();
			setOpen((current) => !current);
		},
		{ preventDefault: true },
	);

	useEffect(() => {
		const normalizedQuery = query.trim();
		if (!open || normalizedQuery.length < 2) {
			setLiveResults(EMPTY_LIVE_RESULTS);
			setLiveError(null);
			return;
		}

		const timeoutId = window.setTimeout(() => {
			startTransition(() => {
				void searchAppRecordsAction(normalizedQuery).then((result) => {
					setLiveResults(result.data);
					setLiveError(result.success ? null : result.error);
				});
			});
		}, 250);

		return () => window.clearTimeout(timeoutId);
	}, [open, query]);

	function handleSelect(result: AppSearchResult) {
		setOpen(false);
		setQuery("");
		router.push(result.href);
	}

	return (
		<>
			<SidebarGroup>
				<SidebarGroupContent>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton type="button" tooltip={t("appSearch.open", "Search")} onClick={() => setOpen(true)}>
								<IconSearch />
								<span>{t("appSearch.open", "Search")}</span>
								<span className="text-muted-foreground ml-auto text-xs">⌘K</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

			<CommandDialog
				open={open}
				onOpenChange={setOpen}
				title={t("appSearch.title", "Search")}
				description={t("appSearch.description", "Search pages, settings, people, and teams")}
				className="max-w-2xl"
			>
				<CommandInput
					placeholder={t("appSearch.placeholder", "Search pages, settings, people, and teams...")}
					value={query}
					onValueChange={setQuery}
				/>
				<CommandList>
					<CommandEmpty>{t("appSearch.empty", "No results found.")}</CommandEmpty>
					<CommandGroup heading={t("appSearch.group.pages", "Pages")}>
						{staticResults
							.filter((result) => result.type === "page")
							.map((result) => <ResultItem key={result.id} result={result} onSelect={handleSelect} />)}
					</CommandGroup>
					<CommandGroup heading={t("appSearch.group.settings", "Settings")}>
						{staticResults
							.filter((result) => result.type === "setting")
							.map((result) => <ResultItem key={result.id} result={result} onSelect={handleSelect} />)}
					</CommandGroup>
					{isPending ? <div className="text-muted-foreground px-4 py-2 text-sm">{t("appSearch.loading", "Loading people and teams...")}</div> : null}
					{liveError ? <div className="text-muted-foreground px-4 py-2 text-sm">{liveError}</div> : null}
					<CommandGroup heading={t("appSearch.group.employees", "Employees")}>
						{liveResults.employees.map((result) => <ResultItem key={result.id} result={result} onSelect={handleSelect} />)}
					</CommandGroup>
					<CommandGroup heading={t("appSearch.group.teams", "Teams")}>
						{liveResults.teams.map((result) => <ResultItem key={result.id} result={result} onSelect={handleSelect} />)}
					</CommandGroup>
				</CommandList>
			</CommandDialog>
		</>
	);
}
```

- [ ] **Step 4: Run component tests to verify pass**

Run:

```bash
pnpm --filter webapp test -- src/components/app-search.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit command palette component**

Run:

```bash
git add apps/webapp/src/components/app-search.tsx apps/webapp/src/components/app-search.test.tsx
git commit -m "feat: add app search command palette"
```

Expected: commit succeeds.

---

### Task 4: Wire Search Into The Sidebar

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Update sidebar tests for search rendering and server props**

Modify `apps/webapp/src/components/app-sidebar.test.tsx` by adding `appSearchSpy` to the hoisted mocks, mocking `AppSearch`, and adding assertions.

Use this replacement for the hoisted block:

```ts
const {
	navMainSpy,
	navSecondarySpy,
	appSidebarSpy,
	appSearchSpy,
	getUserOrganizationsMock,
	getAuthContextMock,
	getCurrentSettingsAccessTierMock,
} = vi.hoisted(() => ({
	navMainSpy: vi.fn(),
	navSecondarySpy: vi.fn(),
	appSidebarSpy: vi.fn(),
	appSearchSpy: vi.fn(),
	getUserOrganizationsMock: vi.fn(),
	getAuthContextMock: vi.fn(),
	getCurrentSettingsAccessTierMock: vi.fn(),
}));
```

Add this mock before importing `AppSidebar`:

```ts
vi.mock("@/components/app-search", () => ({
	AppSearch: ({ staticResults }: { staticResults: unknown[] }) => {
		appSearchSpy(staticResults);
		return <button type="button">Search</button>;
	},
}));
```

Add `appSearchSpy.mockClear();` in `beforeEach`.

Add this test before the server sidebar test:

```tsx
it("renders app search with role-filtered static results", () => {
	render(
		<AppSidebar
			employeeRole="employee"
			settingsAccessTier="member"
			billingEnabled={false}
			showComplianceNav={false}
			featureFlags={{ shiftsEnabled: false, projectsEnabled: false, surchargesEnabled: false, demoDataEnabled: false }}
		/>,
	);

	expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
	expect(appSearchSpy).toHaveBeenCalledWith(
		expect.arrayContaining([
			expect.objectContaining({ title: "Dashboard", href: "/" }),
			expect.objectContaining({ title: "Profile", href: "/settings/profile" }),
		]),
	);
	expect(appSearchSpy).toHaveBeenCalledWith(
		expect.not.arrayContaining([
			expect.objectContaining({ href: "/settings/employees" }),
			expect.objectContaining({ href: "/settings/organizations" }),
		]),
	);
});
```

In the existing `passes showComplianceNav from the org-admin settings tier at runtime` test, update `getUserOrganizationsMock.mockResolvedValue` to include all feature flags:

```ts
getUserOrganizationsMock.mockResolvedValue([
	{
		id: "org_1",
		shiftsEnabled: true,
		projectsEnabled: true,
		surchargesEnabled: true,
		demoDataEnabled: true,
	},
]);
```

Extend the `appSidebarSpy` assertion with:

```ts
expect.objectContaining({
	showComplianceNav: true,
	employeeRole: "admin",
	shiftsEnabled: true,
	settingsAccessTier: "orgAdmin",
	billingEnabled: false,
	featureFlags: {
		shiftsEnabled: true,
		projectsEnabled: true,
		surchargesEnabled: true,
		demoDataEnabled: true,
	},
})
```

- [ ] **Step 2: Run sidebar tests to verify failure**

Run:

```bash
pnpm --filter webapp test -- src/components/app-sidebar.test.tsx
```

Expected: FAIL because `AppSidebar` does not yet pass search props or render `AppSearch`.

- [ ] **Step 3: Wire static search into `AppSidebar`**

Modify `apps/webapp/src/components/app-sidebar.tsx`:

Add imports:

```ts
import { AppSearch } from "@/components/app-search";
import { buildStaticAppSearchResults } from "@/lib/app-search/static-results";
import type { FeatureFlagState } from "@/components/settings/settings-config";
import type { SettingsAccessTier } from "@/lib/settings-access";
```

Extend `AppSidebarProps`:

```ts
	settingsAccessTier?: SettingsAccessTier;
	billingEnabled?: boolean;
	featureFlags?: FeatureFlagState;
```

Add defaults in the function parameters:

```ts
	settingsAccessTier = "member",
	billingEnabled = false,
	featureFlags,
```

Before `return`, add:

```ts
	const staticSearchResults = buildStaticAppSearchResults({
		t: (key, defaultValue) => t(key, defaultValue),
		employeeRole,
		settingsAccessTier,
		billingEnabled,
		showComplianceNav,
		featureFlags,
	});
```

Inside `<SidebarContent>`, place search before `NavMain`:

```tsx
				<AppSearch staticResults={staticSearchResults} />
				<NavMain items={navPersonal} label="z8 app" />
```

- [ ] **Step 4: Pass search visibility inputs from `ServerAppSidebar`**

Modify `apps/webapp/src/components/server-app-sidebar.tsx`:

Add a local feature flag object before return:

```ts
	const featureFlags = currentOrganization
		? {
				shiftsEnabled: currentOrganization.shiftsEnabled ?? false,
				projectsEnabled: currentOrganization.projectsEnabled ?? false,
				surchargesEnabled: currentOrganization.surchargesEnabled ?? false,
				demoDataEnabled: currentOrganization.demoDataEnabled ?? true,
			}
		: undefined;
```

Pass these props to `AppSidebar`:

```tsx
			settingsAccessTier={settingsAccessTier ?? "member"}
			billingEnabled={process.env.BILLING_ENABLED === "true"}
			featureFlags={featureFlags}
```

- [ ] **Step 5: Run sidebar tests to verify pass**

Run:

```bash
pnpm --filter webapp test -- src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit sidebar integration**

Run:

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "feat: add sidebar app search entry"
```

Expected: commit succeeds.

---

### Task 5: Final Verification And Polish

**Files:**
- Modify only files from Tasks 1-4 if verification finds issues.

- [ ] **Step 1: Run targeted app search tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/app-search/static-results.test.ts src/lib/app-search/live-results.test.ts src/components/app-search.test.tsx src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run existing settings visibility tests**

Run:

```bash
pnpm --filter webapp test -- src/components/settings/settings-config.test.ts src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the webapp test suite if targeted tests pass**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS. If unrelated pre-existing failures appear, capture the failing test names and do not change unrelated files.

- [ ] **Step 4: Run production build if tests pass**

Run:

```bash
CI=true pnpm --filter webapp build
```

Expected: PASS. If environment variables are required and unavailable to agents, skip the build and note the missing system-level variables in the final response.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --stat HEAD
git diff HEAD -- apps/webapp/src/lib/app-search apps/webapp/src/app/[locale]/(app)/search/actions.ts apps/webapp/src/components/app-search.tsx apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/package.json pnpm-lock.yaml
```

Expected: diff only contains the app search feature and dependency changes.

- [ ] **Step 6: Commit verification fixes**

If Step 1-5 required fixes, run:

```bash
git add apps/webapp/src/lib/app-search apps/webapp/src/app/[locale]/(app)/search/actions.ts apps/webapp/src/components/app-search.tsx apps/webapp/src/components/app-search.test.tsx apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx apps/webapp/package.json pnpm-lock.yaml
git commit -m "fix: verify app search integration"
```

Expected: commit succeeds only if there are verification fixes to commit. If there are no changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: sidebar button, `Cmd+K` / `Ctrl+K` through `@tanstack/react-hotkeys`, static page/settings search, live employee/team search, role/capability scoping, direct navigation, quiet live-search error state, and tests are all covered by Tasks 1-5.
- Placeholder scan: no task uses unresolved placeholders; every created file has concrete code and every verification step has exact commands and expected outcomes.
- Type consistency: `AppSearchResult`, `LiveAppSearchResults`, `StaticAppSearchInput`, `searchAppRecordsAction`, and `buildStaticAppSearchResults` names are consistent across tasks.
