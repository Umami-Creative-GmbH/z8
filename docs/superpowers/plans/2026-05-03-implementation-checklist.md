# Implementation Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an org-admin-only `/settings/implementation-checklist` page that guides new customer admins through rollout setup using existing configuration pages.

**Architecture:** Add a small org-scoped checklist domain with a server-side definition, status resolver, manual completion actions, and a focused client renderer. The checklist page uses `requireOrgAdminSettingsAccess()` and never touches platform-admin setup.

**Tech Stack:** Next.js App Router, React client components, Drizzle ORM, PostgreSQL schema definitions, Vitest, existing shadcn-style UI components, Tolgee translation fallbacks.

---

## File Structure

- Create: `apps/webapp/src/db/schema/implementation-checklist.ts`
  - Stores manual checklist completion state per organization and item id.
- Modify: `apps/webapp/src/db/schema/index.ts`
  - Exports the new schema table.
- Create: `apps/webapp/src/lib/implementation-checklist/definition.ts`
  - Defines valid checklist item ids, display copy, target routes, detector type, and manual completion capability.
- Create: `apps/webapp/src/lib/implementation-checklist/status.ts`
  - Merges automatic detector output with manual state into display-ready statuses.
- Create: `apps/webapp/src/lib/implementation-checklist/status.test.ts`
  - Unit coverage for merge behavior and invalid manual ids.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.ts`
  - Server loader and manual mark/unmark actions.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts`
  - Server action coverage for org scoping, invalid item ids, and persistence shape.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.tsx`
  - Renders the responsive checklist cards and manual controls.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/page.tsx`
  - Org-admin settings route entry point.
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
  - Adds the settings grid entry under Administration.
- Modify: `apps/webapp/src/lib/settings-access.ts`
  - Adds `/settings/implementation-checklist` to org-admin-only settings routes.
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
  - Asserts visibility and grouping.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
  - Asserts direct route access protection and route-list alignment.

## Task 1: Add Checklist Definition And Status Resolver

**Files:**
- Create: `apps/webapp/src/lib/implementation-checklist/definition.ts`
- Create: `apps/webapp/src/lib/implementation-checklist/status.ts`
- Create: `apps/webapp/src/lib/implementation-checklist/status.test.ts`

- [ ] **Step 1: Write failing status resolver tests**

Create `apps/webapp/src/lib/implementation-checklist/status.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { IMPLEMENTATION_CHECKLIST_ITEMS } from "./definition";
import { resolveImplementationChecklistItems } from "./status";

describe("implementation checklist status resolver", () => {
	it("keeps the expected customer rollout checklist order", () => {
		expect(IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => item.id)).toEqual([
			"organization-structure",
			"holidays",
			"work-policies",
			"approval-rules",
			"payroll-readiness",
			"integrations",
			"notifications",
			"employee-import",
		]);
	});

	it("marks automatic items complete from detector output", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["holidays", "work-policies", "employee-import"]),
			manualCompleteIds: new Set(),
		});

		expect(items.find((item) => item.id === "holidays")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(items.find((item) => item.id === "work-policies")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(items.find((item) => item.id === "employee-import")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
	});

	it("uses manual completion only for manually completable items", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(["organization-structure", "approval-rules", "holidays"]),
		});

		expect(items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "complete",
			completionSource: "manual",
			canToggleManualCompletion: true,
		});
		expect(items.find((item) => item.id === "approval-rules")).toMatchObject({
			status: "complete",
			completionSource: "manual",
			canToggleManualCompletion: true,
		});
		expect(items.find((item) => item.id === "holidays")).toMatchObject({
			status: "not-started",
			completionSource: null,
			canToggleManualCompletion: false,
		});
	});

	it("prefers automatic completion over stale manual state", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["integrations"]),
			manualCompleteIds: new Set(["integrations"]),
		});

		expect(items.find((item) => item.id === "integrations")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
	});

	it("returns a progress summary", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["holidays", "work-policies"]),
			manualCompleteIds: new Set(["approval-rules"]),
		});

		const completedCount = items.filter((item) => item.status === "complete").length;

		expect(completedCount).toBe(3);
		expect(items).toHaveLength(8);
	});
});
```

- [ ] **Step 2: Run the failing resolver test**

Run:

