# Fresh Approvals Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken approvals inbox with a fresh, reliable inbox contract and UI for absence, time correction, and travel expense approvals.

**Architecture:** Build a focused `approval-inbox` boundary that owns serializable list/detail/count/decision contracts. Keep existing approval handlers responsible for domain-specific approve/reject side effects, and make API routes thin adapters over the new service. Rebuild the page around the new contract, including fast lanes, sprint mode, keyboard shortcuts, and visible risk explanations.

**Tech Stack:** Next.js App Router route handlers, React client components, TanStack Query, Drizzle ORM, Effect services, Luxon, Vitest, Testing Library, Tolgee, Tabler icons, pnpm.

---

## File Structure

- Create: `apps/webapp/src/lib/approvals/inbox/types.ts`
  - Public inbox contract types for list, detail, decisions, warnings, and supported approval types.
- Create: `apps/webapp/src/lib/approvals/inbox/serialization.ts`
  - Date serialization and payload validation helpers for the new contract.
- Create: `apps/webapp/src/lib/approvals/inbox/triage.ts`
  - Server-side triage metadata and risk explanation builder for inbox items.
- Create: `apps/webapp/src/lib/approvals/inbox/current-actor.ts`
  - Active-session, active-organization, current-employee, ability, and manager-eligibility resolution.
- Create: `apps/webapp/src/lib/approvals/inbox/source-adapters.ts`
  - Maps registered approval handlers into inbox source definitions and hides unsupported first-version types.
- Create: `apps/webapp/src/lib/approvals/inbox/read-service.ts`
  - List, counts, filtering, sorting, pagination, warning, and detail-section orchestration.
- Create: `apps/webapp/src/lib/approvals/inbox/decision-service.ts`
  - Single and bulk approve/reject orchestration using persisted approval requests and existing handlers.
- Create: `apps/webapp/src/lib/approvals/inbox/index.ts`
  - Narrow exports for route handlers and tests.
- Create tests under `apps/webapp/src/lib/approvals/inbox/*.test.ts`.
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
  - Replace route internals with thin adapter to `getApprovalInboxList`.
- Modify: `apps/webapp/src/app/api/approvals/inbox/counts/route.ts`
  - Replace route internals with thin adapter to `getApprovalInboxCounts`.
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/route.ts`
  - Replace route internals with thin adapter to `getApprovalInboxDetail`.
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.ts`
  - Replace route internals with thin adapter to `approveApprovalInboxItem`.
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.ts`
  - Replace route internals with thin adapter to `rejectApprovalInboxItem`.
- Modify: `apps/webapp/src/app/api/approvals/inbox/bulk-approve/route.ts`
  - Replace route internals with thin adapter to `bulkApproveApprovalInboxItems`.
- Modify: `apps/webapp/src/app/api/approvals/inbox/bulk-reject/route.ts`
  - Replace route internals with thin adapter to `bulkRejectApprovalInboxItems`.
- Modify tests under `apps/webapp/src/app/api/approvals/inbox/**/*.test.ts`.
- Modify: `apps/webapp/src/lib/query/use-approval-inbox.ts`
  - Update client query hooks to consume the new serializable contract.
- Replace: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`
  - New page shell and state orchestration.
- Replace or heavily modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar.tsx`
  - Supported-type filters, risk filters, search, and selection summary.
- Replace or heavily modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx`
  - New contract rendering and warning-safe empty states.
- Replace or heavily modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.tsx`
  - Generic section-based detail renderer.
- Replace or heavily modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.tsx`
  - New fast-lane groups with visible explanations.
- Replace or heavily modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx`
  - New sprint flow and keyboard shortcut scope.
- Replace or heavily modify component tests under `apps/webapp/src/app/[locale]/(app)/approvals/inbox/**/*.test.tsx`.

Commit handling: do not commit during implementation unless the user explicitly approves committing. Treat commit steps as checkpoints for reviewing staged intent only.

---

### Task 1: Define Serializable Inbox Contracts

**Files:**
- Create: `apps/webapp/src/lib/approvals/inbox/types.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/serialization.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/types.test.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/serialization.test.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/index.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `apps/webapp/src/lib/approvals/inbox/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	SUPPORTED_APPROVAL_INBOX_TYPES,
	type ApprovalInboxItem,
} from "@/lib/approvals/inbox/types";

describe("approval inbox contract types", () => {
	it("exposes only current live approval sources", () => {
		expect(SUPPORTED_APPROVAL_INBOX_TYPES).toEqual([
			"absence_entry",
			"time_entry",
			"travel_expense_claim",
		]);
		expect(SUPPORTED_APPROVAL_INBOX_TYPES).not.toContain("shift_request");
	});

	it("allows a fully serializable inbox item", () => {
		const item: ApprovalInboxItem = {
			id: "approval-1",
			type: "absence_entry",
			entityId: "absence-1",
			status: "pending",
			requester: {
				id: "employee-1",
				name: "Avery Employee",
				email: "avery@example.com",
				image: null,
				teamId: "team-1",
			},
			summary: {
				title: "Vacation",
				subtitle: "May 31, 2026",
				detail: "1 day off",
				badge: { label: "Vacation", color: "#4f46e5" },
			},
			timing: {
				createdAt: "2026-05-31T09:00:00.000Z",
				resolvedAt: null,
				slaDeadline: null,
				ageDays: 0,
			},
			triage: {
				priority: "normal",
				riskLevel: "low",
				riskReasons: ["no_conflicts_detected"],
				fastLaneGroup: "low_risk_absence",
				isPayrollRelevant: false,
				explanation: "No conflicts detected.",
			},
			capabilities: {
				canApprove: true,
				canReject: true,
				canBulkApprove: true,
				requiresRejectReason: true,
			},
		};

		expect(JSON.parse(JSON.stringify(item))).toEqual(item);
	});
});
```

Create `apps/webapp/src/lib/approvals/inbox/serialization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAgeDays, serializeDate } from "@/lib/approvals/inbox/serialization";

describe("approval inbox serialization", () => {
	it("serializes dates as ISO strings", () => {
		expect(serializeDate(new Date("2026-05-31T09:00:00.000Z"))).toBe(
			"2026-05-31T09:00:00.000Z",
		);
	});

	it("serializes null dates as null", () => {
		expect(serializeDate(null)).toBeNull();
	});

	it("calculates whole UTC age days without native date math in callers", () => {
		expect(
			getAgeDays({
				createdAt: new Date("2026-05-28T09:00:00.000Z"),
				now: new Date("2026-05-31T10:00:00.000Z"),
			}),
		).toBe(3);
	});
});
```

- [ ] **Step 2: Run the failing contract tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/types.test.ts src/lib/approvals/inbox/serialization.test.ts`

Expected: FAIL because `@/lib/approvals/inbox/types` and `@/lib/approvals/inbox/serialization` do not exist.

- [ ] **Step 3: Implement the contract types**

Create `apps/webapp/src/lib/approvals/inbox/types.ts`:

```ts
export const SUPPORTED_APPROVAL_INBOX_TYPES = [
	"absence_entry",
	"time_entry",
	"travel_expense_claim",
] as const;

export type ApprovalInboxType = (typeof SUPPORTED_APPROVAL_INBOX_TYPES)[number];

export type ApprovalInboxStatus = "pending" | "approved" | "rejected";
export type ApprovalInboxPriority = "urgent" | "high" | "normal" | "low";
export type ApprovalInboxRiskLevel = "low" | "medium" | "high";
export type ApprovalInboxFastLaneGroup =
	| "low_risk_absence"
	| "small_time_correction"
	| "stale_pending"
	| "payroll_blocker";

export interface ApprovalInboxRequester {
	id: string;
	name: string;
	email: string;
	image: string | null;
	teamId: string | null;
}

export interface ApprovalInboxSummary {
	title: string;
	subtitle: string;
	detail: string;
	badge: { label: string; color: string | null } | null;
}

export interface ApprovalInboxTiming {
	createdAt: string;
	resolvedAt: string | null;
	slaDeadline: string | null;
	ageDays: number;
}

export interface ApprovalInboxTriage {
	priority: ApprovalInboxPriority;
	riskLevel: ApprovalInboxRiskLevel;
	riskReasons: string[];
	fastLaneGroup: ApprovalInboxFastLaneGroup | null;
	isPayrollRelevant: boolean;
	explanation: string;
}

export interface ApprovalInboxCapabilities {
	canApprove: boolean;
	canReject: boolean;
	canBulkApprove: boolean;
	requiresRejectReason: boolean;
}

export interface ApprovalInboxItem {
	id: string;
	type: ApprovalInboxType;
	entityId: string;
	status: ApprovalInboxStatus;
	requester: ApprovalInboxRequester;
	summary: ApprovalInboxSummary;
	timing: ApprovalInboxTiming;
	triage: ApprovalInboxTriage;
	capabilities: ApprovalInboxCapabilities;
}

export type ApprovalInboxDetailSection =
	| {
			type: "key_value";
			title: string;
			rows: Array<{ label: string; value: string; tone?: "default" | "warning" | "danger" }>;
		}
	| { type: "text"; title: string; body: string }
	| {
			type: "timeline";
			title: string;
			events: Array<{ id: string; label: string; at: string; actorName: string | null }>;
		}
	| { type: "callout"; title: string; body: string; tone: "info" | "warning" | "danger" };

