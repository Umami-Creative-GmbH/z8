# Org Chart Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only webapp org explorer where all active employees can browse manager and team relationships through an interactive React Flow graph.

**Architecture:** Add a new `/organization` app route with org-scoped server actions and a route-local React Flow client. Use pure graph-building helpers for the small-org/full-graph and large-org/neighborhood payloads so server behavior is testable without rendering React Flow.

**Tech Stack:** Next.js app router, React 19, `@xyflow/react`, Drizzle ORM, Effect server-action result pattern, Vitest, Testing Library, Tolgee translations with default strings.

---

## Source Design

Implement `docs/superpowers/specs/2026-05-09-org-chart-explorer-design.md`.

## File Structure

- Modify: `apps/webapp/package.json` and lockfile through `pnpm add @xyflow/react --filter webapp`.
- Modify: `apps/webapp/src/components/app-sidebar.tsx` to add the personal/main sidebar item.
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx` to assert the sidebar item.
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-types.ts` for serializable graph types shared by actions, helpers, and client components.
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.ts` for pure graph helper functions.
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.test.ts` for unit tests covering threshold, dedupe, org scoping helpers, and graph payload shape.
- Create: `apps/webapp/src/app/[locale]/(app)/organization/actions.ts` for current-org server actions.
- Create: `apps/webapp/src/app/[locale]/(app)/organization/page.tsx` for the server page shell.
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx` for the main client component.
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx` for route-local UI behavior that can be tested without actual React Flow rendering.

## Shared Types

Use these exported types in `org-chart-types.ts`:

```ts
export const SMALL_ORG_EMPLOYEE_LIMIT = 100;
export const EMPLOYEE_NEIGHBORHOOD_TEAM_MEMBER_LIMIT = 25;
export const TEAM_NEIGHBORHOOD_MEMBER_LIMIT = 50;

export type OrgChartNodeKind = "employee" | "team";
export type OrgChartEdgeKind = "manager" | "team-membership" | "team-primary-manager";
export type OrgChartLoadMode = "full" | "focused";

export type OrgChartEmployeeNode = {
	id: string;
	kind: "employee";
	employeeId: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	teamIds: string[];
	isFocused?: boolean;
	expandable: {
		managers: boolean;
		reports: boolean;
		teams: boolean;
	};
};

export type OrgChartTeamNode = {
	id: string;
	kind: "team";
	teamId: string;
	name: string;
	description: string | null;
	memberCount: number;
	primaryManagerId: string | null;
	expandable: {
		members: boolean;
		primaryManager: boolean;
	};
};

export type OrgChartNode = OrgChartEmployeeNode | OrgChartTeamNode;

export type OrgChartEdge = {
	id: string;
	kind: OrgChartEdgeKind;
	source: string;
	target: string;
	label: string;
};

export type OrgChartGraph = {
	mode: OrgChartLoadMode;
	focusedEmployeeId: string | null;
	employeeCount: number;
	nodes: OrgChartNode[];
	edges: OrgChartEdge[];
	partial: boolean;
};

export type OrgChartSearchResult = {
	employeeId: string;
	name: string;
	email: string;
	position: string | null;
	image: string | null;
	role: "admin" | "manager" | "employee";
};
```

## Task 1: Add React Flow Dependency