```bash
pnpm --filter webapp test src/lib/implementation-checklist/status.test.ts
```

Expected: FAIL because `definition.ts` and `status.ts` do not exist.

- [ ] **Step 3: Add checklist definition**

Create `apps/webapp/src/lib/implementation-checklist/definition.ts` with:

```ts
export type ImplementationChecklistItemId =
	| "organization-structure"
	| "holidays"
	| "work-policies"
	| "approval-rules"
	| "payroll-readiness"
	| "integrations"
	| "notifications"
	| "employee-import";

export type ImplementationChecklistDetector = "automatic" | "manual";

export interface ImplementationChecklistDefinition {
	id: ImplementationChecklistItemId;
	title: string;
	description: string;
	helperText: string;
	actionLabel: string;
	href: string;
	detector: ImplementationChecklistDetector;
	canManualComplete: boolean;
}

export const IMPLEMENTATION_CHECKLIST_ITEMS: ImplementationChecklistDefinition[] = [
	{
		id: "organization-structure",
		title: "Organization structure",
		description: "Confirm members, teams, and responsibility boundaries before rollout.",
		helperText: "Manual review: Z8 cannot know whether your rollout structure is final.",
		actionLabel: "Review organization",
		href: "/settings/organizations",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "holidays",
		title: "Holidays",
		description: "Configure public holidays and closing days used by absence and payroll workflows.",
		helperText: "Z8 checks for active holiday presets, assignments, or custom holidays.",
		actionLabel: "Configure holidays",
		href: "/settings/holidays",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "work-policies",
		title: "Work policies",
		description: "Set schedules, working time rules, and policy assignments for the organization.",
		helperText: "Z8 checks for active work policies or active work policy assignments.",
		actionLabel: "Configure work policies",
		href: "/settings/work-policies",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "approval-rules",
		title: "Approval rules",
		description: "Review who approves corrections, absences, and policy-sensitive changes.",
		helperText: "Manual review: approval readiness depends on your internal process.",
		actionLabel: "Review approval rules",
		href: "/settings/change-policies",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "payroll-readiness",
		title: "Payroll export",
		description: "Confirm payroll readiness checks and export operations before the first pay run.",
		helperText: "Manual review: export readiness should be confirmed by an admin before payroll cutoff.",
		actionLabel: "Review payroll readiness",
		href: "/settings/payroll-readiness",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "integrations",
		title: "Integrations",
		description: "Connect the notification, bot, webhook, or export integrations your team needs.",
		helperText: "Z8 checks for active Slack, Discord, Teams, Telegram, or webhook configuration.",
		actionLabel: "Review integrations",
		href: "/settings/webhooks",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "notifications",
		title: "Notifications",
		description: "Make sure admins and employees receive the right approval and status updates.",
		helperText: "Z8 checks for notification preferences or configured notification channels.",
		actionLabel: "Configure notifications",
		href: "/settings/notifications",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "employee-import",
		title: "First employee import",
		description: "Add the first employees so schedules, approvals, and payroll exports have real users.",
		helperText: "Z8 checks whether the organization has more than the founding/admin employee.",
		actionLabel: "Import employees",
		href: "/settings/import",
		detector: "automatic",
		canManualComplete: false,
	},
];

export const IMPLEMENTATION_CHECKLIST_ITEM_IDS = IMPLEMENTATION_CHECKLIST_ITEMS.map(
	(item) => item.id,
);

export function isImplementationChecklistItemId(
	value: string,
): value is ImplementationChecklistItemId {
	return IMPLEMENTATION_CHECKLIST_ITEM_IDS.includes(value as ImplementationChecklistItemId);
}
```

- [ ] **Step 4: Add status resolver**

Create `apps/webapp/src/lib/implementation-checklist/status.ts` with:

