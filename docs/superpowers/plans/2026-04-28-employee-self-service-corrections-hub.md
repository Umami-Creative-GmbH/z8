# Employee Self-Service Corrections Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new employee-facing `My Requests` page that consolidates the active employee's pending requests, rejected required-fix items, and recent approval decisions across time corrections, absences, and travel expenses.

**Architecture:** Add a focused self-service request query module under `apps/webapp/src/lib/self-service-requests` with source adapters for existing tables. Render a server-side page at `apps/webapp/src/app/[locale]/(app)/my-requests/page.tsx` using a reusable client display component, and add a primary sidebar entry.

**Tech Stack:** Next.js app router, React 19, TypeScript, Drizzle ORM, Vitest, Testing Library, Luxon, existing shadcn/ui components, existing `pnpm` scripts.

---

## File Structure

- Create: `apps/webapp/src/lib/self-service-requests/types.ts`
  Defines normalized statuses, source types, actions, items, counts, filters, and result types.
- Create: `apps/webapp/src/lib/self-service-requests/get-self-service-requests.ts`
  Contains all source adapter queries, mapping, sorting, filtering, and summary count logic.
- Create: `apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts`
  Unit tests for scoping, mapping, sorting, filtering, partial failures, and counts.
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/actions.ts`
  Server actions that resolve the authenticated employee and call the self-service request query service. Also wraps absence cancellation for the page.
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/page.tsx`
  Server page that resolves data and renders empty/unavailable states through the page component.
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
  Client component for summary cards, needs-attention list, filters, table, and action links.
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`
  UI tests for buckets, empty states, filtering, action availability, and degraded source notices.
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
  Add `My Requests` as a primary personal navigation item.
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`
  Assert the new primary navigation entry is passed to `NavMain`.

## Task 1: Self-Service Request Types

**Files:**
- Create: `apps/webapp/src/lib/self-service-requests/types.ts`
- Test: types are exercised by Task 2 tests.

- [ ] **Step 1: Create the normalized type file**

Create `apps/webapp/src/lib/self-service-requests/types.ts` with this content:

```ts
export type SelfServiceRequestSourceType = "time_correction" | "absence" | "travel_expense";

export type SelfServiceRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type SelfServiceRequestAction = "view" | "fix" | "cancel";

export interface SelfServiceRequestItem {
	id: string;
	sourceType: SelfServiceRequestSourceType;
	sourceId: string;
	organizationId: string;
	employeeId: string;
	status: SelfServiceRequestStatus;
	submittedAt: Date;
	resolvedAt: Date | null;
	title: string;
	subtitle: string;
	decisionReason: string | null;
	availableActions: SelfServiceRequestAction[];
	sourceHref: string;
}

export interface SelfServiceRequestCounts {
	pending: number;
	requiredFixes: number;
	recentDecisions: number;
	total: number;
}

export interface SelfServiceRequestFilters {
	status?: SelfServiceRequestStatus | "all";
	sourceType?: SelfServiceRequestSourceType | "all";
	search?: string;
}

export interface SelfServiceRequestSourceError {
	sourceType: SelfServiceRequestSourceType;
	message: string;
}

export interface SelfServiceRequestResult {
	items: SelfServiceRequestItem[];
	counts: SelfServiceRequestCounts;
	sourceErrors: SelfServiceRequestSourceError[];
}
```

- [ ] **Step 2: Run typecheck through focused tests after Task 2 exists**

Run this after Task 2 creates tests:

```bash
pnpm --filter webapp test src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts
```

Expected now: tests do not exist yet or fail until Task 2 adds them.

- [ ] **Step 3: Commit the type contract**

```bash
git add apps/webapp/src/lib/self-service-requests/types.ts
git commit -m "feat: add self-service request types"
```

## Task 2: Query Service And Source Adapters