export interface ApprovalInboxDetailResult {
	item: ApprovalInboxItem;
	sections: ApprovalInboxDetailSection[];
	actions: ApprovalInboxCapabilities;
}

export interface ApprovalInboxWarning {
	source: string;
	message: string;
}

export interface ApprovalInboxListResult {
	items: ApprovalInboxItem[];
	nextCursor: string | null;
	hasMore: boolean;
	total: number;
	counts: Record<ApprovalInboxType, number>;
	supportedTypes: ApprovalInboxType[];
	warnings: ApprovalInboxWarning[];
}

export interface ApprovalInboxDecisionSuccess {
	id: string;
	type: ApprovalInboxType;
	status: "approved" | "rejected";
}

export interface ApprovalInboxDecisionFailure {
	id: string;
	code: "stale" | "forbidden" | "not_found" | "unsupported" | "validation_failed";
	message: string;
}

export interface ApprovalInboxBulkDecisionResult {
	succeeded: ApprovalInboxDecisionSuccess[];
	failed: ApprovalInboxDecisionFailure[];
}
```

- [ ] **Step 4: Implement serialization helpers**

Create `apps/webapp/src/lib/approvals/inbox/serialization.ts`:

```ts
import { DateTime } from "luxon";

export function serializeDate(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	if (typeof value === "string") return DateTime.fromISO(value, { zone: "utc" }).toUTC().toISO();
	return DateTime.fromJSDate(value, { zone: "utc" }).toUTC().toISO();
}

export function getAgeDays({ createdAt, now }: { createdAt: Date | string; now?: Date }): number {
	const createdAtDateTime =
		typeof createdAt === "string"
			? DateTime.fromISO(createdAt, { zone: "utc" })
			: DateTime.fromJSDate(createdAt, { zone: "utc" });
	const nowDateTime = now ? DateTime.fromJSDate(now, { zone: "utc" }) : DateTime.utc();

	if (!createdAtDateTime.isValid) return 0;

	return Math.max(0, Math.floor(nowDateTime.diff(createdAtDateTime, "days").days));
}

export function assertSerializableApprovalPayload(payload: unknown): void {
	JSON.parse(JSON.stringify(payload));
}
```

Create `apps/webapp/src/lib/approvals/inbox/index.ts`:

```ts
export * from "./types";
export * from "./serialization";
```

- [ ] **Step 5: Run the contract tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/types.test.ts src/lib/approvals/inbox/serialization.test.ts`

Expected: PASS.

- [ ] **Step 6: Checkpoint review**

Run: `git diff -- apps/webapp/src/lib/approvals/inbox/types.ts apps/webapp/src/lib/approvals/inbox/serialization.ts apps/webapp/src/lib/approvals/inbox/index.ts apps/webapp/src/lib/approvals/inbox/types.test.ts apps/webapp/src/lib/approvals/inbox/serialization.test.ts`

Expected: Diff only contains the new contract and serialization helpers.

---

### Task 2: Add Server-Side Triage Builder

**Files:**
- Create: `apps/webapp/src/lib/approvals/inbox/triage.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/triage.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/index.ts`

- [ ] **Step 1: Write failing triage tests**

Create `apps/webapp/src/lib/approvals/inbox/triage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildInboxTriage } from "@/lib/approvals/inbox/triage";

describe("buildInboxTriage", () => {
	it("marks old pending requests as stale high-risk items", () => {
		expect(
			buildInboxTriage({
				type: "travel_expense_claim",
				priority: "normal",
				status: "pending",
				createdAt: new Date("2026-05-27T09:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
			}),
		).toMatchObject({
			riskLevel: "high",
			riskReasons: ["stale_pending"],
			fastLaneGroup: "stale_pending",
			explanation: "Pending longer than 3 days.",
		});
	});

	it("marks small time corrections as low risk only with a safe delta", () => {
		expect(
			buildInboxTriage({
				type: "time_entry",
				priority: "low",
				status: "pending",
				createdAt: new Date("2026-05-31T08:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
				timeDeltaMinutes: 10,
			}),
		).toMatchObject({
			riskLevel: "low",
			riskReasons: ["small_time_delta"],
			fastLaneGroup: "small_time_correction",
		});
	});

	it("defaults ambiguous items to medium risk and no low-risk fast lane", () => {
		expect(
			buildInboxTriage({
				type: "time_entry",
				priority: "normal",
				status: "pending",
				createdAt: new Date("2026-05-31T08:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
			}),
		).toMatchObject({
			riskLevel: "medium",
			riskReasons: ["needs_review"],
			fastLaneGroup: null,
		});
	});
});
```

- [ ] **Step 2: Run the failing triage test**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/triage.test.ts`

Expected: FAIL because `triage.ts` does not exist.

- [ ] **Step 3: Implement triage builder**

Create `apps/webapp/src/lib/approvals/inbox/triage.ts`:

```ts
import type {
	ApprovalInboxPriority,
	ApprovalInboxRiskLevel,
	ApprovalInboxStatus,
	ApprovalInboxTriage,
	ApprovalInboxType,
} from "./types";
import { getAgeDays } from "./serialization";

const STALE_AFTER_DAYS = 3;
const SMALL_TIME_CORRECTION_MINUTES = 15;

export interface BuildInboxTriageInput {
	type: ApprovalInboxType;
	priority: ApprovalInboxPriority;
	status: ApprovalInboxStatus;
	createdAt: Date | string;
	now?: Date;
	isPayrollRelevant?: boolean;
	riskLevel?: ApprovalInboxRiskLevel;
	riskReasons?: string[];
	timeDeltaMinutes?: number;
}

export function buildInboxTriage(input: BuildInboxTriageInput): ApprovalInboxTriage {
	const ageDays = getAgeDays({ createdAt: input.createdAt, now: input.now });
	const isPayrollRelevant = input.isPayrollRelevant === true;

	if (isPayrollRelevant) {
		return {
			priority: input.priority,
			riskLevel: "high",
			riskReasons: ["payroll_relevant"],
			fastLaneGroup: "payroll_blocker",
			isPayrollRelevant: true,
			explanation: "Blocks payroll readiness.",
		};
	}

	if (input.status === "pending" && ageDays >= STALE_AFTER_DAYS) {
		return {
			priority: input.priority,
			riskLevel: "high",
			riskReasons: ["stale_pending"],
			fastLaneGroup: "stale_pending",
			isPayrollRelevant: false,
			explanation: `Pending longer than ${STALE_AFTER_DAYS} days.`,
		};
	}

	if (
		input.type === "time_entry" &&
		typeof input.timeDeltaMinutes === "number" &&
		Math.abs(input.timeDeltaMinutes) <= SMALL_TIME_CORRECTION_MINUTES
	) {
		return {
			priority: input.priority,
			riskLevel: "low",
			riskReasons: ["small_time_delta"],
			fastLaneGroup: "small_time_correction",
			isPayrollRelevant: false,
			explanation: `Time delta is within ${SMALL_TIME_CORRECTION_MINUTES} minutes.`,
		};
	}

	if (input.type === "absence_entry" && input.riskLevel !== "high") {
		return {
			priority: input.priority,
			riskLevel: "low",
			riskReasons: ["no_conflicts_detected"],
			fastLaneGroup: "low_risk_absence",
			isPayrollRelevant: false,
			explanation: "No conflicts detected.",
		};
	}

	return {
		priority: input.priority,
		riskLevel: input.riskLevel ?? "medium",
		riskReasons: input.riskReasons?.length ? input.riskReasons : ["needs_review"],
		fastLaneGroup: null,
		isPayrollRelevant: false,
		explanation: "Needs manual review.",
	};
}
```

Modify `apps/webapp/src/lib/approvals/inbox/index.ts`:

```ts
export * from "./types";
export * from "./serialization";
export * from "./triage";
```

- [ ] **Step 4: Run triage tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/triage.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint review**

Run: `git diff -- apps/webapp/src/lib/approvals/inbox/triage.ts apps/webapp/src/lib/approvals/inbox/triage.test.ts apps/webapp/src/lib/approvals/inbox/index.ts`

Expected: Diff only adds triage builder and exports it.

---

### Task 3: Resolve Current Approval Inbox Actor

**Files:**
- Create: `apps/webapp/src/lib/approvals/inbox/current-actor.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/current-actor.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/index.ts`

- [ ] **Step 1: Write failing actor tests**

Create `apps/webapp/src/lib/approvals/inbox/current-actor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createApprovalInboxActorContext } from "@/lib/approvals/inbox/current-actor";

describe("createApprovalInboxActorContext", () => {
	it("marks manage-Approval users as org-wide approval viewers", async () => {
		const context = await createApprovalInboxActorContext({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
			ability: { cannot: vi.fn((action: string) => action !== "manage") },
			findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
			loadEligibleApprovalScopes: vi.fn(async () => [{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] }]),
		});

		expect(context.includeAllApprovers).toBe(true);
		expect(context.eligibleApprovalScopes).toEqual([]);
	});

	it("loads eligible manager scopes for approval users without manage permission", async () => {
		const context = await createApprovalInboxActorContext({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
			ability: { cannot: vi.fn((action: string) => action === "manage") },
			findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
			loadEligibleApprovalScopes: vi.fn(async () => [{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] }]),
		});

		expect(context.includeAllApprovers).toBe(false);
		expect(context.eligibleApprovalScopes).toEqual([
			{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] },
		]);
	});

	it("rejects users without approve or manage permission", async () => {
		await expect(
			createApprovalInboxActorContext({
				session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
				ability: { cannot: vi.fn(() => true) },
				findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
				loadEligibleApprovalScopes: vi.fn(async () => []),
			}),
		).rejects.toThrow("Forbidden");
	});
});
```

- [ ] **Step 2: Run the failing actor tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/current-actor.test.ts`

