# Approval Sprint Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fast approval triage to the existing unified approvals inbox with smart fast lanes and a keyboard-friendly sprint review flow.

**Architecture:** Keep the existing `/approvals/inbox` route, React Query hooks, and approval decision APIs. Add pure triage helpers under `lib/approvals`, derive metadata from already-loaded `UnifiedApprovalItem` records on the client, and render fast-lane plus sprint components inside the current inbox page.

**Tech Stack:** Next.js App Router, React 19, TypeScript, React Query, Vitest, React Testing Library, Tolgee, shadcn-style UI components, Tabler icons.

---

## File Structure

- Modify `apps/webapp/src/lib/approvals/domain/types.ts`: add triage metadata types and optional `triage` field on `UnifiedApprovalItem`.
- Create `apps/webapp/src/lib/approvals/triage.ts`: pure helpers for risk labels, fast-lane assignment, sorting, and grouping.
- Create `apps/webapp/src/lib/approvals/triage.test.ts`: unit coverage for triage defaults, stale items, payroll items, and small time corrections.
- Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.tsx`: fast-lane group cards with expandable item lists and bulk actions.
- Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx`: component tests for group rendering and bulk approve/reject callbacks.
- Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-card.tsx`: presentational current-item card with risk label and action buttons.
- Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx`: sprint dialog state, keyboard shortcuts, skip behavior, reject reason flow, and mutation calls.
- Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx`: tests for advance-on-success, failed approval staying put, and skip not mutating.
- Modify `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`: derive triage items, render `ApprovalFastLanes`, add Start approval sprint action, and wire sprint callbacks.

## Task 1: Add Approval Triage Types And Pure Helpers

**Files:**
- Modify: `apps/webapp/src/lib/approvals/domain/types.ts`
- Create: `apps/webapp/src/lib/approvals/triage.ts`
- Test: `apps/webapp/src/lib/approvals/triage.test.ts`

- [ ] **Step 1: Write the failing triage tests**

Create `apps/webapp/src/lib/approvals/triage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { UnifiedApprovalItem } from "./domain/types";
import { buildApprovalTriage, groupApprovalFastLanes, sortSprintApprovals } from "./triage";

function item(overrides: Partial<UnifiedApprovalItem>): UnifiedApprovalItem {
	return {
		id: "approval-1",
		approvalType: "absence_entry",
		entityId: "entity-1",
		typeName: "Absence",
		requester: {
			id: "employee-1",
			userId: "user-1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			image: null,
			teamId: null,
		},
		approverId: "employee-manager",
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date("2026-05-20T08:00:00.000Z"),
		resolvedAt: null,
		priority: "normal",
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: {
			title: "Vacation",
			subtitle: "May 27, 2026",
			summary: "Vacation request",
		},
		...overrides,
	};
}

describe("approval triage", () => {
	it("defaults uncertain approvals to medium risk without a fast lane", () => {
		const triage = buildApprovalTriage(item({ approvalType: "shift_request", typeName: "Shift" }), {
			now: new Date("2026-05-21T08:00:00.000Z"),
		});

		expect(triage.riskLevel).toBe("medium");
		expect(triage.riskReasons).toEqual(["needs_review"]);
		expect(triage.fastLaneGroup).toBeNull();
		expect(triage.ageDays).toBe(1);
	});

	it("marks normal absence requests as low-risk absence fast-lane items", () => {
		const triage = buildApprovalTriage(item({ approvalType: "absence_entry" }), {
			now: new Date("2026-05-21T08:00:00.000Z"),
		});

		expect(triage.riskLevel).toBe("low");
		expect(triage.riskReasons).toEqual(["no_conflicts_detected"]);
		expect(triage.fastLaneGroup).toBe("low_risk_absence");
	});

	it("marks small time corrections as a fast lane when metadata includes a minute delta", () => {
		const triage = buildApprovalTriage(
			item({
				approvalType: "time_entry",
				display: {
					title: "Time correction",
					subtitle: "12 minute correction",
					summary: "Changed checkout by 12 minutes",
				},
				triage: { timeDeltaMinutes: 12 },
			}),
			{ now: new Date("2026-05-21T08:00:00.000Z") },
		);

		expect(triage.riskLevel).toBe("low");
		expect(triage.fastLaneGroup).toBe("small_time_correction");
		expect(triage.riskReasons).toContain("small_time_delta");
	});

	it("marks stale pending approvals as high-risk stale fast-lane items", () => {
		const triage = buildApprovalTriage(item({}), {
			now: new Date("2026-05-25T08:00:00.000Z"),
			staleAfterDays: 3,
		});

		expect(triage.riskLevel).toBe("high");
		expect(triage.riskReasons).toContain("stale_pending");
		expect(triage.fastLaneGroup).toBe("stale_pending");
	});

	it("keeps payroll-relevant approvals in the payroll blocker group", () => {
		const triage = buildApprovalTriage(item({ triage: { isPayrollRelevant: true } }), {
			now: new Date("2026-05-21T08:00:00.000Z"),
		});

		expect(triage.riskLevel).toBe("high");
		expect(triage.fastLaneGroup).toBe("payroll_blocker");
		expect(triage.isPayrollRelevant).toBe(true);
	});

	it("groups triaged approvals by fast lane", () => {
		const groups = groupApprovalFastLanes([
			item({ id: "absence-1", approvalType: "absence_entry" }),
			item({ id: "shift-1", approvalType: "shift_request", typeName: "Shift" }),
		], { now: new Date("2026-05-21T08:00:00.000Z") });

		expect(groups).toHaveLength(1);
		expect(groups[0]?.key).toBe("low_risk_absence");
		expect(groups[0]?.items.map((approval) => approval.id)).toEqual(["absence-1"]);
	});

	it("sorts sprint approvals by high risk first and then oldest first", () => {
		const sorted = sortSprintApprovals(
			[
				item({ id: "new-low", createdAt: new Date("2026-05-24T08:00:00.000Z") }),
				item({
					id: "payroll",
					createdAt: new Date("2026-05-24T08:00:00.000Z"),
					triage: { isPayrollRelevant: true },
				}),
				item({ id: "old-low", createdAt: new Date("2026-05-20T08:00:00.000Z") }),
			],
			{ now: new Date("2026-05-25T08:00:00.000Z"), staleAfterDays: 99 },
		);

		expect(sorted.map((approval) => approval.id)).toEqual(["payroll", "old-low", "new-low"]);
	});
});
```

- [ ] **Step 2: Run the triage tests and verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/approvals/triage.test.ts`