**Files:**
- Modify: `apps/webapp/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install dependency**

Run:

```bash
pnpm --filter webapp add @xyflow/react
```

Expected: `apps/webapp/package.json` includes `@xyflow/react` in `dependencies`, and `pnpm-lock.yaml` changes.

- [ ] **Step 2: Verify dependency resolves**

Run:

```bash
pnpm --filter webapp exec tsc --noEmit --pretty false
```

Expected: TypeScript may report existing project errors, but it must not report `Cannot find module '@xyflow/react'`.

- [ ] **Step 3: Commit dependency change**

```bash
git add apps/webapp/package.json pnpm-lock.yaml
git commit -m "feat: add React Flow dependency"
```

## Task 2: Add Sidebar Entry

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Write failing sidebar test**

Add this test to `apps/webapp/src/components/app-sidebar.test.tsx` after the My Requests test:

```tsx
it("renders Org Explorer as a primary personal navigation item", () => {
	render(<AppSidebar />);

	expect(screen.getByRole("link", { name: "Org Explorer" }).getAttribute("href")).toBe(
		"/organization",
	);
	expect(navMainSpy).toHaveBeenLastCalledWith(
		expect.arrayContaining([
			expect.objectContaining({ title: "Org Explorer", url: "/organization" }),
		]),
	);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter webapp test src/components/app-sidebar.test.tsx
```

Expected: FAIL because `Org Explorer` is not rendered.

- [ ] **Step 3: Add sidebar item**

In `apps/webapp/src/components/app-sidebar.tsx`, import `IconHierarchy` from `@tabler/icons-react` and add this object to `navPersonal` after `Calendar` and before `Absences`:

```tsx
{
	title: t("nav.org-explorer", "Org Explorer"),
	url: "/organization",
	icon: IconHierarchy,
},
```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
pnpm --filter webapp test src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit sidebar change**

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "feat: add org explorer navigation"
```

## Task 3: Add Graph Types And Pure Helpers

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-types.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildEdgeId,
	buildEmployeeNodeId,
	buildOrgChartGraph,
	buildTeamNodeId,
	mergeOrgChartGraphs,
} from "./org-chart-graph";

const employee = {
	id: "emp-1",
	userId: "user-1",
	name: "Ada Lovelace",
	email: "ada@example.com",
	image: null,
	position: "Engineer",
	role: "employee" as const,
	isActive: true,
	teamIds: ["team-1"],
};

const manager = {
	id: "emp-2",
	userId: "user-2",
	name: "Grace Hopper",
	email: "grace@example.com",
	image: null,
	position: "Manager",
	role: "manager" as const,
	isActive: true,
	teamIds: ["team-1"],
};

const team = {
	id: "team-1",
	name: "Platform",
	description: null,
	memberCount: 2,
	primaryManagerId: "emp-2",
};

describe("org chart graph helpers", () => {
	it("uses stable node and edge ids", () => {
		expect(buildEmployeeNodeId("emp-1")).toBe("employee:emp-1");
		expect(buildTeamNodeId("team-1")).toBe("team:team-1");
		expect(buildEdgeId("manager", "employee:emp-2", "employee:emp-1")).toBe(
			"manager:employee:emp-2->employee:emp-1",
		);
	});

	it("builds employee, team, manager, membership, and primary-manager graph elements", () => {
		const graph = buildOrgChartGraph({
			mode: "full",
			focusedEmployeeId: "emp-1",
			employeeCount: 2,
			partial: false,
			employees: [employee, manager],
			teams: [team],
			managerLinks: [{ managerId: "emp-2", employeeId: "emp-1" }],
			teamMemberships: [
				{ teamId: "team-1", employeeId: "emp-1" },
				{ teamId: "team-1", employeeId: "emp-2" },
			],
		});

		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "employee:emp-1", kind: "employee", isFocused: true }),
				expect.objectContaining({ id: "employee:emp-2", kind: "employee" }),
				expect.objectContaining({ id: "team:team-1", kind: "team", memberCount: 2 }),
			]),
		);
		expect(graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "manager", source: "employee:emp-2", target: "employee:emp-1" }),
				expect.objectContaining({ kind: "team-membership", source: "team:team-1", target: "employee:emp-1" }),
				expect.objectContaining({ kind: "team-primary-manager", source: "employee:emp-2", target: "team:team-1" }),
			]),
		);
	});

	it("deduplicates nodes and edges when merging expanded graph payloads", () => {
		const first = buildOrgChartGraph({
			mode: "focused",
			focusedEmployeeId: "emp-1",
			employeeCount: 101,
			partial: true,
			employees: [employee],
			teams: [team],
			managerLinks: [],
			teamMemberships: [{ teamId: "team-1", employeeId: "emp-1" }],
		});
		const second = buildOrgChartGraph({
			mode: "focused",
			focusedEmployeeId: "emp-2",
			employeeCount: 101,
			partial: true,
			employees: [employee, manager],
			teams: [team],
			managerLinks: [{ managerId: "emp-2", employeeId: "emp-1" }],
			teamMemberships: [{ teamId: "team-1", employeeId: "emp-1" }],
		});

		const merged = mergeOrgChartGraphs(first, second, "emp-2");

		expect(merged.nodes.filter((node) => node.id === "employee:emp-1")).toHaveLength(1);
		expect(merged.nodes.find((node) => node.id === "employee:emp-2")).toEqual(
			expect.objectContaining({ isFocused: true }),
		);
		expect(new Set(merged.edges.map((edge) => edge.id)).size).toBe(merged.edges.length);
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/organization/org-chart-graph.test.ts'
```

Expected: FAIL because helper files do not exist.

- [ ] **Step 3: Add shared types**

Create `apps/webapp/src/app/[locale]/(app)/organization/org-chart-types.ts` using the exact types from the **Shared Types** section.

- [ ] **Step 4: Add pure graph helpers**

Create `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.ts`:

```ts
import type {
	OrgChartEdge,
	OrgChartEdgeKind,
	OrgChartGraph,
	OrgChartNode,
} from "./org-chart-types";

type GraphEmployeeInput = {
	id: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	teamIds: string[];
};

type GraphTeamInput = {
	id: string;
	name: string;
	description: string | null;
	memberCount: number;
	primaryManagerId: string | null;
};

type GraphManagerLinkInput = { managerId: string; employeeId: string };
type GraphTeamMembershipInput = { teamId: string; employeeId: string };

type BuildOrgChartGraphInput = {
	mode: OrgChartGraph["mode"];
	focusedEmployeeId: string | null;
	employeeCount: number;
	partial: boolean;
	employees: GraphEmployeeInput[];
	teams: GraphTeamInput[];
	managerLinks: GraphManagerLinkInput[];
	teamMemberships: GraphTeamMembershipInput[];
};

export function buildEmployeeNodeId(employeeId: string) {
	return `employee:${employeeId}`;
}

export function buildTeamNodeId(teamId: string) {
	return `team:${teamId}`;
}

export function buildEdgeId(kind: OrgChartEdgeKind, source: string, target: string) {
	return `${kind}:${source}->${target}`;
}

export function buildOrgChartGraph(input: BuildOrgChartGraphInput): OrgChartGraph {
	const employeeIds = new Set(input.employees.map((employee) => employee.id));
	const teamIds = new Set(input.teams.map((team) => team.id));
	const nodes: OrgChartNode[] = [];
	const edges: OrgChartEdge[] = [];

	for (const employee of input.employees) {
		nodes.push({
			id: buildEmployeeNodeId(employee.id),
			kind: "employee",
			employeeId: employee.id,
			userId: employee.userId,
			name: employee.name,
			email: employee.email,
			image: employee.image,
			position: employee.position,
			role: employee.role,
			isActive: employee.isActive,
			teamIds: employee.teamIds,
			isFocused: employee.id === input.focusedEmployeeId,
			expandable: {
				managers: input.partial,
				reports: input.partial,
				teams: input.partial,
			},
		});
	}

	for (const team of input.teams) {
		nodes.push({
			id: buildTeamNodeId(team.id),
			kind: "team",
			teamId: team.id,
			name: team.name,
			description: team.description,
			memberCount: team.memberCount,
			primaryManagerId: team.primaryManagerId,
			expandable: {
				members: input.partial,
				primaryManager: input.partial && team.primaryManagerId !== null,
			},
		});
	}

	for (const link of input.managerLinks) {
		if (!employeeIds.has(link.managerId) || !employeeIds.has(link.employeeId)) continue;
		const source = buildEmployeeNodeId(link.managerId);
		const target = buildEmployeeNodeId(link.employeeId);
		edges.push({
			id: buildEdgeId("manager", source, target),
			kind: "manager",
			source,
			target,
			label: "Manager",
		});
	}

	for (const membership of input.teamMemberships) {
		if (!teamIds.has(membership.teamId) || !employeeIds.has(membership.employeeId)) continue;
		const source = buildTeamNodeId(membership.teamId);
		const target = buildEmployeeNodeId(membership.employeeId);
		edges.push({
			id: buildEdgeId("team-membership", source, target),
			kind: "team-membership",
			source,
			target,
			label: "Team",
		});
	}

	for (const team of input.teams) {
		if (!team.primaryManagerId || !employeeIds.has(team.primaryManagerId)) continue;
		const source = buildEmployeeNodeId(team.primaryManagerId);
		const target = buildTeamNodeId(team.id);
		edges.push({
			id: buildEdgeId("team-primary-manager", source, target),
			kind: "team-primary-manager",
			source,
			target,
			label: "Team manager",
		});
	}

	return dedupeGraph({
		mode: input.mode,
		focusedEmployeeId: input.focusedEmployeeId,
		employeeCount: input.employeeCount,
		nodes,
		edges,
		partial: input.partial,
	});
}

export function mergeOrgChartGraphs(
	current: OrgChartGraph,
	incoming: OrgChartGraph,
	focusedEmployeeId: string | null,
): OrgChartGraph {
	return dedupeGraph({
		mode: incoming.mode,
		focusedEmployeeId,
		employeeCount: Math.max(current.employeeCount, incoming.employeeCount),
		partial: current.partial || incoming.partial,
		nodes: [...current.nodes, ...incoming.nodes].map((node) =>
			node.kind === "employee"
				? { ...node, isFocused: node.employeeId === focusedEmployeeId }
				: node,
		),
		edges: [...current.edges, ...incoming.edges],
	});
}

function dedupeGraph(graph: OrgChartGraph): OrgChartGraph {
	const nodesById = new Map<string, OrgChartNode>();
	const edgesById = new Map<string, OrgChartEdge>();

	for (const node of graph.nodes) {
		nodesById.set(node.id, node);
	}

	for (const edge of graph.edges) {
		edgesById.set(edge.id, edge);
	}

	return {
		...graph,
		nodes: [...nodesById.values()],
		edges: [...edgesById.values()],
	};
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/organization/org-chart-graph.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit graph helpers**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-types.ts' 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.ts' 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.test.ts'
git commit -m "feat: add org chart graph helpers"
```

## Task 4: Add Org-Scoped Server Actions

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/organization/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.test.ts`

- [ ] **Step 1: Add source-inspection tests for server-action security invariants**

Append this test block to `org-chart-graph.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("org chart server action source", () => {
	it("keeps action queries scoped to active organization and active employees", () => {
		const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

		expect(source).toContain("activeOrganizationId");
		expect(source).toContain("eq(employee.organizationId, organizationId)");
		expect(source).toContain("eq(employee.isActive, true)");
		expect(source).toContain("SMALL_ORG_EMPLOYEE_LIMIT");
		expect(source).toContain("EMPLOYEE_NEIGHBORHOOD_TEAM_MEMBER_LIMIT");
		expect(source).toContain("TEAM_NEIGHBORHOOD_MEMBER_LIMIT");
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/organization/org-chart-graph.test.ts'
```

Expected: FAIL because `actions.ts` does not exist.

- [ ] **Step 3: Implement actions**

Create `apps/webapp/src/app/[locale]/(app)/organization/actions.ts` with these exports and implementation rules:

```ts
"use server";

import { and, asc, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, team, teamMembership } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AuthenticationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { buildOrgChartGraph } from "./org-chart-graph";
import {
	EMPLOYEE_NEIGHBORHOOD_TEAM_MEMBER_LIMIT,
	SMALL_ORG_EMPLOYEE_LIMIT,
	TEAM_NEIGHBORHOOD_MEMBER_LIMIT,
	type OrgChartGraph,
	type OrgChartSearchResult,
} from "./org-chart-types";

type CurrentOrgEmployee = typeof employee.$inferSelect;
type GraphEmployeeRow = typeof employee.$inferSelect & {
	user: Pick<typeof user.$inferSelect, "id" | "name" | "email" | "image">;
};
type GraphTeamRow = Pick<typeof team.$inferSelect, "id" | "name" | "description" | "primaryManagerId">;
type ManagerLinkRow = { managerId: string; employeeId: string };
type TeamMembershipRow = { teamId: string; employeeId: string };

const employeeDisplayName = sql<string>`
	coalesce(
		nullif(${user.name}, ''),
		nullif(concat_ws(' ', ${employee.firstName}, ${employee.lastName}), ''),
		${user.email}
	)
`;

async function getCurrentOrgEmployee(): Promise<{ organizationId: string; employee: CurrentOrgEmployee }> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user || !session.session?.activeOrganizationId) {
		throw new AuthenticationError({ message: "Authentication required" });
	}

	const organizationId = session.session.activeOrganizationId;
	const currentEmployee = await dbLookupCurrentEmployee(session.user.id, organizationId);
	if (!currentEmployee) {
		throw new NotFoundError({ message: "Employee profile not found", entityType: "employee" });
	}

	return { organizationId, employee: currentEmployee };
}

async function dbLookupCurrentEmployee(userId: string, organizationId: string) {
	const dbService = await Effect.runPromise(Effect.provide(DatabaseService, AppLayer));
	return await dbService.db.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, organizationId),
			eq(employee.isActive, true),
		),
	});
}

function mapGraphEmployee(row: GraphEmployeeRow, teamIdsByEmployeeId: Map<string, string[]>) {
	return {
		id: row.id,
		userId: row.userId,
		name: row.user.name || `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.user.email,
		email: row.user.email,
		image: row.user.image,
		position: row.position,
		role: row.role,
		isActive: row.isActive,
		teamIds: teamIdsByEmployeeId.get(row.id) ?? [],
	};
}

function mapGraphTeam(row: GraphTeamRow, memberCountsByTeamId: Map<string, number>) {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		primaryManagerId: row.primaryManagerId,
		memberCount: memberCountsByTeamId.get(row.id) ?? 0,
	};
}
```

Then finish the file by implementing these functions using `DatabaseService` inside `Effect.gen` and `runServerActionSafe`:

```ts
export async function getOrgChartInitialGraph(): Promise<ServerActionResult<OrgChartGraph>>;
export async function searchOrgEmployees(query: string): Promise<ServerActionResult<OrgChartSearchResult[]>>;
export async function getEmployeeNeighborhood(employeeId: string): Promise<ServerActionResult<OrgChartGraph>>;
export async function getTeamNeighborhood(teamId: string): Promise<ServerActionResult<OrgChartGraph>>;
```

Implementation requirements for those four exports:

- Resolve `{ organizationId, employee: currentEmployee }` from the active session before every query.
- Count active employees with `eq(employee.organizationId, organizationId)` and `eq(employee.isActive, true)`.
- `getOrgChartInitialGraph()` returns full graph when count is less than `SMALL_ORG_EMPLOYEE_LIMIT`; otherwise it calls the same neighborhood loader used by `getEmployeeNeighborhood(currentEmployee.id)` and marks `mode: "focused"` and `partial: true`.
- Full graph loads active employee/user rows, active teams in the organization, direct manager links where both sides are active org employees, and team memberships where employee and team belong to the active organization.
- Employee neighborhood validates target employee belongs to the active organization and is active, then loads target, direct managers, direct reports, target teams, each team primary manager, and up to `EMPLOYEE_NEIGHBORHOOD_TEAM_MEMBER_LIMIT` active members per connected team.
- Team neighborhood validates target team belongs to the active organization, then loads up to `TEAM_NEIGHBORHOOD_MEMBER_LIMIT` active team members and the active primary manager if present.
- Search trims the query, returns `[]` for fewer than 2 characters, filters active employees in the active organization, matches display name/email/first/last/position with `ilike`, sorts by display name and email, and limits to 10 results.
- Cross-organization IDs fail with `NotFoundError` and do not leak existence.

- [ ] **Step 4: Run helper/source tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/organization/org-chart-graph.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript check for actions**

Run:

```bash
pnpm --filter webapp exec tsc --noEmit --pretty false
```

Expected: No new errors from files under `src/app/[locale]/(app)/organization`.

- [ ] **Step 6: Commit server actions**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/organization/actions.ts' 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.test.ts'
git commit -m "feat: add org chart data actions"
```