```ts
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistDefinition,
	type ImplementationChecklistItemId,
} from "./definition";

export type ImplementationChecklistStatus = "complete" | "not-started";
export type ImplementationChecklistCompletionSource = "automatic" | "manual" | null;

export interface ResolveImplementationChecklistItemsInput {
	detectedCompleteIds: Set<ImplementationChecklistItemId>;
	manualCompleteIds: Set<ImplementationChecklistItemId>;
}

export interface ResolvedImplementationChecklistItem extends ImplementationChecklistDefinition {
	status: ImplementationChecklistStatus;
	completionSource: ImplementationChecklistCompletionSource;
	canToggleManualCompletion: boolean;
}

export function resolveImplementationChecklistItems({
	detectedCompleteIds,
	manualCompleteIds,
}: ResolveImplementationChecklistItemsInput): ResolvedImplementationChecklistItem[] {
	return IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => {
		if (detectedCompleteIds.has(item.id)) {
			return {
				...item,
				status: "complete" as const,
				completionSource: "automatic" as const,
				canToggleManualCompletion: false,
			};
		}

		if (item.canManualComplete && manualCompleteIds.has(item.id)) {
			return {
				...item,
				status: "complete" as const,
				completionSource: "manual" as const,
				canToggleManualCompletion: true,
			};
		}

		return {
			...item,
			status: "not-started" as const,
			completionSource: null,
			canToggleManualCompletion: item.canManualComplete,
		};
	});
}
```

- [ ] **Step 5: Run resolver tests**

Run:

```bash
pnpm --filter webapp test src/lib/implementation-checklist/status.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/webapp/src/lib/implementation-checklist/definition.ts apps/webapp/src/lib/implementation-checklist/status.ts apps/webapp/src/lib/implementation-checklist/status.test.ts
git commit -m "feat: define implementation checklist status"
```

## Task 2: Add Manual Checklist State Schema

**Files:**
- Create: `apps/webapp/src/db/schema/implementation-checklist.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`

- [ ] **Step 1: Add schema table**

Create `apps/webapp/src/db/schema/implementation-checklist.ts` with:

```ts
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";

export const implementationChecklistManualState = pgTable(
	"implementation_checklist_manual_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		itemId: text("item_id").notNull(),
		status: text("status").default("complete").notNull(),
		completedAt: timestamp("completed_at"),
		completedByUserId: text("completed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("implementationChecklistManualState_org_item_idx").on(
			table.organizationId,
			table.itemId,
		),
		index("implementationChecklistManualState_organizationId_idx").on(table.organizationId),
	],
);
```

- [ ] **Step 2: Export schema table**

Modify `apps/webapp/src/db/schema/index.ts` by adding the export next to other domain exports:

```ts
export * from "./implementation-checklist";
```

- [ ] **Step 3: Run TypeScript-aware test startup**

Run:

```bash
pnpm --filter webapp test src/lib/implementation-checklist/status.test.ts
```

Expected: PASS and no schema import/type errors.

- [ ] **Step 4: Commit Task 2**

```bash
git add apps/webapp/src/db/schema/implementation-checklist.ts apps/webapp/src/db/schema/index.ts
git commit -m "feat: add implementation checklist state table"
```