Expected: FAIL because `current-actor.ts` does not exist.

- [ ] **Step 3: Implement actor context helper**

Create `apps/webapp/src/lib/approvals/inbox/current-actor.ts`:

```ts
export interface ApprovalInboxSessionLike {
	user: { id: string };
	session?: { activeOrganizationId?: string | null } | null;
}

export interface ApprovalInboxAbilityLike {
	cannot: (action: string, subject: string) => boolean;
}

export interface ApprovalInboxEmployeeContext {
	id: string;
	organizationId: string;
}

export interface ApprovalInboxEligibleScope {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
}

export interface ApprovalInboxActorContext {
	userId: string;
	activeOrganizationId: string;
	employee: ApprovalInboxEmployeeContext;
	includeAllApprovers: boolean;
	eligibleApprovalScopes: ApprovalInboxEligibleScope[];
}

export class ApprovalInboxForbiddenError extends Error {
	constructor(message = "Forbidden") {
		super(message);
		this.name = "ApprovalInboxForbiddenError";
	}
}

export class ApprovalInboxUnauthorizedError extends Error {
	constructor(message = "Unauthorized") {
		super(message);
		this.name = "ApprovalInboxUnauthorizedError";
	}
}

export class ApprovalInboxBadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ApprovalInboxBadRequestError";
	}
}

export async function createApprovalInboxActorContext({
	session,
	ability,
	findCurrentEmployee,
	loadEligibleApprovalScopes,
}: {
	session: ApprovalInboxSessionLike | null;
	ability: ApprovalInboxAbilityLike | null;
	findCurrentEmployee: (userId: string, organizationId: string) => Promise<ApprovalInboxEmployeeContext | null>;
	loadEligibleApprovalScopes: (input: {
		managerEmployeeId: string;
		organizationId: string;
	}) => Promise<ApprovalInboxEligibleScope[]>;
}): Promise<ApprovalInboxActorContext> {
	if (!session?.user) throw new ApprovalInboxUnauthorizedError();

	const activeOrganizationId = session.session?.activeOrganizationId;
	if (!activeOrganizationId) throw new ApprovalInboxBadRequestError("No active organization");
	if (!ability) throw new ApprovalInboxForbiddenError();

	const canManageApprovals = ability.cannot("manage", "Approval") === false;
	const canApproveApprovals = ability.cannot("approve", "Approval") === false;
	if (!canApproveApprovals && !canManageApprovals) throw new ApprovalInboxForbiddenError();

	const employee = await findCurrentEmployee(session.user.id, activeOrganizationId);
	if (!employee) throw new ApprovalInboxBadRequestError("Employee not found");

	return {
		userId: session.user.id,
		activeOrganizationId,
		employee,
		includeAllApprovers: canManageApprovals,
		eligibleApprovalScopes: canManageApprovals
			? []
			: await loadEligibleApprovalScopes({
					managerEmployeeId: employee.id,
					organizationId: employee.organizationId,
				}),
	};
}
```

Modify `apps/webapp/src/lib/approvals/inbox/index.ts`:

```ts
export * from "./types";
export * from "./serialization";
export * from "./triage";
export * from "./current-actor";
```

- [ ] **Step 4: Run actor tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/current-actor.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint review**

Run: `git diff -- apps/webapp/src/lib/approvals/inbox/current-actor.ts apps/webapp/src/lib/approvals/inbox/current-actor.test.ts apps/webapp/src/lib/approvals/inbox/index.ts`

Expected: Diff only adds actor context resolution and exports it.

---

### Task 4: Build Inbox Source Adapter Mapping

**Files:**
- Create: `apps/webapp/src/lib/approvals/inbox/source-adapters.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/source-adapters.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/index.ts`

- [ ] **Step 1: Write failing source adapter tests**

Create `apps/webapp/src/lib/approvals/inbox/source-adapters.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getSupportedInboxSources, isSupportedInboxType } from "@/lib/approvals/inbox/source-adapters";

describe("approval inbox source adapters", () => {
	it("returns only registered live inbox sources", () => {
		const handlers = [
			{ type: "absence_entry", displayName: "Absence Request", supportsBulkApprove: true },
			{ type: "time_entry", displayName: "Time Correction", supportsBulkApprove: true },
			{ type: "travel_expense_claim", displayName: "Travel Expense", supportsBulkApprove: true },
			{ type: "shift_request", displayName: "Shift Request", supportsBulkApprove: true },
		];

		expect(getSupportedInboxSources(() => handlers as never).map((source) => source.type)).toEqual([
			"absence_entry",
			"time_entry",
			"travel_expense_claim",
		]);
	});

	it("guards supported source types", () => {
		expect(isSupportedInboxType("absence_entry")).toBe(true);
		expect(isSupportedInboxType("shift_request")).toBe(false);
		expect(isSupportedInboxType("unknown")).toBe(false);
	});
});
```

- [ ] **Step 2: Run failing source adapter tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/source-adapters.test.ts`

Expected: FAIL because `source-adapters.ts` does not exist.

- [ ] **Step 3: Implement source adapters**

Create `apps/webapp/src/lib/approvals/inbox/source-adapters.ts`:

```ts
import { getAllApprovalHandlers, getApprovalHandler } from "@/lib/approvals/domain/registry";
import type { ApprovalTypeHandler } from "@/lib/approvals/domain/types";
import {
	SUPPORTED_APPROVAL_INBOX_TYPES,
	type ApprovalInboxType,
} from "./types";

const supportedTypeSet = new Set<string>(SUPPORTED_APPROVAL_INBOX_TYPES);

export interface ApprovalInboxSource {
	type: ApprovalInboxType;
	displayName: string;
	supportsBulkApprove: boolean;
	handler: ApprovalTypeHandler;
}

export function isSupportedInboxType(value: string): value is ApprovalInboxType {
	return supportedTypeSet.has(value);
}

export function getSupportedInboxSources(
	loadHandlers: () => ApprovalTypeHandler[] = getAllApprovalHandlers,
): ApprovalInboxSource[] {
	return loadHandlers()
		.filter((handler): handler is ApprovalTypeHandler & { type: ApprovalInboxType } =>
			isSupportedInboxType(handler.type),
		)
		.map((handler) => ({
			type: handler.type,
			displayName: handler.displayName,
			supportsBulkApprove: handler.supportsBulkApprove,
			handler,
		}));
}

export function getSupportedInboxHandler(type: string): ApprovalTypeHandler | null {
	if (!isSupportedInboxType(type)) return null;
	return getApprovalHandler(type) ?? null;
}
```

Modify `apps/webapp/src/lib/approvals/inbox/index.ts`:

```ts
export * from "./types";
export * from "./serialization";
export * from "./triage";
export * from "./current-actor";
export * from "./source-adapters";
```

- [ ] **Step 4: Run source adapter tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/source-adapters.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint review**

Run: `git diff -- apps/webapp/src/lib/approvals/inbox/source-adapters.ts apps/webapp/src/lib/approvals/inbox/source-adapters.test.ts apps/webapp/src/lib/approvals/inbox/index.ts`

Expected: Diff only adds supported source filtering and exports it.

---

### Task 5: Implement Read Service List, Counts, Filtering, Sorting, And Warnings

**Files:**
- Create: `apps/webapp/src/lib/approvals/inbox/read-service.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/read-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/index.ts`

- [ ] **Step 1: Write failing read service tests**

Create `apps/webapp/src/lib/approvals/inbox/read-service.test.ts`:

```ts
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { getApprovalInboxListFromSources } from "@/lib/approvals/inbox/read-service";
import type { ApprovalInboxSource } from "@/lib/approvals/inbox/source-adapters";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";

function item(overrides: Partial<UnifiedApprovalItem>): UnifiedApprovalItem {
	return {
		id: "approval-1",
		approvalType: "absence_entry",
		entityId: "entity-1",
		typeName: "Absence Request",
		requester: {
			id: "employee-1",
			userId: "user-1",
			name: "Avery Employee",
			email: "avery@example.com",
			image: null,
			teamId: "team-1",
		},
		approverId: "manager-1",
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date("2026-05-31T09:00:00.000Z"),
		resolvedAt: null,
		priority: "normal",
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: { title: "Vacation", subtitle: "May 31", summary: "1 day off" },
		...overrides,
	};
}

function source(type: ApprovalInboxSource["type"], items: UnifiedApprovalItem[]): ApprovalInboxSource {
	return {
		type,
		displayName: type,
		supportsBulkApprove: true,
		handler: {
			type,
			displayName: type,
			supportsBulkApprove: true,
			getApprovals: vi.fn(() => Effect.succeed(items)),
			getCount: vi.fn(() => Effect.succeed(items.length)),
		} as never,
	};
}