**Files:**
- Create: `apps/webapp/src/lib/self-service-requests/get-self-service-requests.ts`
- Create: `apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
	approvalRequests: vi.fn(),
	absenceEntries: vi.fn(),
	travelExpenseClaims: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	desc: vi.fn((column: unknown) => ({ direction: "desc", column })),
	eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
	gte: vi.fn((left: unknown, right: unknown) => ({ op: "gte", left, right })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findMany: dbMocks.approvalRequests },
			absenceEntry: { findMany: dbMocks.absenceEntries },
			travelExpenseClaim: { findMany: dbMocks.travelExpenseClaims },
		},
	},
}));

import { getSelfServiceRequests } from "../get-self-service-requests";

function timeCorrection(overrides: Record<string, unknown> = {}) {
	return {
		id: "approval-time-1",
		entityId: "period-1",
		organizationId: "org-1",
		requestedBy: "employee-1",
		status: "pending",
		createdAt: new Date("2026-04-25T08:00:00.000Z"),
		approvedAt: null,
		rejectionReason: null,
		entity: {
			id: "period-1",
			startTime: new Date("2026-04-24T08:00:00.000Z"),
			endTime: new Date("2026-04-24T16:00:00.000Z"),
		},
		...overrides,
	};
}

function absence(overrides: Record<string, unknown> = {}) {
	return {
		id: "absence-1",
		employeeId: "employee-1",
		organizationId: "org-1",
		status: "rejected",
		startDate: "2026-04-20",
		endDate: "2026-04-21",
		rejectionReason: "Coverage needed",
		approvedAt: new Date("2026-04-22T10:00:00.000Z"),
		createdAt: new Date("2026-04-18T09:00:00.000Z"),
		category: { name: "Vacation", type: "vacation", color: null },
		...overrides,
	};
}

function travelExpense(overrides: Record<string, unknown> = {}) {
	return {
		id: "claim-1",
		employeeId: "employee-1",
		organizationId: "org-1",
		type: "receipt",
		status: "approved",
		tripStart: new Date("2026-04-14T00:00:00.000Z"),
		tripEnd: new Date("2026-04-15T00:00:00.000Z"),
		destinationCity: "Berlin",
		destinationCountry: "DE",
		calculatedAmount: "42.50",
		calculatedCurrency: "EUR",
		submittedAt: new Date("2026-04-16T08:00:00.000Z"),
		decidedAt: new Date("2026-04-17T08:00:00.000Z"),
		createdAt: new Date("2026-04-16T07:00:00.000Z"),
		decisionLogs: [],
		...overrides,
	};
}

describe("getSelfServiceRequests", () => {
	beforeEach(() => {
		dbMocks.approvalRequests.mockReset();
		dbMocks.absenceEntries.mockReset();
		dbMocks.travelExpenseClaims.mockReset();
		dbMocks.approvalRequests.mockResolvedValue([timeCorrection()]);
		dbMocks.absenceEntries.mockResolvedValue([absence()]);
		dbMocks.travelExpenseClaims.mockResolvedValue([travelExpense()]);
	});

	it("maps mixed request sources into one employee-scoped result", async () => {
		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.items).toHaveLength(3);
		expect(result.items.map((item) => item.sourceType)).toEqual([
			"absence",
			"time_correction",
			"travel_expense",
		]);
		expect(result.counts).toEqual({ pending: 1, requiredFixes: 1, recentDecisions: 2, total: 3 });
		expect(result.sourceErrors).toEqual([]);
	});

	it("filters by status, source type, and search text", async () => {
		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
			filters: { status: "rejected", sourceType: "absence", search: "coverage" },
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({ sourceType: "absence", status: "rejected" });
	});

	it("excludes decisions outside the 30 day recent window from recent decision count", async () => {
		dbMocks.travelExpenseClaims.mockResolvedValue([
			travelExpense({ decidedAt: new Date("2026-02-01T08:00:00.000Z") }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.counts.recentDecisions).toBe(1);
	});

	it("returns partial data with a source error when one adapter fails", async () => {
		dbMocks.travelExpenseClaims.mockRejectedValue(new Error("database unavailable"));

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.items.map((item) => item.sourceType)).toEqual(["absence", "time_correction"]);
		expect(result.sourceErrors).toEqual([
			{ sourceType: "travel_expense", message: "Travel expense requests could not be loaded." },
		]);
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm --filter webapp test src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts
```

Expected: FAIL because `../get-self-service-requests` does not exist.

- [ ] **Step 3: Implement the query service**