## Task 3: Add Server Loader And Manual Actions

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts`

- [ ] **Step 1: Write failing action tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	conditions: [] as unknown[],
	counts: new Map<string, number>(),
	manualRows: [] as Array<{ itemId: string; status: string }>,
	insertValues: undefined as unknown,
	deleteWhere: undefined as unknown,
	revalidatePath: vi.fn(),
	requireAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => {
		mocks.conditions.push(...conditions);
		return { and: conditions };
	}),
	count: vi.fn(() => "count"),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	ne: vi.fn((left: unknown, right: unknown) => ({ ne: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn((table: { __tableName?: string }) => ({
				where: vi.fn(async () => [{ value: mocks.counts.get(table.__tableName ?? "") ?? 0 }]),
			})),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values: unknown) => {
				mocks.insertValues = values;
				return { onConflictDoUpdate: vi.fn(async () => undefined) };
			}),
		})),
		delete: vi.fn(() => ({
			where: vi.fn(async (where: unknown) => {
				mocks.deleteWhere = where;
			}),
		})),
		query: {
			implementationChecklistManualState: {
				findMany: vi.fn(async () => mocks.manualRows),
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	discordBotConfig: { __tableName: "discordBotConfig", organizationId: "discordOrg", setupStatus: "discordStatus" },
	employee: { __tableName: "employee", organizationId: "employeeOrg", userId: "employeeUser", isActive: "employeeActive" },
	holiday: { __tableName: "holiday", organizationId: "holidayOrg", isActive: "holidayActive" },
	holidayAssignment: { __tableName: "holidayAssignment", organizationId: "holidayAssignmentOrg", isActive: "holidayAssignmentActive" },
	holidayPresetAssignment: { __tableName: "holidayPresetAssignment", organizationId: "holidayPresetAssignmentOrg", isActive: "holidayPresetAssignmentActive" },
	implementationChecklistManualState: { organizationId: "manualOrg", itemId: "manualItem", status: "manualStatus" },
	notificationPreference: { __tableName: "notificationPreference", organizationId: "notificationOrg" },
	slackWorkspaceConfig: { __tableName: "slackWorkspaceConfig", organizationId: "slackOrg", setupStatus: "slackStatus" },
	teamsTenantConfig: { __tableName: "teamsTenantConfig", organizationId: "teamsOrg", setupStatus: "teamsStatus" },
	telegramBotConfig: { __tableName: "telegramBotConfig", organizationId: "telegramOrg", setupStatus: "telegramStatus" },
	webhookEndpoint: { __tableName: "webhookEndpoint", organizationId: "webhookOrg", isActive: "webhookActive" },
	workPolicy: { __tableName: "workPolicy", organizationId: "workPolicyOrg", isActive: "workPolicyActive" },
	workPolicyAssignment: { __tableName: "workPolicyAssignment", organizationId: "workPolicyAssignmentOrg", isActive: "workPolicyAssignmentActive" },
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireAccess,
}));

import {
	getImplementationChecklist,
	markImplementationChecklistItemComplete,
	markImplementationChecklistItemIncomplete,
} from "./actions";

describe("implementation checklist actions", () => {
	beforeEach(() => {
		mocks.conditions = [];
		mocks.counts = new Map();
		mocks.manualRows = [];
		mocks.insertValues = undefined;
		mocks.deleteWhere = undefined;
		mocks.revalidatePath.mockReset();
		mocks.requireAccess.mockReset();
		mocks.requireAccess.mockResolvedValue({
			authContext: { user: { id: "user_1" } },
			organizationId: "org_1",
		});
	});

	it("loads checklist statuses scoped to the active organization", async () => {
		mocks.counts.set("holiday", 1);
		mocks.counts.set("workPolicy", 1);
		mocks.counts.set("employee", 2);
		mocks.manualRows = [{ itemId: "approval-rules", status: "complete" }];

		const result = await getImplementationChecklist();

		expect(result.completedCount).toBe(4);
		expect(result.totalCount).toBe(8);
		expect(result.items.find((item) => item.id === "holidays")?.status).toBe("complete");
		expect(result.items.find((item) => item.id === "approval-rules")?.completionSource).toBe("manual");
		expect(mocks.conditions).toContainEqual({ eq: ["manualOrg", "org_1"] });
	});

	it("rejects invalid manual item ids", async () => {
		const result = await markImplementationChecklistItemComplete("holidays");

		expect(result).toEqual({ success: false, error: "This checklist item cannot be completed manually." });
		expect(mocks.insertValues).toBeUndefined();
	});

	it("upserts manual completion scoped to the active organization", async () => {
		const result = await markImplementationChecklistItemComplete("approval-rules");

		expect(result).toEqual({ success: true });
		expect(mocks.insertValues).toMatchObject({
			organizationId: "org_1",
			itemId: "approval-rules",
			status: "complete",
			completedByUserId: "user_1",
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/implementation-checklist");
	});

	it("deletes manual completion scoped to the active organization", async () => {
		const result = await markImplementationChecklistItemIncomplete("approval-rules");

		expect(result).toEqual({ success: true });
		expect(mocks.conditions).toContainEqual({ eq: ["manualOrg", "org_1"] });
		expect(mocks.conditions).toContainEqual({ eq: ["manualItem", "approval-rules"] });
		expect(mocks.deleteWhere).toBeDefined();
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/implementation-checklist");
	});
});
```

- [ ] **Step 2: Run failing action tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts'
```

Expected: FAIL because `actions.ts` does not exist.

- [ ] **Step 3: Add server actions and loader**

Create `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.ts` with:

```ts
"use server";