describe("getApprovalInboxListFromSources", () => {
	it("returns serializable items sorted by risk and age", async () => {
		const result = await getApprovalInboxListFromSources({
			sources: [
				source("absence_entry", [
					item({ id: "new-low", createdAt: new Date("2026-05-31T09:00:00.000Z"), priority: "low" }),
				]),
				source("travel_expense_claim", [
					item({
						id: "old-high",
						approvalType: "travel_expense_claim",
						createdAt: new Date("2026-05-27T09:00:00.000Z"),
						priority: "normal",
					}),
				]),
			],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			},
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(result.items.map((approval) => approval.id)).toEqual(["old-high", "new-low"]);
		expect(result.items[0].timing.createdAt).toBe("2026-05-27T09:00:00.000Z");
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});

	it("returns warnings when one source fails", async () => {
		const brokenSource: ApprovalInboxSource = {
			type: "time_entry",
			displayName: "Time Correction",
			supportsBulkApprove: true,
			handler: {
				type: "time_entry",
				displayName: "Time Correction",
				supportsBulkApprove: true,
				getApprovals: vi.fn(() => Effect.die(new Error("source failed"))),
				getCount: vi.fn(() => Effect.succeed(0)),
			} as never,
		};

		const result = await getApprovalInboxListFromSources({
			sources: [source("absence_entry", [item({ id: "approval-1" })]), brokenSource],
			params: { approverId: "manager-1", organizationId: "org-1", status: "pending", limit: 20 },
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(result.items).toHaveLength(1);
		expect(result.warnings).toEqual([
			{ source: "time_entry", message: "Time Correction approvals could not be loaded." },
		]);
	});
});
```

- [ ] **Step 2: Run failing read service tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/read-service.test.ts`

Expected: FAIL because `read-service.ts` does not exist.

- [ ] **Step 3: Implement read service mapping and sorting**

Create `apps/webapp/src/lib/approvals/inbox/read-service.ts`:

```ts
import { Cause, Effect, Exit } from "effect";
import type { ApprovalQueryParams, UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { buildInboxTriage } from "./triage";
import { getAgeDays, serializeDate } from "./serialization";
import type { ApprovalInboxItem, ApprovalInboxListResult, ApprovalInboxType } from "./types";
import { getSupportedInboxSources, type ApprovalInboxSource } from "./source-adapters";

const riskRank = { high: 3, medium: 2, low: 1 } as const;
const priorityRank = { urgent: 4, high: 3, normal: 2, low: 1 } as const;

export interface ApprovalInboxListParams extends ApprovalQueryParams {
	types?: ApprovalInboxType[];
}

export async function getApprovalInboxListFromSources({
	sources,
	params,
	now,
}: {
	sources: ApprovalInboxSource[];
	params: ApprovalInboxListParams;
	now?: Date;
}): Promise<ApprovalInboxListResult> {
	const items: ApprovalInboxItem[] = [];
	const warnings: ApprovalInboxListResult["warnings"] = [];
	const counts = Object.fromEntries(sources.map((source) => [source.type, 0])) as Record<
		ApprovalInboxType,
		number
	>;

	for (const source of sources) {
		if (params.types?.length && !params.types.includes(source.type)) continue;

		const exit = await Effect.runPromiseExit(source.handler.getApprovals(params));
		if (Exit.isFailure(exit)) {
			warnings.push({
				source: source.type,
				message: `${source.displayName} approvals could not be loaded.`,
			});
			continue;
		}

		for (const approval of exit.value) {
			items.push(toInboxItem(approval, source, now));
		}
	}

	for (const source of sources) {
		const countExit = await Effect.runPromiseExit(
			source.handler.getCount(params.approverId, params.organizationId, {
				eligibleApprovalScopes: params.eligibleApprovalScopes,
				includeAllApprovers: params.includeAllApprovers,
			}),
		);
		counts[source.type] = Exit.isSuccess(countExit) ? countExit.value : 0;
	}

	items.sort(compareInboxItems);

	const limit = params.limit;
	const pageItems = items.slice(0, limit);
	const hasMore = items.length > limit;
	const nextCursor = hasMore ? createCursor(pageItems[pageItems.length - 1]) : null;

	return {
		items: pageItems,
		nextCursor,
		hasMore,
		total: items.length,
		counts,
		supportedTypes: sources.map((source) => source.type),
		warnings,
	};
}

export async function getApprovalInboxList(params: ApprovalInboxListParams) {
	return getApprovalInboxListFromSources({ sources: getSupportedInboxSources(), params });
}

export async function getApprovalInboxCounts(params: ApprovalInboxListParams) {
	const result = await getApprovalInboxListFromSources({
		sources: getSupportedInboxSources(),
		params: { ...params, limit: 1 },
	});
	return result.counts;
}

function toInboxItem(
	approval: UnifiedApprovalItem,
	source: ApprovalInboxSource,
	now?: Date,
): ApprovalInboxItem {
	const triage = buildInboxTriage({
		type: source.type,
		priority: approval.priority,
		status: approval.status,
		createdAt: approval.createdAt,
		now,
		isPayrollRelevant: approval.triage?.isPayrollRelevant,
		riskLevel: approval.triage?.riskLevel,
		riskReasons: approval.triage?.riskReasons,
		timeDeltaMinutes: approval.triage?.timeDeltaMinutes,
	});

	return {
		id: approval.id,
		type: source.type,
		entityId: approval.entityId,
		status: approval.status,
		requester: {
			id: approval.requester.id,
			name: approval.requester.name,
			email: approval.requester.email,
			image: approval.requester.image,
			teamId: approval.requester.teamId,
		},
		summary: {
			title: approval.display.title,
			subtitle: approval.display.subtitle,
			detail: approval.display.summary,
			badge: approval.display.badge ?? null,
		},
		timing: {
			createdAt: serializeDate(approval.createdAt) ?? "",
			resolvedAt: serializeDate(approval.resolvedAt),
			slaDeadline: serializeDate(approval.sla.deadline),
			ageDays: getAgeDays({ createdAt: approval.createdAt, now }),
		},
		triage,
		capabilities: {
			canApprove: approval.status === "pending",
			canReject: approval.status === "pending",
			canBulkApprove: source.supportsBulkApprove && approval.status === "pending",
			requiresRejectReason: true,
		},
	};
}

function compareInboxItems(first: ApprovalInboxItem, second: ApprovalInboxItem): number {
	const riskDiff = riskRank[second.triage.riskLevel] - riskRank[first.triage.riskLevel];
	if (riskDiff !== 0) return riskDiff;

	const priorityDiff = priorityRank[second.triage.priority] - priorityRank[first.triage.priority];
	if (priorityDiff !== 0) return priorityDiff;

	const createdDiff = first.timing.createdAt.localeCompare(second.timing.createdAt);
	if (createdDiff !== 0) return createdDiff;

	return first.id.localeCompare(second.id);
}

function createCursor(item: ApprovalInboxItem): string {
	return JSON.stringify({
		riskLevel: item.triage.riskLevel,
		priority: item.triage.priority,
		createdAt: item.timing.createdAt,
		id: item.id,
	});
}
```

Modify `apps/webapp/src/lib/approvals/inbox/index.ts`:

```ts
export * from "./types";
export * from "./serialization";
export * from "./triage";
export * from "./current-actor";
export * from "./source-adapters";
export * from "./read-service";
```

- [ ] **Step 4: Run read service tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/read-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint review**

Run: `git diff -- apps/webapp/src/lib/approvals/inbox/read-service.ts apps/webapp/src/lib/approvals/inbox/read-service.test.ts apps/webapp/src/lib/approvals/inbox/index.ts`

Expected: Diff adds read service and tests only.

---

### Task 6: Add Detail Section Mapping

**Files:**
- Modify: `apps/webapp/src/lib/approvals/inbox/read-service.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/detail-service.test.ts`

- [ ] **Step 1: Write failing detail service tests**

Create `apps/webapp/src/lib/approvals/inbox/detail-service.test.ts`:

```ts
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { getApprovalInboxDetailFromRequest } from "@/lib/approvals/inbox/read-service";

describe("getApprovalInboxDetailFromRequest", () => {
	it("returns serializable generic detail sections", async () => {
		const result = await getApprovalInboxDetailFromRequest({
			request: {
				id: "approval-1",
				entityType: "absence_entry",
				entityId: "absence-1",
				organizationId: "org-1",
				status: "pending",
				approverId: "manager-1",
			},
			handler: {
				displayName: "Absence Request",
				supportsBulkApprove: true,
				getDetail: vi.fn(() =>
					Effect.succeed({
						approval: {
							id: "approval-1",
							approvalType: "absence_entry",
							entityId: "absence-1",
							typeName: "Absence Request",
							requester: {
								id: "employee-1",
								userId: "user-1",
								name: "Avery Employee",
								email: "avery@example.com",
								image: null,
								teamId: null,
							},
							approverId: "manager-1",
							organizationId: "org-1",
							status: "pending",
							createdAt: new Date("2026-05-31T09:00:00.000Z"),
							resolvedAt: null,
							priority: "normal",
							sla: { deadline: null, status: "on_time", hoursRemaining: null },
							display: { title: "Vacation", subtitle: "May 31", summary: "1 day off" },
						},
						entity: { notes: "Family event" },
						timeline: [
							{
								id: "created",
								type: "created",
								performedBy: { name: "Avery Employee", image: null },
								timestamp: new Date("2026-05-31T09:00:00.000Z"),
								message: "Request created",
							},
						],
					}),
				),
			} as never,
		});

		expect(result.item.id).toBe("approval-1");
		expect(result.sections.map((section) => section.type)).toEqual(["key_value", "timeline"]);
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
});
```

- [ ] **Step 2: Run failing detail service tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/detail-service.test.ts`

Expected: FAIL because `getApprovalInboxDetailFromRequest` is not implemented.

- [ ] **Step 3: Add detail mapping to read service**

Modify `apps/webapp/src/lib/approvals/inbox/read-service.ts` by appending these exports:

```ts
import type { ApprovalTypeHandler } from "@/lib/approvals/domain/types";
import type { ApprovalInboxDetailResult, ApprovalInboxDetailSection } from "./types";

export async function getApprovalInboxDetailFromRequest({
	request,
	handler,
}: {
	request: {
		id: string;
		entityType: string;
		entityId: string;
		organizationId: string;
		status: "pending" | "approved" | "rejected";
		approverId: string;
	};
	handler: ApprovalTypeHandler;
}): Promise<ApprovalInboxDetailResult> {
	const detail = await Effect.runPromise(handler.getDetail(request.entityId, request.organizationId));
	const source = {
		type: request.entityType as ApprovalInboxType,
		displayName: handler.displayName,
		supportsBulkApprove: handler.supportsBulkApprove,
		handler,
	};
	const item = toInboxItem(detail.approval, source, undefined);

	return {
		item,
		sections: buildDetailSections(detail),
		actions: item.capabilities,
	};
}

function buildDetailSections(detail: {
	approval: UnifiedApprovalItem;
	entity: unknown;
	timeline: Array<{ id: string; message: string; timestamp: Date; performedBy: { name: string } | null }>;
}): ApprovalInboxDetailSection[] {
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: "Request",
			rows: [
				{ label: "Type", value: detail.approval.typeName },
				{ label: "Summary", value: detail.approval.display.summary },
				{ label: "Status", value: detail.approval.status },
			],
		},
	];

	if (detail.timeline.length > 0) {
		sections.push({
			type: "timeline",
			title: "Timeline",
			events: detail.timeline.map((event) => ({
				id: event.id,
				label: event.message,
				at: serializeDate(event.timestamp) ?? "",
				actorName: event.performedBy?.name ?? null,
			})),
		});
	}

	return sections;
}
```

The new imports for `ApprovalTypeHandler`, `ApprovalInboxDetailResult`, and `ApprovalInboxDetailSection` belong in the existing import section at the top of `read-service.ts`; do not add a second import block in the middle of the file.

- [ ] **Step 4: Run detail service tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/detail-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Run read service tests again**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/read-service.test.ts src/lib/approvals/inbox/detail-service.test.ts`

Expected: PASS.

---

### Task 7: Implement Decision Service

**Files:**
- Create: `apps/webapp/src/lib/approvals/inbox/decision-service.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/decision-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/index.ts`

- [ ] **Step 1: Write failing decision service tests**

Create `apps/webapp/src/lib/approvals/inbox/decision-service.test.ts`:

```ts
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	bulkDecideApprovalInboxItemsFromRequests,
	decideApprovalInboxItemFromRequest,
} from "@/lib/approvals/inbox/decision-service";

describe("approval inbox decision service", () => {
	it("requires rejection reasons", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "reject",
				reason: "   ",
				handler: { reject: vi.fn(), approve: vi.fn() } as never,
			}),
		).rejects.toThrow("Rejection reason is required");
	});

	it("delegates approve to the persisted source handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { approve, reject: vi.fn() } as never,
			}),
		).resolves.toEqual({ id: "approval-1", type: "absence_entry", status: "approved" });
		expect(approve).toHaveBeenCalledWith("absence-1", "manager-1", undefined);
	});

	it("returns partial success for bulk decisions", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				{
					id: "approval-2",
					entityType: "absence_entry",
					entityId: "absence-2",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "approved",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () => ({ approve: vi.fn(() => Effect.succeed(undefined)), reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toHaveLength(1);
		expect(result.failed).toEqual([
			{ id: "approval-2", code: "stale", message: "Request is already approved" },
		]);
	});
});
```

- [ ] **Step 2: Run failing decision tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/decision-service.test.ts`

Expected: FAIL because `decision-service.ts` does not exist.

- [ ] **Step 3: Implement decision service**

Create `apps/webapp/src/lib/approvals/inbox/decision-service.ts`:

```ts
import { Cause, Effect, Exit, Option } from "effect";
import type { ApprovalTypeHandler } from "@/lib/approvals/domain/types";
import { getSupportedInboxHandler, isSupportedInboxType } from "./source-adapters";
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxDecisionFailure,
	ApprovalInboxDecisionSuccess,
} from "./types";