Expected: FAIL because `./triage` does not exist and `UnifiedApprovalItem.triage` does not accept the metadata fields.

- [ ] **Step 3: Add triage types to the approval domain contract**

Modify `apps/webapp/src/lib/approvals/domain/types.ts` by adding these exports above `UnifiedApprovalItem`:

```ts
export type ApprovalRiskLevel = "low" | "medium" | "high";

export type ApprovalRiskReason =
	| "no_conflicts_detected"
	| "small_time_delta"
	| "stale_pending"
	| "payroll_relevant"
	| "policy_exception"
	| "needs_review";

export type ApprovalFastLaneGroupKey =
	| "low_risk_absence"
	| "small_time_correction"
	| "stale_pending"
	| "payroll_blocker";

export interface ApprovalTriageMetadata {
	riskLevel?: ApprovalRiskLevel;
	riskReasons?: ApprovalRiskReason[];
	fastLaneGroup?: ApprovalFastLaneGroupKey | null;
	isPayrollRelevant?: boolean;
	ageDays?: number;
	timeDeltaMinutes?: number;
}
```

Then add this optional field inside `UnifiedApprovalItem` after `display`:

```ts
	/** Advisory metadata for fast triage. Authorization never depends on this client-visible data. */
	triage?: ApprovalTriageMetadata;
```

- [ ] **Step 4: Implement the pure triage helper**

Create `apps/webapp/src/lib/approvals/triage.ts`:

```ts
import type {
	ApprovalFastLaneGroupKey,
	ApprovalRiskLevel,
	ApprovalRiskReason,
	ApprovalTriageMetadata,
	UnifiedApprovalItem,
} from "./domain/types";

const DAY_MS = 24 * 60 * 60 * 1000;

const FAST_LANE_LABELS: Record<ApprovalFastLaneGroupKey, string> = {
	low_risk_absence: "Low-risk absences",
	small_time_correction: "Small time corrections",
	stale_pending: "Stale pending requests",
	payroll_blocker: "Payroll-period blockers",
};

const FAST_LANE_DESCRIPTIONS: Record<ApprovalFastLaneGroupKey, string> = {
	low_risk_absence: "Absence requests without detected warnings in the loaded inbox data.",
	small_time_correction: "Time corrections at or below the small-change threshold.",
	stale_pending: "Pending requests older than the stale threshold.",
	payroll_blocker: "Requests marked as relevant to payroll close.",
};

const RISK_WEIGHT: Record<ApprovalRiskLevel, number> = {
	high: 0,
	medium: 1,
	low: 2,
};

export interface ApprovalTriageOptions {
	now?: Date;
	staleAfterDays?: number;
	smallTimeCorrectionMinutes?: number;
}

export interface TriagedApprovalItem extends UnifiedApprovalItem {
	triage: Required<Pick<ApprovalTriageMetadata, "riskLevel" | "riskReasons" | "isPayrollRelevant" | "ageDays">> &
		Pick<ApprovalTriageMetadata, "fastLaneGroup" | "timeDeltaMinutes">;
}

export interface ApprovalFastLaneGroup {
	key: ApprovalFastLaneGroupKey;
	label: string;
	description: string;
	riskLevel: ApprovalRiskLevel;
	items: TriagedApprovalItem[];
}

function getAgeDays(createdAt: Date, now: Date): number {
	return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS));
}

function uniqueReasons(reasons: ApprovalRiskReason[]): ApprovalRiskReason[] {
	return Array.from(new Set(reasons));
}

function mergeTriage(item: UnifiedApprovalItem, triage: ApprovalTriageMetadata): TriagedApprovalItem {
	return {
		...item,
		triage: {
			riskLevel: triage.riskLevel ?? "medium",
			riskReasons: triage.riskReasons?.length ? uniqueReasons(triage.riskReasons) : ["needs_review"],
			fastLaneGroup: triage.fastLaneGroup ?? null,
			isPayrollRelevant: triage.isPayrollRelevant ?? false,
			ageDays: triage.ageDays ?? 0,
			timeDeltaMinutes: triage.timeDeltaMinutes,
		},
	};
}

export function buildApprovalTriage(
	item: UnifiedApprovalItem,
	options: ApprovalTriageOptions = {},
): TriagedApprovalItem["triage"] {
	const now = options.now ?? new Date();
	const staleAfterDays = options.staleAfterDays ?? 3;
	const smallTimeCorrectionMinutes = options.smallTimeCorrectionMinutes ?? 15;
	const ageDays = getAgeDays(item.createdAt, now);
	const base = item.triage ?? {};
	const reasons: ApprovalRiskReason[] = [...(base.riskReasons ?? [])];

	let riskLevel: ApprovalRiskLevel = base.riskLevel ?? "medium";
	let fastLaneGroup: ApprovalFastLaneGroupKey | null = base.fastLaneGroup ?? null;
	const isPayrollRelevant = base.isPayrollRelevant ?? false;

	if (isPayrollRelevant) {
		riskLevel = "high";
		fastLaneGroup = "payroll_blocker";
		reasons.push("payroll_relevant");
	} else if (ageDays >= staleAfterDays) {
		riskLevel = "high";
		fastLaneGroup = "stale_pending";
		reasons.push("stale_pending");
	} else if (
		item.approvalType === "time_entry" &&
		typeof base.timeDeltaMinutes === "number" &&
		Math.abs(base.timeDeltaMinutes) <= smallTimeCorrectionMinutes
	) {
		riskLevel = "low";
		fastLaneGroup = "small_time_correction";
		reasons.push("small_time_delta");
	} else if (item.approvalType === "absence_entry") {
		riskLevel = "low";
		fastLaneGroup = "low_risk_absence";
		reasons.push("no_conflicts_detected");
	}

	return {
		riskLevel,
		riskReasons: uniqueReasons(reasons.length ? reasons : ["needs_review"]),
		fastLaneGroup,
		isPayrollRelevant,
		ageDays,
		timeDeltaMinutes: base.timeDeltaMinutes,
	};
}

export function withApprovalTriage(
	item: UnifiedApprovalItem,
	options: ApprovalTriageOptions = {},
): TriagedApprovalItem {
	return mergeTriage(item, buildApprovalTriage(item, options));
}

export function sortSprintApprovals(
	items: UnifiedApprovalItem[],
	options: ApprovalTriageOptions = {},
): TriagedApprovalItem[] {
	return items
		.map((item) => withApprovalTriage(item, options))
		.sort((a, b) => {
			const riskDiff = RISK_WEIGHT[a.triage.riskLevel] - RISK_WEIGHT[b.triage.riskLevel];
			if (riskDiff !== 0) return riskDiff;
			return a.createdAt.getTime() - b.createdAt.getTime();
		});
}

export function groupApprovalFastLanes(
	items: UnifiedApprovalItem[],
	options: ApprovalTriageOptions = {},
): ApprovalFastLaneGroup[] {
	const groups = new Map<ApprovalFastLaneGroupKey, TriagedApprovalItem[]>();

	for (const item of items) {
		const triaged = withApprovalTriage(item, options);
		if (!triaged.triage.fastLaneGroup) continue;
		const groupItems = groups.get(triaged.triage.fastLaneGroup) ?? [];
		groupItems.push(triaged);
		groups.set(triaged.triage.fastLaneGroup, groupItems);
	}

	return Array.from(groups.entries()).map(([key, groupItems]) => ({
		key,
		label: FAST_LANE_LABELS[key],
		description: FAST_LANE_DESCRIPTIONS[key],
		riskLevel: groupItems.some((item) => item.triage.riskLevel === "high") ? "high" : groupItems[0]?.triage.riskLevel ?? "medium",
		items: groupItems,
	}));
}
```

- [ ] **Step 5: Run the triage tests and verify they pass**