import { and, count, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	discordBotConfig,
	employee,
	holiday,
	holidayAssignment,
	holidayPresetAssignment,
	implementationChecklistManualState,
	notificationPreference,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
	webhookEndpoint,
	workPolicy,
	workPolicyAssignment,
} from "@/db/schema";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	isImplementationChecklistItemId,
	type ImplementationChecklistItemId,
} from "@/lib/implementation-checklist/definition";
import {
	resolveImplementationChecklistItems,
	type ResolvedImplementationChecklistItem,
} from "@/lib/implementation-checklist/status";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

const IMPLEMENTATION_CHECKLIST_PATH = "/settings/implementation-checklist";

export interface ImplementationChecklistViewModel {
	items: ResolvedImplementationChecklistItem[];
	completedCount: number;
	totalCount: number;
}

export interface ImplementationChecklistActionResult {
	success: boolean;
	error?: string;
}

async function hasAny(tableName: string, query: Promise<Array<{ value: number }>>): Promise<boolean> {
	try {
		const [row] = await query;
		return (row?.value ?? 0) > 0;
	} catch {
		return false;
	}
}

async function getDetectedCompleteIds(
	organizationId: string,
	userId: string,
): Promise<Set<ImplementationChecklistItemId>> {
	const detected = new Set<ImplementationChecklistItemId>();

	const [hasCustomHolidays, hasHolidayAssignments, hasHolidayPresetAssignments] = await Promise.all([
		hasAny(
			"holiday",
			db
				.select({ value: count() })
				.from(holiday)
				.where(and(eq(holiday.organizationId, organizationId), eq(holiday.isActive, true))),
		),
		hasAny(
			"holidayAssignment",
			db
				.select({ value: count() })
				.from(holidayAssignment)
				.where(
					and(eq(holidayAssignment.organizationId, organizationId), eq(holidayAssignment.isActive, true)),
				),
		),
		hasAny(
			"holidayPresetAssignment",
			db
				.select({ value: count() })
				.from(holidayPresetAssignment)
				.where(
					and(
						eq(holidayPresetAssignment.organizationId, organizationId),
						eq(holidayPresetAssignment.isActive, true),
					),
				),
		),
	]);

	if (hasCustomHolidays || hasHolidayAssignments || hasHolidayPresetAssignments) {
		detected.add("holidays");
	}

	const [hasWorkPolicies, hasWorkPolicyAssignments] = await Promise.all([
		hasAny(
			"workPolicy",
			db
				.select({ value: count() })
				.from(workPolicy)
				.where(and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.isActive, true))),
		),
		hasAny(
			"workPolicyAssignment",
			db
				.select({ value: count() })
				.from(workPolicyAssignment)
				.where(
					and(eq(workPolicyAssignment.organizationId, organizationId), eq(workPolicyAssignment.isActive, true)),
				),
		),
	]);

	if (hasWorkPolicies || hasWorkPolicyAssignments) {
		detected.add("work-policies");
	}

	const [hasSlack, hasDiscord, hasTeams, hasTelegram, hasWebhook] = await Promise.all([
		hasAny(
			"slackWorkspaceConfig",
			db
				.select({ value: count() })
				.from(slackWorkspaceConfig)
				.where(
					and(eq(slackWorkspaceConfig.organizationId, organizationId), eq(slackWorkspaceConfig.setupStatus, "active")),
				),
		),
		hasAny(
			"discordBotConfig",
			db
				.select({ value: count() })
				.from(discordBotConfig)
				.where(and(eq(discordBotConfig.organizationId, organizationId), eq(discordBotConfig.setupStatus, "active"))),
		),
		hasAny(
			"teamsTenantConfig",
			db
				.select({ value: count() })
				.from(teamsTenantConfig)
				.where(and(eq(teamsTenantConfig.organizationId, organizationId), eq(teamsTenantConfig.setupStatus, "active"))),
		),
		hasAny(
			"telegramBotConfig",
			db
				.select({ value: count() })
				.from(telegramBotConfig)
				.where(and(eq(telegramBotConfig.organizationId, organizationId), eq(telegramBotConfig.setupStatus, "active"))),
		),
		hasAny(
			"webhookEndpoint",
			db
				.select({ value: count() })
				.from(webhookEndpoint)
				.where(and(eq(webhookEndpoint.organizationId, organizationId), eq(webhookEndpoint.isActive, true))),
		),
	]);

	if (hasSlack || hasDiscord || hasTeams || hasTelegram || hasWebhook) {
		detected.add("integrations");
		detected.add("notifications");
	}

	const hasNotificationPreferences = await hasAny(
		"notificationPreference",
		db
			.select({ value: count() })
			.from(notificationPreference)
			.where(eq(notificationPreference.organizationId, organizationId)),
	);

	if (hasNotificationPreferences) {
		detected.add("notifications");
	}

	const hasImportedEmployees = await hasAny(
		"employee",
		db
			.select({ value: count() })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
					ne(employee.userId, userId),
				),
			),
	);

	if (hasImportedEmployees) {
		detected.add("employee-import");
	}

	return detected;
}