Create `apps/webapp/src/lib/self-service-requests/get-self-service-requests.ts`:

```ts
import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceEntry, approvalRequest, travelExpenseClaim } from "@/db/schema";
import type {
	SelfServiceRequestCounts,
	SelfServiceRequestFilters,
	SelfServiceRequestItem,
	SelfServiceRequestResult,
	SelfServiceRequestSourceError,
	SelfServiceRequestSourceType,
	SelfServiceRequestStatus,
} from "./types";

const RECENT_DECISION_DAYS = 30;

interface GetSelfServiceRequestsInput {
	employeeId: string;
	organizationId: string;
	filters?: SelfServiceRequestFilters;
	now?: Date;
}

type AdapterResult = {
	sourceType: SelfServiceRequestSourceType;
	items: SelfServiceRequestItem[];
};

function normalizeApprovalStatus(status: string): SelfServiceRequestStatus {
	if (status === "approved" || status === "rejected" || status === "cancelled") {
		return status;
	}

	return "pending";
}

function normalizeTravelExpenseStatus(status: string): SelfServiceRequestStatus {
	if (status === "approved" || status === "rejected") {
		return status;
	}

	return "pending";
}

function requestRank(item: SelfServiceRequestItem): number {
	if (item.status === "rejected") return 0;
	if (item.status === "pending") return 1;
	return 2;
}

function sortRequests(a: SelfServiceRequestItem, b: SelfServiceRequestItem): number {
	const rankDiff = requestRank(a) - requestRank(b);
	if (rankDiff !== 0) return rankDiff;

	const aDate = a.resolvedAt ?? a.submittedAt;
	const bDate = b.resolvedAt ?? b.submittedAt;
	return bDate.getTime() - aDate.getTime();
}

function matchesFilters(item: SelfServiceRequestItem, filters: SelfServiceRequestFilters = {}) {
	if (filters.status && filters.status !== "all" && item.status !== filters.status) return false;
	if (filters.sourceType && filters.sourceType !== "all" && item.sourceType !== filters.sourceType) {
		return false;
	}

	if (filters.search) {
		const search = filters.search.toLowerCase();
		const haystack = [item.title, item.subtitle, item.decisionReason ?? ""].join(" ").toLowerCase();
		return haystack.includes(search);
	}

	return true;
}

function isRecentDecision(item: SelfServiceRequestItem, now: Date) {
	if (item.status !== "approved" && item.status !== "rejected") return false;
	if (!item.resolvedAt) return false;

	const cutoff = DateTime.fromJSDate(now).minus({ days: RECENT_DECISION_DAYS }).toJSDate();
	return item.resolvedAt >= cutoff;
}

function buildCounts(items: SelfServiceRequestItem[], now: Date): SelfServiceRequestCounts {
	return {
		pending: items.filter((item) => item.status === "pending").length,
		requiredFixes: items.filter((item) => item.status === "rejected").length,
		recentDecisions: items.filter((item) => isRecentDecision(item, now)).length,
		total: items.length,
	};
}

async function loadTimeCorrections(input: GetSelfServiceRequestsInput): Promise<AdapterResult> {
	const rows = await db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.requestedBy, input.employeeId),
			eq(approvalRequest.entityType, "time_entry"),
		),
		with: {
			entity: true,
		},
		orderBy: [desc(approvalRequest.createdAt)],
	});

	return {
		sourceType: "time_correction",
		items: rows.map((row) => ({
			id: row.id,
			sourceType: "time_correction" as const,
			sourceId: row.entityId,
			organizationId: row.organizationId,
			employeeId: row.requestedBy,
			status: normalizeApprovalStatus(row.status),
			submittedAt: row.createdAt,
			resolvedAt: row.approvedAt,
			title: "Time correction",
			subtitle: "Correction request for a work period",
			decisionReason: row.rejectionReason ?? null,
			availableActions: row.status === "rejected" ? ["view", "fix"] : ["view"],
			sourceHref: "/time-tracking",
		})),
	};
}

async function loadAbsences(input: GetSelfServiceRequestsInput): Promise<AdapterResult> {
	const rows = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.organizationId, input.organizationId),
			eq(absenceEntry.employeeId, input.employeeId),
		),
		with: { category: true },
		orderBy: [desc(absenceEntry.createdAt)],
	});

	return {
		sourceType: "absence",
		items: rows.map((row) => ({
			id: row.id,
			sourceType: "absence" as const,
			sourceId: row.id,
			organizationId: row.organizationId ?? input.organizationId,
			employeeId: row.employeeId,
			status: normalizeApprovalStatus(row.status),
			submittedAt: row.createdAt,
			resolvedAt: row.approvedAt,
			title: row.category?.name ?? "Absence request",
			subtitle: `${row.startDate} - ${row.endDate}`,
			decisionReason: row.rejectionReason ?? null,
			availableActions:
				row.status === "pending" ? ["view", "cancel"] : row.status === "rejected" ? ["view", "fix"] : ["view"],
			sourceHref: "/absences",
		})),
	};
}

async function loadTravelExpenses(input: GetSelfServiceRequestsInput): Promise<AdapterResult> {
	const recentCutoff = DateTime.fromJSDate(input.now ?? new Date()).minus({ days: RECENT_DECISION_DAYS }).toJSDate();
	const rows = await db.query.travelExpenseClaim.findMany({
		where: and(
			eq(travelExpenseClaim.organizationId, input.organizationId),
			eq(travelExpenseClaim.employeeId, input.employeeId),
			gte(travelExpenseClaim.createdAt, recentCutoff),
		),
		with: { decisionLogs: true },
		orderBy: [desc(travelExpenseClaim.createdAt)],
	});

	return {
		sourceType: "travel_expense",
		items: rows.map((row) => {
			const latestDecision = row.decisionLogs?.[0];
			return {
				id: row.id,
				sourceType: "travel_expense" as const,
				sourceId: row.id,
				organizationId: row.organizationId,
				employeeId: row.employeeId,
				status: normalizeTravelExpenseStatus(row.status),
				submittedAt: row.submittedAt ?? row.createdAt,
				resolvedAt: row.decidedAt,
				title: "Travel expense",
				subtitle: `${row.calculatedAmount} ${row.calculatedCurrency}`,
				decisionReason: latestDecision?.reason ?? null,
				availableActions: row.status === "rejected" ? ["view", "fix"] : ["view"],
				sourceHref: "/travel-expenses",
			};
		}),
	};
}

function sourceError(sourceType: SelfServiceRequestSourceType): SelfServiceRequestSourceError {
	const label = sourceType === "travel_expense" ? "Travel expense" : sourceType === "absence" ? "Absence" : "Time correction";
	return { sourceType, message: `${label} requests could not be loaded.` };
}

export async function getSelfServiceRequests(input: GetSelfServiceRequestsInput): Promise<SelfServiceRequestResult> {
	const loaders = [loadTimeCorrections, loadAbsences, loadTravelExpenses];
	const settled = await Promise.allSettled(loaders.map((loader) => loader(input)));
	const sourceErrors: SelfServiceRequestSourceError[] = [];
	const allItems: SelfServiceRequestItem[] = [];

	for (let index = 0; index < settled.length; index++) {
		const result = settled[index];
		if (result.status === "fulfilled") {
			allItems.push(...result.value.items);
		} else {
			const sourceType = index === 0 ? "time_correction" : index === 1 ? "absence" : "travel_expense";
			sourceErrors.push(sourceError(sourceType));
		}
	}

	const sortedItems = allItems.sort(sortRequests);
	const filteredItems = sortedItems.filter((item) => matchesFilters(item, input.filters));

	return {
		items: filteredItems,
		counts: buildCounts(sortedItems, input.now ?? new Date()),
		sourceErrors,
	};
}
```