## Task 5: Add Page Shell And Error States

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/organization/page.tsx`

- [ ] **Step 1: Create page shell**

Create `apps/webapp/src/app/[locale]/(app)/organization/page.tsx`:

```tsx
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getTranslate } from "@/tolgee/server";
import { getOrgChartInitialGraph } from "./actions";
import { OrgChartClient } from "./org-chart-client";

export default async function OrganizationPage() {
	const [t, result] = await Promise.all([getTranslate(), getOrgChartInitialGraph()]);

	if (!result.success) {
		if (result.code === "NotFoundError") {
			return (
				<div className="@container/main flex flex-1 items-center justify-center p-6">
					<NoEmployeeError feature={t("organization.feature", "explore your organization")} />
				</div>
			);
		}

		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<Alert variant="destructive" className="max-w-xl">
					<AlertTitle>{t("organization.error.title", "Unable to load organization")}</AlertTitle>
					<AlertDescription>
						{t(
							"organization.error.description",
							"The organization chart could not be loaded. Please try again.",
						)}
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<h1 className="text-3xl font-bold tracking-tight">
					{t("organization.title", "Org Explorer")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"organization.description",
						"Explore direct managers, teams, and reporting relationships in your organization.",
					)}
				</p>
			</div>

			<div className="min-h-[680px] px-4 lg:px-6">
				<OrgChartClient initialGraph={result.data} />
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm --filter webapp exec tsc --noEmit --pretty false
```

Expected: No new errors from `organization/page.tsx`.

- [ ] **Step 3: Commit page shell**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/organization/page.tsx'
git commit -m "feat: add org explorer page shell"
```

## Task 6: Add React Flow Client

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx`

- [ ] **Step 1: Write failing client tests with React Flow mocked**

Create `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgChartGraph } from "./org-chart-types";