type InboxDecisionAction = "approve" | "reject";

export interface PersistedApprovalRequestForDecision {
	id: string;
	entityType: string;
	entityId: string;
	organizationId: string;
	approverId: string;
	status: "pending" | "approved" | "rejected";
}

export async function decideApprovalInboxItemFromRequest({
	request,
	actorEmployeeId,
	action,
	reason,
	handler,
}: {
	request: PersistedApprovalRequestForDecision;
	actorEmployeeId: string;
	action: InboxDecisionAction;
	reason?: string;
	handler: ApprovalTypeHandler;
}): Promise<ApprovalInboxDecisionSuccess> {
	if (!isSupportedInboxType(request.entityType)) {
		throw new Error(`Unsupported approval type: ${request.entityType}`);
	}

	if (request.status !== "pending") {
		throw new Error(`Request is already ${request.status}`);
	}

	if (action === "reject" && !reason?.trim()) {
		throw new Error("Rejection reason is required");
	}

	const effect =
		action === "approve"
			? handler.approve(request.entityId, actorEmployeeId, undefined)
			: handler.reject(request.entityId, actorEmployeeId, reason?.trim() ?? "", undefined);

	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isFailure(exit)) {
		throw extractEffectError(exit.cause);
	}

	return {
		id: request.id,
		type: request.entityType,
		status: action === "approve" ? "approved" : "rejected",
	};
}

export async function bulkDecideApprovalInboxItemsFromRequests({
	requests,
	actorEmployeeId,
	action,
	reason,
	resolveHandler,
}: {
	requests: PersistedApprovalRequestForDecision[];
	actorEmployeeId: string;
	action: InboxDecisionAction;
	reason?: string;
	resolveHandler?: (type: string) => ApprovalTypeHandler | null;
}): Promise<ApprovalInboxBulkDecisionResult> {
	const result: ApprovalInboxBulkDecisionResult = { succeeded: [], failed: [] };
	const handlerResolver = resolveHandler ?? getSupportedInboxHandler;

	for (const request of requests) {
		const handler = handlerResolver(request.entityType);
		if (!handler) {
			result.failed.push({
				id: request.id,
				code: "unsupported",
				message: `Unsupported approval type: ${request.entityType}`,
			});
			continue;
		}

		if (request.status !== "pending") {
			result.failed.push({
				id: request.id,
				code: "stale",
				message: `Request is already ${request.status}`,
			});
			continue;
		}

		try {
			result.succeeded.push(
				await decideApprovalInboxItemFromRequest({
					request,
					actorEmployeeId,
					action,
					reason,
					handler,
				}),
			);
		} catch (error) {
			result.failed.push(mapDecisionFailure(request.id, error));
		}
	}

	return result;
}

function extractEffectError(cause: Cause.Cause<unknown>): unknown {
	return Option.getOrNull(Cause.failureOption(cause)) ?? [...Cause.defects(cause)][0] ?? cause;
}

function mapDecisionFailure(id: string, error: unknown): ApprovalInboxDecisionFailure {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("already")) return { id, code: "stale", message };
	if (message.includes("not authorized") || message.includes("Forbidden")) {
		return { id, code: "forbidden", message };
	}
	if (message.includes("not found")) return { id, code: "not_found", message };
	return { id, code: "validation_failed", message };
}
```

Modify `apps/webapp/src/lib/approvals/inbox/index.ts`:

```ts
export * from "./types";
export * from "./serialization";
export * from "./triage";
export * from "./current-actor";
export * from "./source-adapters";
export * from "./read-service";
export * from "./decision-service";
```

- [ ] **Step 4: Run decision tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox/decision-service.test.ts`

Expected: PASS.

---

### Task 8: Replace API Routes With Thin Inbox Adapters