If TypeScript reports that `approvalRequest` has no `entity` relation, replace the `with: { entity: true }` block with no `with` block and keep the generic time correction subtitle from the snippet. Do not add schema relations in this feature.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter webapp test src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit service and tests**

```bash
git add apps/webapp/src/lib/self-service-requests/get-self-service-requests.ts apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts
git commit -m "feat: add self-service request query service"
```

## Task 3: My Requests Server Actions And Page

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/page.tsx`

- [ ] **Step 1: Create server actions**

Create `apps/webapp/src/app/[locale]/(app)/my-requests/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { cancelAbsenceRequestForEmployee } from "@/app/[locale]/(app)/absences/actions";
import { getAuthContext } from "@/lib/auth-helpers";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";
import type { SelfServiceRequestFilters, SelfServiceRequestResult } from "@/lib/self-service-requests/types";

export async function getMyRequests(filters?: SelfServiceRequestFilters): Promise<{
	success: true;
	data: SelfServiceRequestResult;
} | {
	success: false;
	error: string;
}> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const data = await getSelfServiceRequests({
			employeeId: authContext.employee.id,
			organizationId: authContext.employee.organizationId,
			filters,
		});

		return { success: true, data };
	} catch {
		return { success: false, error: "Requests could not be loaded." };
	}
}