Run: `pnpm --dir apps/webapp test src/lib/approvals/triage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add apps/webapp/src/lib/approvals/domain/types.ts apps/webapp/src/lib/approvals/triage.ts apps/webapp/src/lib/approvals/triage.test.ts
git commit -m "feat: add approval triage helpers"
```

Expected: commit succeeds.

## Task 2: Add Fast-Lane Group Component

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx`

- [ ] **Step 1: Write the failing fast-lanes component tests**

Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalFastLaneGroup } from "@/lib/approvals/triage";
import { ApprovalFastLanes } from "./approval-fast-lanes";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const group: ApprovalFastLaneGroup = {
	key: "low_risk_absence",
	label: "Low-risk absences",
	description: "Absence requests without detected warnings in the loaded inbox data.",
	riskLevel: "low",
	items: [
		{
			id: "approval-1",
			approvalType: "absence_entry",
			entityId: "absence-1",
			typeName: "Absence",
			requester: {
				id: "employee-1",
				userId: "user-1",
				name: "Ada Lovelace",
				email: "ada@example.com",
				image: null,
				teamId: null,
			},
			approverId: "manager-1",
			organizationId: "org-1",
			status: "pending",
			createdAt: new Date("2026-05-20T08:00:00.000Z"),
			resolvedAt: null,
			priority: "normal",
			sla: { deadline: null, status: "on_time", hoursRemaining: null },
			display: { title: "Vacation", subtitle: "May 27", summary: "Vacation request" },
			triage: {
				riskLevel: "low",
				riskReasons: ["no_conflicts_detected"],
				fastLaneGroup: "low_risk_absence",
				isPayrollRelevant: false,
				ageDays: 1,
			},
		},
	],
};

describe("ApprovalFastLanes", () => {
	it("renders fast-lane counts and expandable approval rows", async () => {
		render(
			<ApprovalFastLanes
				groups={[group]}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={vi.fn()}
			/>,
		);

		expect(screen.getByText("Fast lanes")).toBeTruthy();
		expect(screen.getByText("Low-risk absences")).toBeTruthy();
		expect(screen.getByText("1 request")).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: /show low-risk absences/i }));

		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Vacation request")).toBeTruthy();
	});

	it("calls bulk approve with group approval ids", async () => {
		const onBulkApprove = vi.fn();
		render(
			<ApprovalFastLanes
				groups={[group]}
				isBusy={false}
				onBulkApprove={onBulkApprove}
				onBulkReject={vi.fn()}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /approve low-risk absences/i }));

		expect(onBulkApprove).toHaveBeenCalledWith(["approval-1"]);
	});

	it("requires a reject reason before calling bulk reject", async () => {
		const onBulkReject = vi.fn();
		render(
			<ApprovalFastLanes
				groups={[group]}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={onBulkReject}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /reject low-risk absences/i }));
		expect(onBulkReject).not.toHaveBeenCalled();

		await userEvent.type(screen.getByLabelText("Bulk reject reason"), "Insufficient detail");
		await userEvent.click(screen.getByRole("button", { name: /confirm reject low-risk absences/i }));

		expect(onBulkReject).toHaveBeenCalledWith(["approval-1"], "Insufficient detail");
	});
});
```

- [ ] **Step 2: Run the fast-lanes tests and verify they fail**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx'`

Expected: FAIL because `approval-fast-lanes.tsx` does not exist.

- [ ] **Step 3: Implement the fast-lanes component**

Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.tsx`:

```tsx
"use client";

import { IconChevronDown, IconChevronRight, IconChecks, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalFastLaneGroup } from "@/lib/approvals/triage";

interface ApprovalFastLanesProps {
	groups: ApprovalFastLaneGroup[];
	isBusy: boolean;
	onBulkApprove: (approvalIds: string[]) => void;
	onBulkReject: (approvalIds: string[], reason: string) => void;
}

function getRiskVariant(riskLevel: ApprovalFastLaneGroup["riskLevel"]) {
	if (riskLevel === "high") return "destructive" as const;
	if (riskLevel === "medium") return "outline" as const;
	return "secondary" as const;
}