**Files:**
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/counts/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/bulk-approve/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/bulk-reject/route.ts`
- Modify route tests under `apps/webapp/src/app/api/approvals/inbox/**/*.test.ts`

- [ ] **Step 1: Update route tests to assert thin adapter behavior**

In `apps/webapp/src/app/api/approvals/inbox/route.test.ts`, replace service expectations so the test asserts these route params are passed to the inbox service:

```ts
expect(mockState.getApprovalInboxList).toHaveBeenCalledWith(
	expect.objectContaining({
		approverId: "employee-1",
		organizationId: "org-1",
		status: "pending",
		types: ["travel_expense_claim", "absence_entry"],
		includeAllApprovers: undefined,
		eligibleApprovalScopes: [],
		limit: 15,
	}),
);
```

In `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.test.ts`, add an expectation:

```ts
expect(mockState.approveApprovalInboxItem).toHaveBeenCalledWith({
	approvalId: "approval-1",
	actorEmployeeId: "employee-1",
	organizationId: "org-1",
});
```

In `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.test.ts`, add an expectation:

```ts
expect(mockState.rejectApprovalInboxItem).toHaveBeenCalledWith({
	approvalId: "approval-1",
	actorEmployeeId: "employee-1",
	organizationId: "org-1",
	reason: "Missing context",
});
```

In bulk route tests, add expectations that service calls receive the actor employee, organization, IDs, and reason for reject.

- [ ] **Step 2: Run route tests and verify failure**

Run: `pnpm --filter webapp test src/app/api/approvals/inbox/route.test.ts src/app/api/approvals/inbox/[id]/approve/route.test.ts src/app/api/approvals/inbox/[id]/reject/route.test.ts src/app/api/approvals/inbox/bulk-approve/route.test.ts src/app/api/approvals/inbox/bulk-reject/route.test.ts`

Expected: FAIL because routes still call old services directly.

- [ ] **Step 3: Replace list route internals**

Modify `apps/webapp/src/app/api/approvals/inbox/route.ts` to keep authentication/current employee resolution, then delegate to `getApprovalInboxList`:

```ts
const result = await getApprovalInboxList({
	approverId: currentEmployee.id,
	includeAllApprovers: canManageApprovals || undefined,
	organizationId: currentEmployee.organizationId,
	status,
	types: types?.filter(isSupportedInboxType),
	teamId,
	search,
	priority,
	minAgeDays,
	dateRange,
	cursor,
	limit,
	eligibleApprovalScopes,
});

return NextResponse.json(result);
```

Ensure imports include:

```ts
import { getApprovalInboxList, isSupportedInboxType } from "@/lib/approvals/inbox";
```

- [ ] **Step 4: Replace counts route internals**

Modify `apps/webapp/src/app/api/approvals/inbox/counts/route.ts` so it delegates to the `getApprovalInboxCounts` helper added in Task 5:

```ts
const counts = await getApprovalInboxCounts({
	approverId: currentEmployee.id,
	includeAllApprovers: canManageApprovals || undefined,
	organizationId: currentEmployee.organizationId,
	status: "pending",
	limit: 1,
	eligibleApprovalScopes,
});

return NextResponse.json(counts);
```

- [ ] **Step 5: Replace detail and decision route internals**

Keep each route's session, active organization, current employee, and permission resolution. Replace source-specific logic with service calls using persisted approval ID.

Single approve route core:

```ts
const result = await approveApprovalInboxItem({
	approvalId: id,
	actorEmployeeId: currentEmployee.id,
	organizationId: currentEmployee.organizationId,
});
return NextResponse.json({ success: true, result });
```

Single reject route core:

```ts
const body = await request.json();
const reason = typeof body.reason === "string" ? body.reason : "";
const result = await rejectApprovalInboxItem({
	approvalId: id,
	actorEmployeeId: currentEmployee.id,
	organizationId: currentEmployee.organizationId,
	reason,
});
return NextResponse.json({ success: true, result });
```

Bulk approve route core:

```ts
const result = await bulkApproveApprovalInboxItems({
	approvalIds,
	actorEmployeeId: currentEmployee.id,
	organizationId: currentEmployee.organizationId,
});
return NextResponse.json(result);
```

Bulk reject route core:

```ts
const result = await bulkRejectApprovalInboxItems({
	approvalIds,
	actorEmployeeId: currentEmployee.id,
	organizationId: currentEmployee.organizationId,
	reason,
});
return NextResponse.json(result);
```

Add these DB-backed wrapper functions to `decision-service.ts` after the pure functions in Task 7. They load approval requests filtered by `approvalRequest.id` and `approvalRequest.organizationId`, resolve the persisted source handler, and call the pure decision functions:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest } from "@/db/schema";

export async function approveApprovalInboxItem(input: {
	approvalId: string;
	actorEmployeeId: string;
	organizationId: string;
}) {
	const request = await loadDecisionRequest(input.approvalId, input.organizationId);
	const handler = getSupportedInboxHandler(request.entityType);
	if (!handler) throw new Error(`Unsupported approval type: ${request.entityType}`);
	return decideApprovalInboxItemFromRequest({
		request,
		actorEmployeeId: input.actorEmployeeId,
		action: "approve",
		handler,
	});
}

export async function rejectApprovalInboxItem(input: {
	approvalId: string;
	actorEmployeeId: string;
	organizationId: string;
	reason: string;
}) {
	const request = await loadDecisionRequest(input.approvalId, input.organizationId);
	const handler = getSupportedInboxHandler(request.entityType);
	if (!handler) throw new Error(`Unsupported approval type: ${request.entityType}`);
	return decideApprovalInboxItemFromRequest({
		request,
		actorEmployeeId: input.actorEmployeeId,
		action: "reject",
		reason: input.reason,
		handler,
	});
}

export async function bulkApproveApprovalInboxItems(input: {
	approvalIds: string[];
	actorEmployeeId: string;
	organizationId: string;
}) {
	return bulkDecideApprovalInboxItemsFromRequests({
		requests: await loadDecisionRequests(input.approvalIds, input.organizationId),
		actorEmployeeId: input.actorEmployeeId,
		action: "approve",
	});
}

export async function bulkRejectApprovalInboxItems(input: {
	approvalIds: string[];
	actorEmployeeId: string;
	organizationId: string;
	reason: string;
}) {
	return bulkDecideApprovalInboxItemsFromRequests({
		requests: await loadDecisionRequests(input.approvalIds, input.organizationId),
		actorEmployeeId: input.actorEmployeeId,
		action: "reject",
		reason: input.reason,
	});
}

async function loadDecisionRequest(approvalId: string, organizationId: string) {
	const request = await db.query.approvalRequest.findFirst({
		where: and(eq(approvalRequest.id, approvalId), eq(approvalRequest.organizationId, organizationId)),
	});
	if (!request) throw new Error("Approval request not found");
	return request as PersistedApprovalRequestForDecision;
}

async function loadDecisionRequests(approvalIds: string[], organizationId: string) {
	if (approvalIds.length === 0) return [];
	return (await db.query.approvalRequest.findMany({
		where: and(
			inArray(approvalRequest.id, approvalIds),
			eq(approvalRequest.organizationId, organizationId),
		),
	})) as PersistedApprovalRequestForDecision[];
}
```

- [ ] **Step 6: Run route tests**

Run: `pnpm --filter webapp test src/app/api/approvals/inbox/route.test.ts src/app/api/approvals/inbox/counts/route.test.ts src/app/api/approvals/inbox/[id]/route.test.ts src/app/api/approvals/inbox/[id]/approve/route.test.ts src/app/api/approvals/inbox/[id]/reject/route.test.ts src/app/api/approvals/inbox/bulk-approve/route.test.ts src/app/api/approvals/inbox/bulk-reject/route.test.ts`

Expected: PASS.

---

### Task 9: Update Client Query Hook For New Contract

**Files:**
- Modify: `apps/webapp/src/lib/query/use-approval-inbox.ts`
- Modify: `apps/webapp/src/lib/query/use-approval-inbox.test.ts`

- [ ] **Step 1: Write failing hook parsing tests**

In `apps/webapp/src/lib/query/use-approval-inbox.test.ts`, add tests for the new response contract helpers:

```ts
import { readBulkDecisionResult, readQueryError } from "./use-approval-inbox";

it("reads new bulk decision payloads", async () => {
	const response = new Response(
		JSON.stringify({
			succeeded: [{ id: "approval-1", type: "absence_entry", status: "approved" }],
			failed: [],
		}),
		{ status: 200 },
	);

	await expect(readBulkDecisionResult(response, "approve")).resolves.toEqual({
		succeeded: [{ id: "approval-1", type: "absence_entry", status: "approved" }],
		failed: [],
	});
});

it("surfaces API error payloads", async () => {
	const response = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	await expect(readQueryError(response, "Fallback")).rejects.toThrow("Forbidden");
});
```

- [ ] **Step 2: Run hook tests and verify failure if types mismatch**

Run: `pnpm --filter webapp test src/lib/query/use-approval-inbox.test.ts`

Expected: FAIL if the hook still expects old `approvalType` bulk success fields.

- [ ] **Step 3: Update hook types and fetch functions**

Modify `apps/webapp/src/lib/query/use-approval-inbox.ts` imports to use new inbox types:

```ts
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxDetailResult,
	ApprovalInboxListResult,
	ApprovalInboxPriority,
	ApprovalInboxStatus,
	ApprovalInboxType,
} from "@/lib/approvals/inbox/types";
```

Update `ApprovalInboxFilters`:

```ts
export interface ApprovalInboxFilters {
	status?: ApprovalInboxStatus;
	types?: ApprovalInboxType[];
	teamId?: string;
	search?: string;
	priority?: ApprovalInboxPriority;
	minAgeDays?: number;
	dateRange?: { from: Date; to: Date };
}
```

Update return types:

```ts
async function fetchApprovals(
	filters: ApprovalInboxFilters,
	cursor?: string,
): Promise<ApprovalInboxListResult> {
	// keep existing URLSearchParams logic
}

async function fetchApprovalDetail(approvalId: string): Promise<ApprovalInboxDetailResult> {
	// keep endpoint path
}

export async function readBulkDecisionResult(
	response: Response,
	action: BulkDecisionAction = "approve",
): Promise<ApprovalInboxBulkDecisionResult> {
	// keep validation for succeeded/failed arrays
}
```

- [ ] **Step 4: Run hook tests**

Run: `pnpm --filter webapp test src/lib/query/use-approval-inbox.test.ts`

Expected: PASS.

---

### Task 10: Rebuild Inbox Page Shell And Table

**Files:**
- Replace: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`
- Replace: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx`
- Replace: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.test.tsx`

- [ ] **Step 1: Write failing page shell tests**

In `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.test.tsx`, update the mocked query response to the new contract:

```ts
approvalInboxMock.mockReturnValue({
	data: {
		pages: [
			{
				items: [
					{
						id: "approval-1",
						type: "absence_entry",
						entityId: "absence-1",
						status: "pending",
						requester: {
							id: "employee-1",
							name: "Avery Employee",
							email: "avery@example.com",
							image: null,
							teamId: null,
						},
						summary: { title: "Vacation", subtitle: "May 31", detail: "1 day off", badge: null },
						timing: {
							createdAt: "2026-05-31T09:00:00.000Z",
							resolvedAt: null,
							slaDeadline: null,
							ageDays: 0,
						},
						triage: {
							priority: "normal",
							riskLevel: "low",
							riskReasons: ["no_conflicts_detected"],
							fastLaneGroup: "low_risk_absence",
							isPayrollRelevant: false,
							explanation: "No conflicts detected.",
						},
						capabilities: {
							canApprove: true,
							canReject: true,
							canBulkApprove: true,
							requiresRejectReason: true,
						},
					},
				],
				total: 1,
				counts: { absence_entry: 1, time_entry: 0, travel_expense_claim: 0 },
				supportedTypes: ["absence_entry", "time_entry", "travel_expense_claim"],
				warnings: [],
				hasMore: false,
				nextCursor: null,
			},
		],
	},
	isLoading: false,
	isError: false,
	error: null,
	isFetching: false,
	fetchNextPage: vi.fn(),
	hasNextPage: false,
	isFetchingNextPage: false,
	refetch: refetchMock,
});
```

Add expectations:

```ts
expect(screen.getByText("Approval Inbox")).toBeTruthy();
expect(screen.getByText("Avery Employee")).toBeTruthy();
expect(screen.getByText("No conflicts detected.")).toBeTruthy();
expect(screen.queryByText("Shift Requests")).toBeNull();
```

- [ ] **Step 2: Run failing page tests**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/approvals/inbox/page.test.tsx'`

Expected: FAIL because the page and table still read old `UnifiedApprovalItem` fields.

- [ ] **Step 3: Replace table component**

Replace `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx` with a small contract-based table/list:

```tsx
"use client";

import { IconAlertTriangle, IconCalendarOff, IconClockEdit, IconReceipt } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ApprovalInboxItem, ApprovalInboxType } from "@/lib/approvals/inbox/types";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<ApprovalInboxType, React.ComponentType<{ className?: string }>> = {
	absence_entry: IconCalendarOff,
	time_entry: IconClockEdit,
	travel_expense_claim: IconReceipt,
};

export function ApprovalInboxTable({
	items,
	selectedIds,
	onSelectItem,
	onRowClick,
	isFetching,
}: {
	items: ApprovalInboxItem[];
	selectedIds: Set<string>;
	onSelectItem: (id: string, checked: boolean) => void;
	onRowClick: (item: ApprovalInboxItem) => void;
	isFetching: boolean;
}) {
	const { t } = useTranslate();

	if (items.length === 0) {
		return <div className="rounded-lg border p-8 text-center text-muted-foreground">{t("approvals:approvals.noRequests", "No pending requests")}</div>;
	}

	return (
		<div className={cn("overflow-hidden rounded-lg border", isFetching && "opacity-70")}>
			{items.map((item) => {
				const Icon = TYPE_ICONS[item.type];
				return (
					<button
						key={item.id}
						type="button"
						className="grid w-full grid-cols-[auto_1fr_auto] gap-3 border-b p-4 text-left transition-colors last:border-b-0 hover:bg-muted/50 md:grid-cols-[auto_180px_1fr_180px]"
						onClick={() => onRowClick(item)}
					>
						<Checkbox
							checked={selectedIds.has(item.id)}
							onCheckedChange={(checked) => onSelectItem(item.id, checked === true)}
							onClick={(event) => event.stopPropagation()}
							aria-label={t("approvals:approvals.selectRow", "Select row")}
						/>
						<div className="flex items-center gap-2 md:hidden">
							<Icon className="size-4 text-muted-foreground" />
							<span className="font-medium">{item.summary.title}</span>
						</div>
						<div className="hidden items-center gap-3 md:flex">
							<UserAvatar image={item.requester.image} seed={item.requester.id} name={item.requester.name} size="sm" />
							<div className="min-w-0">
								<div className="truncate font-medium">{item.requester.name}</div>
								<div className="truncate text-xs text-muted-foreground">{item.requester.email}</div>
							</div>
						</div>
						<div className="min-w-0 space-y-1">
							<div className="flex items-center gap-2">
								<Icon className="hidden size-4 text-muted-foreground md:block" />
								<span className="truncate font-medium">{item.summary.title}</span>
							</div>
							<div className="truncate text-sm text-muted-foreground">{item.summary.detail}</div>
							<div className="flex items-center gap-1 text-xs text-muted-foreground">
								{item.triage.riskLevel === "high" ? <IconAlertTriangle className="size-3 text-destructive" /> : null}
								<span>{item.triage.explanation}</span>
							</div>
						</div>
						<div className="flex flex-col items-end gap-2">
							<Badge variant={item.triage.riskLevel === "high" ? "destructive" : "secondary"}>{item.triage.riskLevel}</Badge>
							<span className="text-xs text-muted-foreground">{item.timing.ageDays}d old</span>
						</div>
					</button>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 4: Replace toolbar component**

Replace `approval-inbox-toolbar.tsx` with supported-type-aware filters and keep selection controls. Use `ApprovalInboxType` from the new contract and do not include shift requests:

```tsx
"use client";