export async function cancelMyAbsenceRequest(absenceId: string): Promise<{ success: boolean; error?: string }> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Employee profile not found" };
	}

	const result = await cancelAbsenceRequestForEmployee(absenceId, {
		id: authContext.employee.id,
		organizationId: authContext.employee.organizationId,
	});

	if (result.success) {
		revalidatePath("/my-requests");
		revalidatePath("/absences");
	}

	return result;
}
```

- [ ] **Step 2: Create the server page**

Create `apps/webapp/src/app/[locale]/(app)/my-requests/page.tsx`:

```tsx
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getTranslate } from "@/tolgee/server";
import { getMyRequests } from "./actions";
import { MyRequestsClient } from "./my-requests-client";

export default async function MyRequestsPage() {
	await connection();

	const [t, result] = await Promise.all([getTranslate(), getMyRequests()]);

	if (!result.success && result.error === "Employee profile not found") {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("myRequests.featureName", "view your requests")} />
			</div>
		);
	}

	if (!result.success) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
				<Alert variant="destructive">
					<AlertTitle>{t("myRequests.unavailableTitle", "Requests unavailable")}</AlertTitle>
					<AlertDescription>{result.error}</AlertDescription>
				</Alert>
			</div>
		);
	}

	return <MyRequestsClient initialResult={result.data} />;
}
```

- [ ] **Step 3: Run page-related tests after Task 4 adds the client test**

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected before Task 4: FAIL because the client component test does not exist.

- [ ] **Step 4: Commit server entry points**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/my-requests/actions.ts' 'apps/webapp/src/app/[locale]/(app)/my-requests/page.tsx'
git commit -m "feat: add my requests server page"
```

## Task 4: My Requests UI Component

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelfServiceRequestResult } from "@/lib/self-service-requests/types";

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

import { MyRequestsClient } from "./my-requests-client";

function createResult(overrides: Partial<SelfServiceRequestResult> = {}): SelfServiceRequestResult {
	return {
		counts: { pending: 1, requiredFixes: 1, recentDecisions: 1, total: 3 },
		sourceErrors: [],
		items: [
			{
				id: "absence-1",
				sourceType: "absence",
				sourceId: "absence-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				status: "rejected",
				submittedAt: new Date("2026-04-18T09:00:00.000Z"),
				resolvedAt: new Date("2026-04-22T10:00:00.000Z"),
				title: "Vacation",
				subtitle: "2026-04-20 - 2026-04-21",
				decisionReason: "Coverage needed",
				availableActions: ["view", "fix"],
				sourceHref: "/absences",
			},
			{
				id: "time-1",
				sourceType: "time_correction",
				sourceId: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				status: "pending",
				submittedAt: new Date("2026-04-25T08:00:00.000Z"),
				resolvedAt: null,
				title: "Time correction",
				subtitle: "Correction request for a work period",
				decisionReason: null,
				availableActions: ["view"],
				sourceHref: "/time-tracking",
			},
			{
				id: "claim-1",
				sourceType: "travel_expense",
				sourceId: "claim-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				status: "approved",
				submittedAt: new Date("2026-04-16T08:00:00.000Z"),
				resolvedAt: new Date("2026-04-17T08:00:00.000Z"),
				title: "Travel expense",
				subtitle: "42.50 EUR",
				decisionReason: null,
				availableActions: ["view"],
				sourceHref: "/travel-expenses",
			},
		],
		...overrides,
	};
}