export function ApprovalFastLanes({ groups, isBusy, onBulkApprove, onBulkReject }: ApprovalFastLanesProps) {
	const { t } = useTranslate();
	const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
	const [rejectGroupKey, setRejectGroupKey] = useState<string | null>(null);
	const [rejectReason, setRejectReason] = useState("");

	if (groups.length === 0) return null;

	function toggleGroup(key: string) {
		setOpenGroups((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	function handleReject(group: ApprovalFastLaneGroup) {
		const reason = rejectReason.trim();
		if (!reason) {
			setRejectGroupKey(group.key);
			return;
		}
		onBulkReject(group.items.map((item) => item.id), reason);
		setRejectGroupKey(null);
		setRejectReason("");
	}

	return (
		<section className="space-y-3" aria-labelledby="approval-fast-lanes-title">
			<div>
				<h2 id="approval-fast-lanes-title" className="text-lg font-semibold">
					{t("approvals:approvals.fastLanes.title", "Fast lanes")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						"approvals:approvals.fastLanes.description",
						"Clear repetitive approval groups without losing inspection control.",
					)}
				</p>
			</div>

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				{groups.map((group) => {
					const isOpen = openGroups.has(group.key);
					const countLabel = `${group.items.length} ${
						group.items.length === 1
							? t("approvals:approvals.fastLanes.request", "request")
							: t("approvals:approvals.fastLanes.requests", "requests")
					}`;

					return (
						<Card key={group.key}>
							<CardHeader className="space-y-2">
								<div className="flex items-start justify-between gap-2">
									<div>
										<CardTitle className="text-base">{group.label}</CardTitle>
										<CardDescription>{countLabel}</CardDescription>
									</div>
									<Badge variant={getRiskVariant(group.riskLevel)}>{group.riskLevel}</Badge>
								</div>
								<p className="text-xs text-muted-foreground">{group.description}</p>
							</CardHeader>
							<CardContent className="space-y-3">
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										onClick={() => onBulkApprove(group.items.map((item) => item.id))}
										disabled={isBusy}
										aria-label={`Approve ${group.label}`}
									>
										<IconChecks className="mr-1 size-4" aria-hidden="true" />
										{t("common.approve", "Approve")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => setRejectGroupKey(rejectGroupKey === group.key ? null : group.key)}
										disabled={isBusy}
										aria-label={`Reject ${group.label}`}
									>
										<IconX className="mr-1 size-4" aria-hidden="true" />
										{t("common.reject", "Reject")}
									</Button>
								</div>

								{rejectGroupKey === group.key && (
									<div className="space-y-2">
										<Textarea
											aria-label="Bulk reject reason"
											value={rejectReason}
											onChange={(event) => setRejectReason(event.target.value)}
											placeholder={t("approvals:approvals.rejectReasonPlaceholder", "Reason for rejection")}
										/>
										<Button
											size="sm"
											variant="destructive"
											onClick={() => handleReject(group)}
											disabled={isBusy || !rejectReason.trim()}
											aria-label={`Confirm reject ${group.label}`}
										>
											{t("approvals:approvals.confirmReject", "Confirm reject")}
										</Button>
									</div>
								)}

								<Collapsible open={isOpen} onOpenChange={() => toggleGroup(group.key)}>
									<CollapsibleTrigger asChild>
										<Button variant="ghost" size="sm" className="w-full justify-start" aria-label={`Show ${group.label}`}>
											{isOpen ? <IconChevronDown className="mr-1 size-4" /> : <IconChevronRight className="mr-1 size-4" />}
											{t("common.showDetails", "Show details")}
										</Button>
									</CollapsibleTrigger>
									<CollapsibleContent className="space-y-2 pt-2">
										{group.items.map((item) => (
											<div key={item.id} className="rounded-md border p-2 text-sm">
												<div className="font-medium">{item.requester.name}</div>
												<div className="text-muted-foreground">{item.display.summary}</div>
											</div>
										))}
									</CollapsibleContent>
								</Collapsible>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</section>
	);
}
```

- [ ] **Step 4: Run the fast-lanes tests and verify they pass**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.tsx' 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx'
git commit -m "feat: add approval fast lanes"
```

Expected: commit succeeds.

## Task 3: Add Sprint Card And Sprint Panel

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-card.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx`

- [ ] **Step 1: Write the failing sprint panel tests**

Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx`:

```tsx
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriagedApprovalItem } from "@/lib/approvals/triage";
import { ApprovalSprintPanel } from "./approval-sprint-panel";

const approveMock = vi.fn();
const rejectMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/query/use-approval-inbox", () => ({
	useApproveApproval: () => ({ mutateAsync: approveMock, isPending: false }),
	useRejectApproval: () => ({ mutateAsync: rejectMock, isPending: false }),
}));

function approval(id: string, name: string): TriagedApprovalItem {
	return {
		id,
		approvalType: "absence_entry",
		entityId: `${id}-entity`,
		typeName: "Absence",
		requester: { id: `${id}-employee`, userId: `${id}-user`, name, email: `${id}@example.com`, image: null, teamId: null },
		approverId: "manager-1",
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date("2026-05-20T08:00:00.000Z"),
		resolvedAt: null,
		priority: "normal",
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: { title: "Vacation", subtitle: "May 27", summary: "Vacation request" },
		triage: {
			riskLevel: "low",
			riskReasons: ["no_conflicts_detected"],
			fastLaneGroup: "low_risk_absence",
			isPayrollRelevant: false,
			ageDays: 1,
		},
	};
}

function renderPanel(items: TriagedApprovalItem[]) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	const onOpenChange = vi.fn();
	const onActioned = vi.fn();

	render(
		<QueryClientProvider client={queryClient}>
			<ApprovalSprintPanel open={true} items={items} onOpenChange={onOpenChange} onActioned={onActioned} />
		</QueryClientProvider>,
	);

	return { onOpenChange, onActioned };
}

describe("ApprovalSprintPanel", () => {
	beforeEach(() => {
		approveMock.mockReset();
		rejectMock.mockReset();
		approveMock.mockResolvedValue({ success: true });
		rejectMock.mockResolvedValue({ success: true });
	});

	it("advances to the next approval after successful approval", async () => {
		const { onActioned } = renderPanel([approval("approval-1", "Ada Lovelace"), approval("approval-2", "Grace Hopper")]);

		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Approve current approval" }));

		await waitFor(() => expect(screen.getByText("Grace Hopper")).toBeTruthy());
		expect(approveMock).toHaveBeenCalledWith("approval-1");
		expect(onActioned).toHaveBeenCalledTimes(1);
	});

	it("does not advance when approve fails", async () => {
		approveMock.mockResolvedValueOnce({ success: false, error: "No permission" });
		renderPanel([approval("approval-1", "Ada Lovelace"), approval("approval-2", "Grace Hopper")]);

		await userEvent.click(screen.getByRole("button", { name: "Approve current approval" }));

		await waitFor(() => expect(approveMock).toHaveBeenCalledWith("approval-1"));
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.queryByText("Grace Hopper")).toBeNull();
	});

	it("skip advances locally without mutating approvals", async () => {
		renderPanel([approval("approval-1", "Ada Lovelace"), approval("approval-2", "Grace Hopper")]);

		await userEvent.click(screen.getByRole("button", { name: "Skip current approval" }));

		expect(screen.getByText("Grace Hopper")).toBeTruthy();
		expect(approveMock).not.toHaveBeenCalled();
		expect(rejectMock).not.toHaveBeenCalled();
	});

	it("uses keyboard shortcuts for approve and skip", async () => {
		renderPanel([approval("approval-1", "Ada Lovelace"), approval("approval-2", "Grace Hopper")]);

		await userEvent.keyboard("a");
		await waitFor(() => expect(approveMock).toHaveBeenCalledWith("approval-1"));
		await userEvent.keyboard("s");

		expect(screen.getByText("Sprint complete")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the sprint panel tests and verify they fail**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx'`

Expected: FAIL because the sprint panel files do not exist.

- [ ] **Step 3: Implement the sprint card**

Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-card.tsx`:

```tsx
"use client";

import { IconChecks, IconPlayerSkipForward, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { TriagedApprovalItem } from "@/lib/approvals/triage";

interface ApprovalSprintCardProps {
	item: TriagedApprovalItem;
	isBusy: boolean;
	onApprove: () => void;
	onReject: () => void;
	onSkip: () => void;
	onOpenDetails: () => void;
}

function getRiskVariant(riskLevel: TriagedApprovalItem["triage"]["riskLevel"]) {
	if (riskLevel === "high") return "destructive" as const;
	if (riskLevel === "medium") return "outline" as const;
	return "secondary" as const;
}

export function ApprovalSprintCard({ item, isBusy, onApprove, onReject, onSkip, onOpenDetails }: ApprovalSprintCardProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle>{item.requester.name}</CardTitle>
						<p className="text-sm text-muted-foreground">{item.typeName}</p>
					</div>
					<Badge variant={getRiskVariant(item.triage.riskLevel)}>{item.triage.riskLevel}</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div>
					<div className="text-base font-medium">{item.display.title}</div>
					<div className="text-sm text-muted-foreground">{item.display.subtitle}</div>
				</div>
				<p className="text-sm">{item.display.summary}</p>
				<div className="flex flex-wrap gap-2">
					{item.triage.riskReasons.map((reason) => (
						<Badge key={reason} variant="outline">
							{reason.replaceAll("_", " ")}
						</Badge>
					))}
				</div>
				<Button variant="link" className="h-auto p-0" onClick={onOpenDetails}>
					{t("approvals:approvals.openDetails", "Open details")}
				</Button>
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				<Button onClick={onApprove} disabled={isBusy} aria-label="Approve current approval">
					<IconChecks className="mr-1 size-4" aria-hidden="true" />
					{t("common.approve", "Approve")}
				</Button>
				<Button variant="outline" onClick={onReject} disabled={isBusy} aria-label="Reject current approval">
					<IconX className="mr-1 size-4" aria-hidden="true" />
					{t("common.reject", "Reject")}
				</Button>
				<Button variant="ghost" onClick={onSkip} disabled={isBusy} aria-label="Skip current approval">
					<IconPlayerSkipForward className="mr-1 size-4" aria-hidden="true" />
					{t("common.skip", "Skip")}
				</Button>
			</CardFooter>
		</Card>
	);
}
```

- [ ] **Step 4: Implement the sprint panel**

Create `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx`:

```tsx
"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { TriagedApprovalItem } from "@/lib/approvals/triage";
import { useApproveApproval, useRejectApproval } from "@/lib/query/use-approval-inbox";
import { ApprovalSprintCard } from "./approval-sprint-card";

interface ApprovalSprintPanelProps {
	open: boolean;
	items: TriagedApprovalItem[];
	onOpenChange: (open: boolean) => void;
	onActioned: () => void;
	onOpenDetails?: (item: TriagedApprovalItem) => void;
}

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export function ApprovalSprintPanel({ open, items, onOpenChange, onActioned, onOpenDetails }: ApprovalSprintPanelProps) {
	const { t } = useTranslate();
	const approveMutation = useApproveApproval();
	const rejectMutation = useRejectApproval();
	const [index, setIndex] = useState(0);
	const [rejectOpen, setRejectOpen] = useState(false);
	const [rejectReason, setRejectReason] = useState("");

	const currentItem = items[index] ?? null;
	const isBusy = approveMutation.isPending || rejectMutation.isPending;

	useEffect(() => {
		if (open) setIndex(0);
	}, [open, items.length]);

	const advance = useMemo(
		() => () => {
			setIndex((current) => Math.min(current + 1, items.length));
		},
		[items.length],
	);

	async function handleApprove() {
		if (!currentItem || isBusy) return;
		try {
			const result = await approveMutation.mutateAsync(currentItem.id);
			if (result.success) {
				toast.success(t("approvals:approvals.approved", "Request approved"));
				onActioned();
				advance();
			} else {
				toast.error(result.error || t("approvals:approvals.approveFailed", "Failed to approve"));
			}
		} catch (error) {
			toast.error(getErrorMessage(error, t("approvals:approvals.approveFailed", "Failed to approve")));
		}
	}

	async function handleReject() {
		if (!currentItem || isBusy || !rejectReason.trim()) return;
		try {
			const result = await rejectMutation.mutateAsync({ approvalId: currentItem.id, reason: rejectReason.trim() });
			if (result.success) {
				toast.success(t("approvals:approvals.rejected", "Request rejected"));
				setRejectOpen(false);
				setRejectReason("");
				onActioned();
				advance();
			} else {
				toast.error(result.error || t("approvals:approvals.rejectFailed", "Failed to reject"));
			}
		} catch (error) {
			toast.error(getErrorMessage(error, t("approvals:approvals.rejectFailed", "Failed to reject")));
		}
	}

	useEffect(() => {
		if (!open || rejectOpen) return;
		function onKeyDown(event: KeyboardEvent) {
			const key = event.key.toLowerCase();
			if (key === "a") void handleApprove();
			if (key === "r") setRejectOpen(true);
			if (key === "s" || key === "n") advance();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, rejectOpen, currentItem, isBusy, advance]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t("approvals:approvals.sprint.title", "Approval sprint")}</DialogTitle>
					<DialogDescription>
						{currentItem
							? t("approvals:approvals.sprint.position", "Request {current} of {total}", { current: index + 1, total: items.length })
							: t("approvals:approvals.sprint.complete", "Sprint complete")}
					</DialogDescription>
				</DialogHeader>

				{currentItem ? (
					<ApprovalSprintCard
						item={currentItem}
						isBusy={isBusy}
						onApprove={handleApprove}
						onReject={() => setRejectOpen(true)}
						onSkip={advance}
						onOpenDetails={() => onOpenDetails?.(currentItem)}
					/>
				) : (
					<div className="rounded-lg border p-8 text-center">
						<div className="text-lg font-semibold">{t("approvals:approvals.sprint.complete", "Sprint complete")}</div>
						<p className="text-sm text-muted-foreground">{t("approvals:approvals.sprint.completeDescription", "No more loaded approvals in this sprint.")}</p>
					</div>
				)}

				{rejectOpen && currentItem && (
					<div className="space-y-2 rounded-lg border p-3">
						<Textarea
							aria-label="Sprint reject reason"
							value={rejectReason}
							onChange={(event) => setRejectReason(event.target.value)}
							placeholder={t("approvals:approvals.rejectReasonPlaceholder", "Reason for rejection")}
						/>
						<Button variant="destructive" onClick={handleReject} disabled={isBusy || !rejectReason.trim()}>
							{t("approvals:approvals.confirmReject", "Confirm reject")}
						</Button>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.close", "Close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 5: Run the sprint panel tests and verify they pass**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx'`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-card.tsx' 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.tsx' 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx'
git commit -m "feat: add approval sprint panel"
```

Expected: commit succeeds.

## Task 4: Wire Fast Lanes And Sprint Mode Into The Inbox Page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`

- [ ] **Step 1: Add imports and sprint state**

Modify the imports in `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`:

```tsx
import { groupApprovalFastLanes, sortSprintApprovals } from "@/lib/approvals/triage";
import { ApprovalFastLanes } from "./components/approval-fast-lanes";
import { ApprovalSprintPanel } from "./components/approval-sprint-panel";
```

Inside `ApprovalInboxContent`, add state next to the existing state declarations:

```tsx
const [sprintOpen, setSprintOpen] = useState(false);
```

- [ ] **Step 2: Derive fast-lane groups and sprint items**

After the existing `items` and `totalCount` constants, add:

```tsx
const pendingItems = items.filter((item) => item.status === "pending");
const fastLaneGroups = groupApprovalFastLanes(pendingItems);
const sprintItems = sortSprintApprovals(pendingItems);
```

- [ ] **Step 3: Add fast-lane bulk handlers using existing mutations**

Add these callbacks below `handleBulkReject`:

```tsx
const handleFastLaneApprove = useCallback(
	async (approvalIds: string[]) => {
		try {
			const result = await bulkApproveMutation.mutateAsync(approvalIds);
			handleBulkDecisionToasts(
				t,
				result,
				"approvals:approvals.bulkApproveSuccess",
				"approved",
				"approvals:approvals.bulkApproveFailed",
			);
			setSelectedIds(new Set());
			refetch();
		} catch (error) {
			toast.error(getErrorMessage(error, t("approvals:approvals.bulkApproveRequestFailed", "Bulk approve failed")));
		}
	},
	[bulkApproveMutation, refetch, t],
);

const handleFastLaneReject = useCallback(
	async (approvalIds: string[], reason: string) => {
		try {
			const result = await bulkRejectMutation.mutateAsync({ approvalIds, reason });
			handleBulkDecisionToasts(
				t,
				result,
				"approvals:approvals.bulkRejectSuccess",
				"rejected",
				"approvals:approvals.bulkRejectFailed",
			);
			setSelectedIds(new Set());
			refetch();
		} catch (error) {
			toast.error(getErrorMessage(error, t("approvals:approvals.bulkRejectRequestFailed", "Bulk reject failed")));
		}
	},
	[bulkRejectMutation, refetch, t],
);
```

- [ ] **Step 4: Render sprint action, fast lanes, and sprint panel**

In the page header action area, add this button near the refresh button:

```tsx
<Button variant="outline" onClick={() => setSprintOpen(true)} disabled={sprintItems.length === 0}>
	<IconInbox className="mr-2 size-4" aria-hidden="true" />
	{t("approvals:approvals.startSprint", "Start approval sprint")}
</Button>
```

Render fast lanes above `ApprovalInboxToolbar`:

```tsx
<ApprovalFastLanes
	groups={fastLaneGroups}
	isBusy={isBulkActionPending}
	onBulkApprove={handleFastLaneApprove}
	onBulkReject={handleFastLaneReject}
/>
```

Render the sprint panel near the existing `ApprovalDetailPanel`:

```tsx
<ApprovalSprintPanel
	open={sprintOpen}
	items={sprintItems}
	onOpenChange={setSprintOpen}
	onActioned={handleApprovalActioned}
	onOpenDetails={handleOpenDetail}
/>
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/approvals/triage.test.ts
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx'
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx'
```

Expected: PASS for all three commands.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx'
git commit -m "feat: wire approval sprint into inbox"
```

Expected: commit succeeds.

## Task 5: Final Verification And Quality Pass

**Files:**
- Verify changed files from Tasks 1-4.

- [ ] **Step 1: Run approvals-related tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/approvals/triage.test.ts
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-fast-lanes.test.tsx'
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-panel.test.tsx'
pnpm --dir apps/webapp test src/lib/approvals/application/bulk-approval.service.test.ts
```

Expected: PASS for all commands.

- [ ] **Step 2: Run type and lint checks available in the repo**

Run: `pnpm --dir apps/webapp lint`

Expected: PASS. If the project does not define `lint`, run `pnpm --dir apps/webapp test src/lib/approvals/triage.test.ts` again and record that lint is unavailable.

- [ ] **Step 3: Review keyboard and accessibility behavior in source**

Confirm these source facts before completion:

```txt
approval-sprint-panel.tsx uses real buttons for approve, reject, skip, and close.
approval-sprint-panel.tsx disables shortcut handling while the reject reason box is open.
approval-fast-lanes.tsx uses aria-labels for group approve, reject, expand, and confirm-reject controls.
approval-fast-lanes.tsx does not render when there are no groups.
```

- [ ] **Step 4: Commit final fixes if any were needed**

If Step 1 or Step 2 required fixes, run:

```bash
git add apps/webapp/src/lib/approvals apps/webapp/src/app/[locale]/(app)/approvals/inbox
git commit -m "fix: polish approval sprint mode"
```

Expected: commit succeeds if fixes were made. If no fixes were made, do not create an empty commit.