function isManualChecklistItemId(itemId: string): itemId is ImplementationChecklistItemId {
	return (
		isImplementationChecklistItemId(itemId) &&
		IMPLEMENTATION_CHECKLIST_ITEMS.some((item) => item.id === itemId && item.canManualComplete)
	);
}

export async function getImplementationChecklist(): Promise<ImplementationChecklistViewModel> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const [detectedCompleteIds, manualRows] = await Promise.all([
		getDetectedCompleteIds(organizationId, authContext.user.id),
		db.query.implementationChecklistManualState.findMany({
			where: and(eq(implementationChecklistManualState.organizationId, organizationId)),
		}),
	]);
	const manualCompleteIds = new Set<ImplementationChecklistItemId>(
		manualRows
			.filter((row) => row.status === "complete" && isImplementationChecklistItemId(row.itemId))
			.map((row) => row.itemId as ImplementationChecklistItemId),
	);
	const items = resolveImplementationChecklistItems({ detectedCompleteIds, manualCompleteIds });

	return {
		items,
		completedCount: items.filter((item) => item.status === "complete").length,
		totalCount: items.length,
	};
}

export async function markImplementationChecklistItemComplete(
	itemId: string,
): Promise<ImplementationChecklistActionResult> {
	if (!isManualChecklistItemId(itemId)) {
		return { success: false, error: "This checklist item cannot be completed manually." };
	}

	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const completedAt = new Date();

	await db
		.insert(implementationChecklistManualState)
		.values({
			organizationId,
			itemId,
			status: "complete",
			completedAt,
			completedByUserId: authContext.user.id,
		})
		.onConflictDoUpdate({
			target: [
				implementationChecklistManualState.organizationId,
				implementationChecklistManualState.itemId,
			],
			set: {
				status: "complete",
				completedAt,
				completedByUserId: authContext.user.id,
			},
		});

	revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);

	return { success: true };
}

export async function markImplementationChecklistItemIncomplete(
	itemId: string,
): Promise<ImplementationChecklistActionResult> {
	if (!isManualChecklistItemId(itemId)) {
		return { success: false, error: "This checklist item cannot be changed manually." };
	}

	const { organizationId } = await requireOrgAdminSettingsAccess();

	await db
		.delete(implementationChecklistManualState)
		.where(
			and(
				eq(implementationChecklistManualState.organizationId, organizationId),
				eq(implementationChecklistManualState.itemId, itemId),
			),
		);

	revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);

	return { success: true };
}
```

- [ ] **Step 4: Run action tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts'
```

Expected: PASS. If TypeScript reports the mocked Drizzle query shape differs from the runtime query shape, adjust the test mock only; keep production queries org-scoped.

- [ ] **Step 5: Commit Task 3**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts'
git commit -m "feat: resolve implementation checklist state"
```

## Task 4: Add Checklist Page And Client UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.tsx`

- [ ] **Step 1: Add route page**

Create `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/page.tsx` with:

```tsx
import { connection } from "next/server";
import { getImplementationChecklist } from "./actions";
import { ImplementationChecklistClient } from "./implementation-checklist-client";

export default async function ImplementationChecklistPage() {
	await connection();

	const checklist = await getImplementationChecklist();

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-5xl">
				<ImplementationChecklistClient checklist={checklist} />
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Add client renderer**

Create `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.tsx` with:

```tsx
"use client";