describe("MyRequestsClient", () => {
	beforeEach(() => vi.clearAllMocks());

	it("renders summary cards, needs-attention items, and unified rows", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		expect(screen.getByRole("heading", { name: "My Requests" })).toBeTruthy();
		expect(screen.getByText("Pending")).toBeTruthy();
		expect(screen.getByText("Required fixes")).toBeTruthy();
		expect(screen.getByText("Coverage needed")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Fix" }).getAttribute("href")).toBe("/absences");
		expect(screen.getByText("Time correction")).toBeTruthy();
		expect(screen.getByText("Travel expense")).toBeTruthy();
	});

	it("filters by status", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });

		expect(screen.getByText("Time correction")).toBeTruthy();
		expect(screen.queryByText("Vacation")).toBeNull();
	});

	it("shows source error notices", () => {
		render(
			<MyRequestsClient
				initialResult={createResult({
					sourceErrors: [{ sourceType: "travel_expense", message: "Travel expense requests could not be loaded." }],
				})}
			/>,
		);

		expect(screen.getByText("Some requests could not be loaded."));
		expect(screen.getByText("Travel expense requests could not be loaded."));
	});

	it("distinguishes empty and filtered-empty states", () => {
		const { rerender } = render(<MyRequestsClient initialResult={createResult({ items: [], counts: { pending: 0, requiredFixes: 0, recentDecisions: 0, total: 0 } })} />);
		expect(screen.getByText("No requests yet")).toBeTruthy();

		rerender(<MyRequestsClient initialResult={createResult()} />);
		fireEvent.change(screen.getByLabelText("Search"), { target: { value: "does-not-match" } });
		expect(screen.getByText("No requests match your filters"));
	});

	it("does not render unsupported actions", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		const timeRow = screen.getByRole("row", { name: /Time correction/ });
		expect(within(timeRow).queryByRole("link", { name: "Fix" })).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: FAIL because `./my-requests-client` does not exist.

- [ ] **Step 3: Implement the UI component**

Create `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`:

```tsx
"use client";

import { IconAlertTriangle, IconCheck, IconClock, IconFileDescription } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SelfServiceRequestItem, SelfServiceRequestResult, SelfServiceRequestSourceType, SelfServiceRequestStatus } from "@/lib/self-service-requests/types";
import { Link } from "@/navigation";

interface MyRequestsClientProps {
	initialResult: SelfServiceRequestResult;
}

const sourceLabels: Record<SelfServiceRequestSourceType, string> = {
	time_correction: "Time correction",
	absence: "Absence",
	travel_expense: "Travel expense",
};

function formatDate(date: Date | string | null) {
	if (!date) return "-";
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
}

function matchesFilter(item: SelfServiceRequestItem, status: string, sourceType: string, search: string) {
	if (status !== "all" && item.status !== status) return false;
	if (sourceType !== "all" && item.sourceType !== sourceType) return false;
	if (!search) return true;

	const haystack = [item.title, item.subtitle, item.decisionReason ?? "", sourceLabels[item.sourceType]].join(" ").toLowerCase();
	return haystack.includes(search.toLowerCase());
}

function statusVariant(status: SelfServiceRequestStatus): "default" | "secondary" | "destructive" | "outline" {
	if (status === "approved") return "default";
	if (status === "rejected") return "destructive";
	if (status === "cancelled") return "outline";
	return "secondary";
}

export function MyRequestsClient({ initialResult }: MyRequestsClientProps) {
	const { t } = useTranslate();
	const [status, setStatus] = useState("all");
	const [sourceType, setSourceType] = useState("all");
	const [search, setSearch] = useState("");

	const filteredItems = useMemo(
		() => initialResult.items.filter((item) => matchesFilter(item, status, sourceType, search)),
		[initialResult.items, search, sourceType, status],
	);

	const requiredFixes = initialResult.items.filter((item) => item.status === "rejected");
	const hasFilters = status !== "all" || sourceType !== "all" || search.length > 0;

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<h1 className="text-2xl font-semibold tracking-tight">{t("myRequests.title", "My Requests")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("myRequests.subtitle", "Track pending requests, required fixes, and recent decisions.")}
				</p>
			</div>

			<div className="grid gap-4 px-4 md:grid-cols-2 lg:grid-cols-4 lg:px-6">
				<Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><IconClock className="size-4" />Pending</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{initialResult.counts.pending}</CardContent></Card>
				<Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><IconAlertTriangle className="size-4" />Required fixes</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{initialResult.counts.requiredFixes}</CardContent></Card>
				<Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><IconCheck className="size-4" />Recent decisions</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{initialResult.counts.recentDecisions}</CardContent></Card>
				<Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><IconFileDescription className="size-4" />Total loaded</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{initialResult.counts.total}</CardContent></Card>
			</div>

			{initialResult.sourceErrors.length > 0 && (
				<div className="px-4 lg:px-6">
					<Alert>
						<AlertTitle>{t("myRequests.partialTitle", "Some requests could not be loaded.")}</AlertTitle>
						<AlertDescription>{initialResult.sourceErrors.map((error) => error.message).join(" ")}</AlertDescription>
					</Alert>
				</div>
			)}

			{requiredFixes.length > 0 && (
				<section className="space-y-3 px-4 lg:px-6" aria-labelledby="needs-attention-heading">
					<h2 id="needs-attention-heading" className="text-lg font-semibold">Needs attention</h2>
					<div className="grid gap-3">
						{requiredFixes.map((item) => (
							<Card key={item.id}>
								<CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
									<div>
										<p className="font-medium">{item.title}</p>
										<p className="text-sm text-muted-foreground">{item.decisionReason ?? "No reason provided."}</p>
									</div>
									<Button asChild size="sm"><Link href={item.sourceHref}>{item.availableActions.includes("fix") ? "Fix" : "View"}</Link></Button>
								</CardContent>
							</Card>
						))}
					</div>
				</section>
			)}

			<section className="space-y-4 px-4 lg:px-6" aria-labelledby="all-requests-heading">
				<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
					<div>
						<h2 id="all-requests-heading" className="text-lg font-semibold">All requests</h2>
						<p className="text-sm text-muted-foreground">Filter your request history across supported request types.</p>
					</div>
					<div className="flex flex-col gap-2 md:flex-row">
						<label className="text-sm"><span>Status</span><Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select></label>
						<label className="text-sm"><span>Type</span><Select value={sourceType} onValueChange={setSourceType}><SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="time_correction">Time corrections</SelectItem><SelectItem value="absence">Absences</SelectItem><SelectItem value="travel_expense">Travel expenses</SelectItem></SelectContent></Select></label>
						<label className="text-sm"><span>Search</span><Input aria-label="Search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
					</div>
				</div>

				{initialResult.items.length === 0 ? (
					<Card><CardContent className="py-12 text-center"><p className="text-lg font-medium">No requests yet</p><p className="mt-2 text-sm text-muted-foreground">Your pending requests and recent decisions will appear here.</p></CardContent></Card>
				) : filteredItems.length === 0 ? (
					<Card><CardContent className="py-12 text-center"><p className="text-lg font-medium">No requests match your filters</p><p className="mt-2 text-sm text-muted-foreground">Clear filters to see more requests.</p></CardContent></Card>
				) : (
					<Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Request</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead><TableHead>Decision</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{filteredItems.map((item) => (<TableRow key={item.id}><TableCell>{sourceLabels[item.sourceType]}</TableCell><TableCell><div className="font-medium">{item.title}</div><div className="text-sm text-muted-foreground">{item.subtitle}</div>{item.decisionReason && <div className="text-xs text-muted-foreground">{item.decisionReason}</div>}</TableCell><TableCell><Badge variant={statusVariant(item.status)}>{item.status}</Badge></TableCell><TableCell>{formatDate(item.submittedAt)}</TableCell><TableCell>{formatDate(item.resolvedAt)}</TableCell><TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={item.sourceHref}>{item.availableActions.includes("fix") ? "Fix" : "View"}</Link></Button></TableCell></TableRow>))}</TableBody></Table></CardContent></Card>
				)}
			</section>
		</div>
	);
}
```

If the project `Select` test environment does not support native `fireEvent.change` on Radix Select, simplify this component to use native `<select>` elements for these filters. Prefer passing tests and accessible labels over preserving Radix Select for this small page.

- [ ] **Step 4: Run UI tests**

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit UI component and tests**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx' 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
git commit -m "feat: add my requests hub UI"
```

## Task 5: Sidebar Navigation

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Update the sidebar test mock to inspect primary nav**

In `apps/webapp/src/components/app-sidebar.test.tsx`, add a `navMainSpy` hoisted mock and update the `NavMain` mock:

```tsx
const { navMainSpy, navSecondarySpy, appSidebarSpy, getUserOrganizationsMock, getAuthContextMock, getCurrentSettingsAccessTierMock } = vi.hoisted(() => ({
	navMainSpy: vi.fn(),
	navSecondarySpy: vi.fn(),
	appSidebarSpy: vi.fn(),
	getUserOrganizationsMock: vi.fn(),
	getAuthContextMock: vi.fn(),
	getCurrentSettingsAccessTierMock: vi.fn(),
}));

vi.mock("@/components/nav-main", () => ({
	NavMain: ({ items }: { items: Array<{ title: string; url: string; icon: unknown }> }) => {
		navMainSpy(items);
		return (
			<nav aria-label="primary">
				{items.map((item) => (
					<a href={item.url} key={item.url}>{item.title}</a>
				))}
			</nav>
		);
	},
}));
```

Add this test inside the existing `describe` block:

```tsx
it("renders My Requests as a primary personal navigation item", () => {
	render(<AppSidebar />);

	expect(screen.getByRole("link", { name: "My Requests" }).getAttribute("href")).toBe("/my-requests");
	expect(navMainSpy).toHaveBeenLastCalledWith(
		expect.arrayContaining([
			expect.objectContaining({ title: "My Requests", url: "/my-requests" }),
		]),
	);
});
```

- [ ] **Step 2: Run the sidebar test to verify failure**

```bash
pnpm --filter webapp test src/components/app-sidebar.test.tsx
```

Expected: FAIL because `My Requests` is not in `navPersonal`.

- [ ] **Step 3: Add the sidebar item**

In `apps/webapp/src/components/app-sidebar.tsx`, import `IconFileDescription` from `@tabler/icons-react` and add this item after `Time Tracking` in `navPersonal`:

```tsx
{
	title: t("nav.my-requests", "My Requests"),
	url: "/my-requests",
	icon: IconFileDescription,
	dataTour: "nav-my-requests",
},
```

- [ ] **Step 4: Run sidebar tests**

```bash
pnpm --filter webapp test src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit navigation changes**

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "feat: add my requests navigation"
```

## Task 6: Integration Verification And Cleanup

**Files:**
- Review all files changed in Tasks 1-5.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter webapp test src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx' src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader webapp tests if time allows**

```bash
pnpm --filter webapp test
```

Expected: PASS. If unrelated existing failures appear, record the failing test names and confirm focused tests still pass.

- [ ] **Step 3: Run build or explain skipped environment-dependent checks**

```bash
pnpm --filter webapp build
```

Expected: PASS if the local environment has all required system-level variables. If Phase-managed environment variables are required and unavailable to agents, skip the build and report that it was skipped because Phase CLI variables are not available.

- [ ] **Step 4: Inspect final diff**

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional files from this plan are changed, plus any unrelated pre-existing worktree changes left untouched.

- [ ] **Step 5: Final commit if verification caused changes**

Only run this if verification or cleanup changed tracked files after the previous task commits:

```bash
git add apps/webapp/src/lib/self-service-requests apps/webapp/src/app/[locale]/\(app\)/my-requests apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "fix: stabilize my requests hub"
```

## Self-Review

- Spec coverage: This plan covers the `My Requests` route, primary navigation, normalized query layer, current employee and organization scoping, pending/rejected/recent buckets, rejected-only required fixes, source links for complex fixes, absence cancellation reuse, partial source errors, empty states, and tests.
- Placeholder scan: No `TBD`, `TODO`, `implement later`, or undefined follow-up tasks remain.
- Type consistency: `SelfServiceRequestItem`, `SelfServiceRequestResult`, `SelfServiceRequestStatus`, and `SelfServiceRequestSourceType` are defined in Task 1 and used consistently in later tasks.