const { searchMock, employeeNeighborhoodMock, teamNeighborhoodMock } = vi.hoisted(() => ({
	searchMock: vi.fn(),
	employeeNeighborhoodMock: vi.fn(),
	teamNeighborhoodMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("./actions", () => ({
	searchOrgEmployees: searchMock,
	getEmployeeNeighborhood: employeeNeighborhoodMock,
	getTeamNeighborhood: teamNeighborhoodMock,
}));

vi.mock("@xyflow/react", () => ({
	Background: () => <div data-testid="flow-background" />,
	Controls: () => <div data-testid="flow-controls" />,
	MiniMap: () => <div data-testid="flow-minimap" />,
	ReactFlow: ({ nodes, edges }: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }) => (
		<div data-testid="react-flow">
			<div data-testid="node-count">{nodes.length}</div>
			<div data-testid="edge-count">{edges.length}</div>
		</div>
	),
	ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
	useReactFlow: () => ({ fitView: vi.fn() }),
}));

const graph: OrgChartGraph = {
	mode: "focused",
	focusedEmployeeId: "emp-1",
	employeeCount: 101,
	partial: true,
	nodes: [
		{
			id: "employee:emp-1",
			kind: "employee",
			employeeId: "emp-1",
			userId: "user-1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			image: null,
			position: "Engineer",
			role: "employee",
			isActive: true,
			teamIds: [],
			isFocused: true,
			expandable: { managers: true, reports: true, teams: true },
		},
	],
	edges: [],
};

describe("OrgChartClient", () => {
	beforeEach(() => {
		searchMock.mockReset();
		employeeNeighborhoodMock.mockReset();
		teamNeighborhoodMock.mockReset();
	});

	it("renders an empty state when no nodes are available", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={{ ...graph, nodes: [], employeeCount: 0, partial: false }} />);

		expect(screen.getByText("No active employees found")).toBeTruthy();
	});

	it("renders graph counts and partial loading notice", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		expect(screen.getByTestId("react-flow")).toBeTruthy();
		expect(screen.getByTestId("node-count").textContent).toBe("1");
		expect(screen.getByText("Showing part of a large organization. Expand nodes or search to continue."));
	});

	it("searches employees and focuses the selected result", async () => {
		searchMock.mockResolvedValueOnce({
			success: true,
			data: [{ employeeId: "emp-2", name: "Grace Hopper", email: "grace@example.com", position: "Manager", image: null, role: "manager" }],
		});
		employeeNeighborhoodMock.mockResolvedValueOnce({
			success: true,
			data: { ...graph, focusedEmployeeId: "emp-2", nodes: [{ ...graph.nodes[0], id: "employee:emp-2", employeeId: "emp-2", name: "Grace Hopper", isFocused: true }] },
		});

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Grace" } });
		fireEvent.click(await screen.findByRole("button", { name: "Grace Hopper grace@example.com" }));

		await waitFor(() => expect(employeeNeighborhoodMock).toHaveBeenCalledWith("emp-2"));
	});
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
```

Expected: FAIL because `org-chart-client.tsx` does not exist.

- [ ] **Step 3: Implement client component**

Create `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx` with these implementation requirements:

- Import `@xyflow/react/dist/style.css` once in this client module.
- Convert `OrgChartNode[]` to React Flow nodes with deterministic positions.
- Use employee and team custom node renderers inside the same file for this first implementation.
- Use `startTransition` for search result selection and expansion updates.
- Use `mergeOrgChartGraphs` from `org-chart-graph.ts` when adding neighborhoods.
- Use `sonner` toast for failed search/expansion if available; otherwise inline status text is acceptable.
- Provide `aria-label="Search employees"` on the search input.
- Render the exact partial-loading copy asserted in the test.
- Render `No active employees found` for empty graphs.

The component should export this signature:

```tsx
export function OrgChartClient({ initialGraph }: { initialGraph: OrgChartGraph }) {
	// implementation
}
```

Use these React Flow node and edge style rules:

- Employee nodes: card-like boxes, focused node with ring and stronger border.
- Team nodes: neutral card with `Team` badge and member count.
- Manager edges: solid primary stroke.
- Team membership edges: dashed muted stroke.
- Team primary manager edges: solid secondary/accent stroke.

- [ ] **Step 4: Run client tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript check**

Run:

```bash
pnpm --filter webapp exec tsc --noEmit --pretty false
```

Expected: No new errors from `organization` files.

- [ ] **Step 6: Commit client component**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx' 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
git commit -m "feat: add interactive org chart client"
```

## Task 7: Final Verification And Quality Review

**Files:**
- Review all files changed by earlier tasks.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter webapp test src/components/app-sidebar.test.tsx 'src/app/[locale]/(app)/organization/org-chart-graph.test.ts' 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm --filter webapp exec tsc --noEmit --pretty false
```

Expected: PASS, or only pre-existing unrelated errors. If there are new org-chart errors, fix them before continuing.

- [ ] **Step 3: Run broader webapp tests if feasible**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS, or document unrelated existing failures with exact test names and errors.

- [ ] **Step 4: Manual route smoke test**

Run:

```bash
pnpm --filter webapp dev
```

Open `/organization` in the active locale. Verify:

- Sidebar link appears as `Org Explorer`.
- Page loads for an active employee.
- Small orgs show the full graph.
- Large orgs show the partial-loading notice.
- Search can focus an employee.
- Expanding an employee or team adds nodes without clearing the graph.
- Failed search or expansion does not clear the graph.

- [ ] **Step 5: Commit verification fixes if any**

If verification required fixes, commit them:

```bash
git add apps/webapp/src docs/superpowers/plans/2026-05-09-org-chart-explorer.md
git commit -m "fix: stabilize org chart explorer"
```

If no fixes were needed, do not create an empty commit.

## Plan Self-Review

- Spec coverage: The plan covers navigation, all-employee access, `@xyflow/react`, small/full graph threshold, large/focused graph behavior, search/focus, employee and team expansion actions, org scoping, error states, accessibility, tests, and verification.
- Placeholder scan: The plan contains no deferred-work markers or vague implementation placeholders. The only flexible areas are explicit implementation requirements inside bounded files.
- Type consistency: Shared graph type names, helper names, and action names are consistent across tasks.