import { IconCheck, IconCircle, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import type { ImplementationChecklistViewModel } from "./actions";
import {
	markImplementationChecklistItemComplete,
	markImplementationChecklistItemIncomplete,
} from "./actions";

interface ImplementationChecklistClientProps {
	checklist: ImplementationChecklistViewModel;
}

export function ImplementationChecklistClient({ checklist }: ImplementationChecklistClientProps) {
	const { t } = useTranslate();
	const [pendingItemId, setPendingItemId] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const progress = checklist.totalCount > 0 ? (checklist.completedCount / checklist.totalCount) * 100 : 0;

	function toggleManualCompletion(itemId: string, isComplete: boolean) {
		setPendingItemId(itemId);
		startTransition(async () => {
			const result = isComplete
				? await markImplementationChecklistItemIncomplete(itemId)
				: await markImplementationChecklistItemComplete(itemId);

			if (!result.success) {
				toast.error(result.error ?? "Failed to update checklist item");
			}

			setPendingItemId(null);
		});
	}

	return (
		<div className="space-y-6">
			<div className="space-y-3">
				<div className="space-y-2">
					<p className="text-sm font-medium text-primary">
						{t("settings.implementationChecklist.eyebrow", "Customer implementation")}
					</p>
					<h1 className="text-3xl font-semibold tracking-tight">
						{t("settings.implementationChecklist.title", "Implementation checklist")}
					</h1>
					<p className="max-w-3xl text-muted-foreground">
						{t(
							"settings.implementationChecklist.description",
							"Finish these setup areas before inviting the full team. Z8 checks what it can and lets admins confirm the operational decisions that need human review.",
						)}
					</p>
				</div>

				<Card>
					<CardHeader className="pb-3">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<CardTitle className="text-xl">
									{checklist.completedCount} {t("settings.implementationChecklist.of", "of")} {checklist.totalCount} {t("settings.implementationChecklist.complete", "complete")}
								</CardTitle>
								<CardDescription>
									{t("settings.implementationChecklist.progressDescription", "Rollout readiness across core setup areas")}
								</CardDescription>
							</div>
							<Badge variant="outline">{Math.round(progress)}%</Badge>
						</div>
					</CardHeader>
					<CardContent>
						<Progress value={progress} aria-label="Implementation checklist progress" />
					</CardContent>
				</Card>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				{checklist.items.map((item) => {
					const isComplete = item.status === "complete";
					const itemPending = isPending && pendingItemId === item.id;

					return (
						<Card key={item.id} className={cn(isComplete && "border-primary/30 bg-primary/5")}>
							<CardHeader className="space-y-3">
								<div className="flex items-start justify-between gap-4">
									<div className="flex items-start gap-3">
										<div
											className={cn(
												"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
												isComplete ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
											)}
										>
											{isComplete ? <IconCheck className="size-4" /> : <IconCircle className="size-4" />}
										</div>
										<div>
											<CardTitle className="text-lg">{item.title}</CardTitle>
											<CardDescription className="mt-1.5">{item.description}</CardDescription>
										</div>
									</div>
									<Badge variant={isComplete ? "default" : "secondary"}>
										{isComplete ? "Complete" : item.canToggleManualCompletion ? "Review needed" : "Not started"}
									</Badge>
								</div>
							</CardHeader>
							<CardContent className="space-y-4">
								<p className="text-sm text-muted-foreground">{item.helperText}</p>
								<div className="flex flex-col gap-2 sm:flex-row">
									<Button asChild>
										<Link href={item.href}>{item.actionLabel}</Link>
									</Button>
									{item.canToggleManualCompletion && (
										<Button
											variant="outline"
											onClick={() => toggleManualCompletion(item.id, isComplete)}
											disabled={itemPending}
										>
											{itemPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
											{isComplete ? "Mark incomplete" : "Mark complete"}
										</Button>
									)}
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Verify page type checks via tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts' src/lib/implementation-checklist/status.test.ts
```

Expected: PASS. If `Progress` import path does not exist, inspect `apps/webapp/src/components/ui` and use the existing progress component path; do not create a new progress primitive unless none exists.

- [ ] **Step 4: Commit Task 4**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/page.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.tsx'
git commit -m "feat: add implementation checklist page"
```

## Task 5: Register Settings Entry And Route Access

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/lib/settings-access.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write failing settings visibility assertions**

Modify `apps/webapp/src/components/settings/settings-config.test.ts` by adding this test after the org-admin visibility tests:

```ts
it("shows implementation checklist only for org admins", () => {
	const orgAdminEntries = getVisibleSettings("orgAdmin", true);
	const managerEntries = getVisibleSettings("manager", true);
	const memberEntries = getVisibleSettings("member", true);

	expect(orgAdminEntries.find((entry) => entry.id === "implementation-checklist")).toMatchObject({
		titleDefault: "Implementation Checklist",
		href: "/settings/implementation-checklist",
		minimumTier: "orgAdmin",
		group: "administration",
	});
	expect(managerEntries.some((entry) => entry.id === "implementation-checklist")).toBe(false);
	expect(memberEntries.some((entry) => entry.id === "implementation-checklist")).toBe(false);
});
```

Modify `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`:

1. Add `"implementation-checklist/page.tsx"` to `ORG_ADMIN_ROUTE_FILES`.
2. Add `"/settings/implementation-checklist"` to the expected `ORG_ADMIN_SETTINGS_ROUTES` array.
3. Add this assertion inside the manager access test:

```ts
expect(canResolvedTierAccessRoute(managerTier, "/settings/implementation-checklist")).toBe(false);
```

- [ ] **Step 2: Run failing settings tests**

Run:

```bash
pnpm --filter webapp test src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: FAIL because the settings entry and org-admin route list are not registered yet.

- [ ] **Step 3: Register org-admin route**

Modify `apps/webapp/src/lib/settings-access.ts` and add the route near other org-admin settings routes:

```ts
"/settings/implementation-checklist",
```

- [ ] **Step 4: Register settings grid entry**

Modify `apps/webapp/src/components/settings/settings-config.ts`:

1. Add a new `SettingsEntry` object in `SETTINGS_ENTRIES` under the Administration group, near similar rollout/admin entries:

```ts
{
	id: "implementation-checklist",
	titleKey: "settings.implementationChecklist.title",
	titleDefault: "Implementation Checklist",
	descriptionKey: "settings.implementationChecklist.description",
	descriptionDefault: "Track customer rollout setup across policies, payroll, integrations, and employee import",
	href: "/settings/implementation-checklist",
	icon: "target",
	minimumTier: "orgAdmin",
	group: "administration",
},
```

2. Do not add a new icon unless `target` is visually unsuitable after review; it already exists in `SettingsIconName` and `SETTINGS_ICON_MAP`.

- [ ] **Step 5: Run settings tests**

Run:

```bash
pnpm --filter webapp test src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/lib/settings-access.ts apps/webapp/src/components/settings/settings-config.test.ts 'apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
git commit -m "feat: register implementation checklist settings"
```

## Task 6: Final Verification And Polish

**Files:**
- Review all files touched in Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp test src/lib/implementation-checklist/status.test.ts 'src/app/[locale]/(app)/settings/implementation-checklist/actions.test.ts' src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run broader webapp tests**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS. If unrelated pre-existing tests fail, capture the failing test names and confirm whether they touch implementation checklist files before changing code.

- [ ] **Step 3: Review route isolation**

Open `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/page.tsx` and confirm it imports only app settings helpers and does not import anything from `platform-admin`, `(admin)`, or `(setup)` routes.

Expected: no platform-admin setup wizard imports.

- [ ] **Step 4: Review multi-tenancy constraints**

Open `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/actions.ts` and confirm every detector query includes `organizationId` and manual writes/deletes use `organizationId` from `requireOrgAdminSettingsAccess()`.

Expected: no unscoped checklist reads or writes.

- [ ] **Step 5: Commit final polish if needed**

If Step 3 or Step 4 required any edits, commit them:

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist apps/webapp/src/lib/implementation-checklist apps/webapp/src/db/schema apps/webapp/src/components/settings apps/webapp/src/lib/settings-access.ts
git commit -m "fix: harden implementation checklist access"
```

If no edits were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: The plan covers the settings route, Administration settings entry, org-admin-only access, org-scoped manual state, hybrid automatic/manual status, guide-only UI, detector failure-closed behavior, and tests.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `ImplementationChecklistItemId`, `ResolvedImplementationChecklistItem`, and `ImplementationChecklistViewModel` are introduced before downstream usage and reused consistently.