import { IconSearch, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";
import type { ApprovalInboxFilters } from "@/lib/query/use-approval-inbox";

const TYPE_LABELS: Record<ApprovalInboxType, string> = {
	absence_entry: "Absence Requests",
	time_entry: "Time Corrections",
	travel_expense_claim: "Travel Expenses",
};

export function ApprovalInboxToolbar({
	filters,
	onFiltersChange,
	selectedCount,
	allSelected,
	onSelectAll,
	supportedTypes,
}: {
	filters: ApprovalInboxFilters;
	onFiltersChange: (filters: ApprovalInboxFilters) => void;
	selectedCount: number;
	allSelected: boolean;
	onSelectAll: (checked: boolean) => void;
	supportedTypes: ApprovalInboxType[];
}) {
	const { t } = useTranslate();
	const activeFilterCount = (filters.types?.length ? 1 : 0) + (filters.search ? 1 : 0);

	function toggleType(type: ApprovalInboxType) {
		const current = filters.types ?? [];
		const next = current.includes(type) ? current.filter((value) => value !== type) : [...current, type];
		onFiltersChange({ ...filters, types: next.length ? next : undefined });
	}

	return (
		<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div className="flex flex-wrap items-center gap-3">
				<Checkbox
					checked={allSelected}
					onCheckedChange={(checked) => onSelectAll(checked === true)}
					aria-label={t("approvals:approvals.selectAll", "Select all")}
				/>
				{selectedCount > 0 ? (
					<span className="text-sm text-muted-foreground">
						{selectedCount} {t("common.selected", "selected")}
					</span>
				) : null}
				<div className="relative w-full min-w-56 md:w-72">
					<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder={t("approvals:approvals.searchPlaceholder", "Search by name or email...")}
						value={filters.search ?? ""}
						onChange={(event) => onFiltersChange({ ...filters, search: event.target.value || undefined })}
						className="pl-9"
					/>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							{t("approvals:approvals.type", "Type")}
							{filters.types?.length ? (
								<Badge variant="secondary" className="ml-2">{filters.types.length}</Badge>
							) : null}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>{t("approvals:approvals.filterByType", "Filter by type")}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{supportedTypes.map((type) => (
							<DropdownMenuCheckboxItem
								key={type}
								checked={filters.types?.includes(type) ?? false}
								onCheckedChange={() => toggleType(type)}
							>
								{TYPE_LABELS[type]}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				{activeFilterCount > 0 ? (
					<Button variant="ghost" size="sm" onClick={() => onFiltersChange({ status: "pending" })}>
						<IconX className="mr-1 size-4" />
						{t("common.clear", "Clear")}
					</Button>
				) : null}
			</div>
		</div>
	);
}
```

- [ ] **Step 5: Replace page shell**

Replace `page.tsx` state to use `ApprovalInboxItem` and `ApprovalInboxListResult` fields. Flatten pages with:

```ts
const pages = data?.pages ?? [];
const items = pages.flatMap((page) => page.items);
const firstPage = pages[0];
const totalCount = firstPage?.total ?? 0;
const warnings = pages.flatMap((page) => page.warnings);
const supportedTypes = firstPage?.supportedTypes ?? [];
```

Render warnings above the table:

```tsx
{warnings.length > 0 && (
	<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
		{warnings.map((warning) => warning.message).join(" ")}
	</div>
)}
```

- [ ] **Step 6: Run page tests**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/approvals/inbox/page.test.tsx'`

Expected: PASS.

---

### Task 11: Rebuild Detail Drawer With Generic Sections

**Files:**
- Replace: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.test.tsx`

- [ ] **Step 1: Write failing generic detail tests**

Update `approval-detail-panel.test.tsx` to mock `useApprovalDetail` returning:

```ts
{
	item: approvalItem,
	sections: [
		{ type: "key_value", title: "Request", rows: [{ label: "Type", value: "Absence Request" }] },
		{ type: "callout", title: "Risk", body: "No conflicts detected.", tone: "info" },
	],
	actions: approvalItem.capabilities,
}
```

Assert:

```ts
expect(screen.getByText("Request")).toBeTruthy();
expect(screen.getByText("Absence Request")).toBeTruthy();
expect(screen.getByText("No conflicts detected.")).toBeTruthy();
```

- [ ] **Step 2: Run failing detail component test**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.test.tsx'`

Expected: FAIL because the current drawer reads old source-specific entity internals.

- [ ] **Step 3: Replace detail panel renderer**

Implement section rendering for `key_value`, `text`, `timeline`, and `callout`. Keep approve/reject mutations from `use-approval-inbox`, but pass `approval.id` only. Keep rejection reason required.

Use this section renderer inside the component:

```tsx
function DetailSection({ section }: { section: ApprovalInboxDetailSection }) {
	switch (section.type) {
		case "key_value":
			return (
				<section className="space-y-3">
					<h4 className="font-medium text-sm text-muted-foreground">{section.title}</h4>
					{section.rows.map((row) => (
						<div key={`${row.label}-${row.value}`} className="flex justify-between gap-4 text-sm">
							<span className="text-muted-foreground">{row.label}</span>
							<span className="text-right font-medium">{row.value}</span>
						</div>
					))}
				</section>
			);
		case "callout":
			return (
				<section className="rounded-lg border bg-muted/40 p-3">
					<h4 className="font-medium text-sm">{section.title}</h4>
					<p className="mt-1 text-sm text-muted-foreground">{section.body}</p>
				</section>
			);
		case "text":
			return (
				<section className="space-y-1">
					<h4 className="font-medium text-sm text-muted-foreground">{section.title}</h4>
					<p className="text-sm">{section.body}</p>
				</section>
			);
		case "timeline":
			return (
				<section className="space-y-3">
					<h4 className="font-medium text-sm text-muted-foreground">{section.title}</h4>
					{section.events.map((event) => (
						<div key={event.id} className="text-sm">
							<div>{event.label}</div>
							<div className="text-xs text-muted-foreground">{event.at}</div>
						</div>
					))}
				</section>
			);
	}
}
```

- [ ] **Step 4: Run detail component tests**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.test.tsx'`

Expected: PASS.

---

### Task 12: Rebuild Fast Lanes And Sprint Mode

**Files:**
- Replace: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.tsx`
- Replace: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx`
- Replace or modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-card.tsx`
- Modify tests for fast lanes and sprint panel.

- [ ] **Step 1: Write failing fast-lane tests for new contract**

Update `approval-fast-lanes.test.tsx` so items use `ApprovalInboxItem` and assert explanations are visible:

```ts
expect(screen.getByText("No conflicts detected.")).toBeTruthy();
expect(screen.getByRole("button", { name: /Approve low-risk absences/ })).toBeTruthy();
```

- [ ] **Step 2: Write failing sprint keyboard tests for new contract**

Update `approval-sprint-panel.test.tsx` to assert:

```ts
fireEvent.keyDown(window, { key: "a" });
await waitFor(() => expect(approveMutateAsyncMock).toHaveBeenCalledWith("approval-1"));

fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Not enough detail" } });
fireEvent.keyDown(window, { key: "r" });
await waitFor(() => expect(rejectMutateAsyncMock).toHaveBeenCalledWith({ approvalId: "approval-1", reason: "Not enough detail" }));
```

Also add a typing guard test:

```ts
fireEvent.focus(screen.getByLabelText("Reason for rejection"));
fireEvent.keyDown(window, { key: "a" });
expect(approveMutateAsyncMock).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run failing triage UI tests**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx' 'src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx'`

Expected: FAIL because components still use old `UnifiedApprovalItem` shape.

- [ ] **Step 4: Implement fast lanes from `item.triage.fastLaneGroup`**

Group loaded pending items in the page or component with:

```ts
const groups = new Map<string, ApprovalInboxItem[]>();
for (const item of items) {
	if (item.status !== "pending" || !item.triage.fastLaneGroup) continue;
	groups.set(item.triage.fastLaneGroup, [...(groups.get(item.triage.fastLaneGroup) ?? []), item]);
}
```

Render each group with count, highest risk level, visible `item.triage.explanation`, approve button, reject-with-reason form, and expandable item list.

- [ ] **Step 5: Implement sprint panel keyboard scope**

Inside `approval-sprint-panel.tsx`, add this guard before handling keyboard shortcuts:

```ts
function isTextInputActive() {
	const active = document.activeElement;
	return (
		active instanceof HTMLInputElement ||
		active instanceof HTMLTextAreaElement ||
		active instanceof HTMLSelectElement ||
		active?.getAttribute("contenteditable") === "true"
	);
}
```

Use `useEffect` to handle `a`, `r`, `s`, and `n` only when `open` is true and `isTextInputActive()` is false.

- [ ] **Step 6: Run triage UI tests**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx' 'src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx'`

Expected: PASS.

---

### Task 13: Remove Old Contract Assumptions And Run Full Targeted Verification

**Files:**
- Search and adjust: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/**/*.{ts,tsx}`
- Search and adjust: `apps/webapp/src/lib/query/use-approval-inbox.ts`
- Search and adjust: `apps/webapp/src/lib/approvals/inbox/**/*.{ts,tsx}`

- [ ] **Step 1: Search for stale old-contract field usage**

Run: `rg "approvalType|display\.|sla\.|createdAt\)|formatRelative\(|UnifiedApprovalItem" apps/webapp/src/app/[locale]/\(app\)/approvals/inbox apps/webapp/src/lib/query/use-approval-inbox.ts apps/webapp/src/lib/approvals/inbox`

Expected: No stale UI usage of `UnifiedApprovalItem` fields in inbox route components. Server adapter code may still reference `UnifiedApprovalItem` only inside read-service mapping.

- [ ] **Step 2: Verify stale search output**

The search output should be empty for route components. The only acceptable matches are server-side mapper references inside `apps/webapp/src/lib/approvals/inbox/read-service.ts`. Approved replacement paths are:

```ts
item.type
item.summary.title
item.summary.detail
item.timing.createdAt
item.timing.slaDeadline
item.triage.priority
item.triage.explanation
```

- [ ] **Step 3: Run all inbox unit and component tests**

Run: `pnpm --filter webapp test src/lib/approvals/inbox src/lib/query/use-approval-inbox.test.ts 'src/app/[locale]/(app)/approvals/inbox'`

Expected: PASS.

- [ ] **Step 4: Run all approvals API route tests**

Run: `pnpm --filter webapp test src/app/api/approvals/inbox`

Expected: PASS.

- [ ] **Step 5: Run type/build verification if targeted tests pass**

Run: `CI=true pnpm build`

Expected: PASS.

- [ ] **Step 6: Final diff review**

Run: `git diff -- apps/webapp/src/lib/approvals/inbox apps/webapp/src/lib/query/use-approval-inbox.ts apps/webapp/src/app/api/approvals/inbox apps/webapp/src/app/[locale]/\(app\)/approvals/inbox docs/superpowers/specs/2026-05-31-fresh-approvals-inbox-design.md docs/superpowers/plans/2026-05-31-fresh-approvals-inbox.md`

Expected: Diff is limited to the fresh approvals inbox implementation, tests, and planning docs.

---

## Plan Self-Review

Spec coverage:

- Fresh serializable API contract: Tasks 1, 5, 8, 9.
- Current live sources only: Tasks 1, 4, 5, 10, 13.
- Reuse domain handlers: Tasks 4, 7, 8.
- Organization scoping and current actor resolution: Tasks 3, 8.
- Manager eligibility/admin visibility: Tasks 3, 8.
- Per-item bulk authorization and partial success: Tasks 7, 8.
- Fast lanes, sprint mode, keyboard shortcuts, risk explanations: Tasks 2, 10, 12.
- Detail drawer with generic sections: Tasks 6, 11.
- Warnings for source failures: Tasks 5, 10.
- Testing and verification: Tasks 1 through 13.

Known implementation notes:

- The plan intentionally keeps `/api/approvals/inbox` route paths stable.
- The plan intentionally excludes shift requests until a real registered source exists.
- Commit steps are omitted because commits require explicit user approval in this repository.
