import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalPriority, ApprovalType, UnifiedApprovalItem } from "@/lib/approvals/domain/types";

const approvalQueryTestState = vi.hoisted(() => ({
	handlers: [] as Array<{
		type: ApprovalType;
		getApprovals: ReturnType<typeof vi.fn>;
		getCount: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("@/lib/approvals/domain/registry", () => ({
	getAllApprovalHandlers: () => approvalQueryTestState.handlers,
}));

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context, Layer } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");

	return {
		DatabaseService,
		DatabaseServiceLive: Layer.succeed(DatabaseService, DatabaseService.of({})),
	};
});

import {
	ApprovalQueryService,
	ApprovalQueryServiceLive,
} from "@/lib/approvals/application/approval-query.service";
import type { AnyAppError } from "@/lib/effect/errors";

function createUnifiedApprovalItem(params: {
	id: string;
	approvalType: ApprovalType;
	createdAt: string;
	priority: ApprovalPriority;
}): UnifiedApprovalItem {
	return {
		id: params.id,
		approvalType: params.approvalType,
		entityId: `${params.approvalType}-${params.id}`,
		typeName: params.approvalType,
		requester: {
			id: "employee-1",
			userId: "user-1",
			name: "Casey Booker",
			email: "casey@example.com",
			image: null,
			teamId: "team-1",
		},
		approverId: "manager-1",
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date(params.createdAt),
		resolvedAt: null,
		priority: params.priority,
		sla: {
			deadline: null,
			status: "on_time",
			hoursRemaining: null,
		},
		display: {
			title: params.approvalType,
			subtitle: params.id,
			summary: params.id,
		},
	};
}

async function runApprovalQuery<T>(effect: Effect.Effect<T, AnyAppError, any>): Promise<T> {
	return Effect.runPromise(
		effect.pipe(Effect.provide(ApprovalQueryServiceLive)) as Effect.Effect<T, AnyAppError, never>,
	);
}

describe("ApprovalQueryService", () => {
	it("returns mixed-type inbox results that include travel expense claims", async () => {
		approvalQueryTestState.handlers = [
			{
				type: "absence_entry",
				getApprovals: vi.fn(() =>
					Effect.succeed([
						createUnifiedApprovalItem({
							id: "absence-1",
							approvalType: "absence_entry",
							createdAt: "2026-04-10T09:00:00.000Z",
							priority: "normal",
						}),
					]),
				),
				getCount: vi.fn(() => Effect.succeed(1)),
			},
			{
				type: "travel_expense_claim",
				getApprovals: vi.fn(() =>
					Effect.succeed([
						createUnifiedApprovalItem({
							id: "travel-1",
							approvalType: "travel_expense_claim",
							createdAt: "2026-04-11T09:00:00.000Z",
							priority: "high",
						}),
					]),
				),
				getCount: vi.fn(() => Effect.succeed(2)),
			},
		];

		const result = await runApprovalQuery(
			Effect.gen(function* (_) {
				const service = yield* _(ApprovalQueryService);
				return yield* _(
					service.getApprovals({
						approverId: "manager-1",
						organizationId: "org-1",
						status: "pending",
						limit: 10,
					}),
				);
			}),
		);

		expect(result.items.map((item) => item.approvalType)).toEqual([
			"travel_expense_claim",
			"absence_entry",
		]);
		expect(result.total).toBe(2);
		expect(result.hasMore).toBe(false);
	});

	it("returns zero-defaulted counts including travel expense claims", async () => {
		approvalQueryTestState.handlers = [
			{
				type: "absence_entry",
				getApprovals: vi.fn(() => Effect.succeed([])),
				getCount: vi.fn(() => Effect.succeed(3)),
			},
			{
				type: "time_entry",
				getApprovals: vi.fn(() => Effect.succeed([])),
				getCount: vi.fn(() => Effect.succeed(1)),
			},
		];

		const counts = await runApprovalQuery(
			Effect.gen(function* (_) {
				const service = yield* _(ApprovalQueryService);
				return yield* _(service.getCounts("manager-1", "org-1"));
			}),
		);

		expect(counts).toEqual({
			absence_entry: 3,
			time_entry: 1,
			shift_request: 0,
			travel_expense_claim: 0,
		});
	});

	it("keeps same-timestamp items reachable across cursor pages", async () => {
		approvalQueryTestState.handlers = [
			{
				type: "absence_entry",
				getApprovals: vi.fn(() =>
					Effect.succeed([
						createUnifiedApprovalItem({
							id: "approval-a",
							approvalType: "absence_entry",
							createdAt: "2026-04-11T09:00:00.000Z",
							priority: "normal",
						}),
					]),
				),
				getCount: vi.fn(() => Effect.succeed(1)),
			},
			{
				type: "travel_expense_claim",
				getApprovals: vi.fn(() =>
					Effect.succeed([
						createUnifiedApprovalItem({
							id: "approval-b",
							approvalType: "travel_expense_claim",
							createdAt: "2026-04-11T09:00:00.000Z",
							priority: "normal",
						}),
						createUnifiedApprovalItem({
							id: "approval-c",
							approvalType: "travel_expense_claim",
							createdAt: "2026-04-10T09:00:00.000Z",
							priority: "normal",
						}),
					]),
				),
				getCount: vi.fn(() => Effect.succeed(2)),
			},
		];

		const firstPage = await runApprovalQuery(
			Effect.gen(function* (_) {
				const service = yield* _(ApprovalQueryService);
				return yield* _(
					service.getApprovals({
						approverId: "manager-1",
						organizationId: "org-1",
						status: "pending",
						limit: 1,
					}),
				);
			}),
		);

		const secondPage = await runApprovalQuery(
			Effect.gen(function* (_) {
				const service = yield* _(ApprovalQueryService);
				return yield* _(
					service.getApprovals({
						approverId: "manager-1",
						organizationId: "org-1",
						status: "pending",
						cursor: firstPage.nextCursor ?? undefined,
						limit: 2,
					}),
				);
			}),
		);

		expect(firstPage.nextCursor).toBeTruthy();
		expect(secondPage.items.map((item) => item.id)).toEqual(["approval-b", "approval-c"]);
	});

	it("keeps newer lower-priority items reachable after an older urgent cursor", async () => {
		approvalQueryTestState.handlers = [
			{
				type: "absence_entry",
				getApprovals: vi.fn(() =>
					Effect.succeed([
						createUnifiedApprovalItem({
							id: "urgent-older",
							approvalType: "absence_entry",
							createdAt: "2026-04-10T09:00:00.000Z",
							priority: "urgent",
						}),
					]),
				),
				getCount: vi.fn(() => Effect.succeed(1)),
			},
			{
				type: "travel_expense_claim",
				getApprovals: vi.fn(() =>
					Effect.succeed([
						createUnifiedApprovalItem({
							id: "normal-newer",
							approvalType: "travel_expense_claim",
							createdAt: "2026-04-11T09:00:00.000Z",
							priority: "normal",
						}),
						createUnifiedApprovalItem({
							id: "low-newer",
							approvalType: "travel_expense_claim",
							createdAt: "2026-04-12T09:00:00.000Z",
							priority: "low",
						}),
					]),
				),
				getCount: vi.fn(() => Effect.succeed(2)),
			},
		];

		const firstPage = await runApprovalQuery(
			Effect.gen(function* (_) {
				const service = yield* _(ApprovalQueryService);
				return yield* _(
					service.getApprovals({
						approverId: "manager-1",
						organizationId: "org-1",
						status: "pending",
						limit: 1,
					}),
				);
			}),
		);

		const secondPage = await runApprovalQuery(
			Effect.gen(function* (_) {
				const service = yield* _(ApprovalQueryService);
				return yield* _(
					service.getApprovals({
						approverId: "manager-1",
						organizationId: "org-1",
						status: "pending",
						cursor: firstPage.nextCursor ?? undefined,
						limit: 2,
					}),
				);
			}),
		);

		expect(firstPage.items.map((item) => item.id)).toEqual(["urgent-older"]);
		expect(secondPage.items.map((item) => item.id)).toEqual(["normal-newer", "low-newer"]);
	});

	it("continues correctly from legacy ISO cursors without skipping higher-priority items", async () => {
		approvalQueryTestState.handlers = [
			{
				type: "absence_entry",
				getApprovals: vi.fn(() =>
					Effect.succeed([
						createUnifiedApprovalItem({
							id: "urgent-same-time",
							approvalType: "absence_entry",
							createdAt: "2026-04-10T09:00:00.000Z",
							priority: "urgent",
						}),
						createUnifiedApprovalItem({
							id: "normal-same-time",
							approvalType: "absence_entry",
							createdAt: "2026-04-10T09:00:00.000Z",
							priority: "normal",
						}),
						createUnifiedApprovalItem({
							id: "older-low",
							approvalType: "absence_entry",
							createdAt: "2026-04-09T09:00:00.000Z",
							priority: "low",
						}),
					]),
				),
				getCount: vi.fn(() => Effect.succeed(3)),
			},
		];

		const result = await runApprovalQuery(
			Effect.gen(function* (_) {
				const service = yield* _(ApprovalQueryService);
				return yield* _(
					service.getApprovals({
						approverId: "manager-1",
						organizationId: "org-1",
						status: "pending",
						cursor: "2026-04-10T09:00:00.000Z",
						limit: 10,
					}),
				);
			}),
		);

		expect(result.items.map((item) => item.id)).toEqual([
			"urgent-same-time",
			"normal-same-time",
			"older-low",
		]);
	});

	it("keeps older approvals reachable when paging deep into a single busy handler", async () => {
		const sameHandlerItems = Array.from({ length: 10 }, (_, index) =>
			createUnifiedApprovalItem({
				id: `approval-${index + 1}`,
				approvalType: "absence_entry",
				createdAt: `2026-04-${String(20 - index).padStart(2, "0")}T09:00:00.000Z`,
				priority: "normal",
			}),
		);

		approvalQueryTestState.handlers = [
			{
				type: "absence_entry",
				getApprovals: vi.fn(() => Effect.succeed(sameHandlerItems)),
				getCount: vi.fn(() => Effect.succeed(sameHandlerItems.length)),
			},
		];

		const collectedIds: string[] = [];
		let cursor: string | undefined;

		for (let page = 0; page < 5; page += 1) {
			const result = await runApprovalQuery(
				Effect.gen(function* (_) {
					const service = yield* _(ApprovalQueryService);
					return yield* _(
						service.getApprovals({
							approverId: "manager-1",
							organizationId: "org-1",
							status: "pending",
							cursor,
							limit: 2,
						}),
					);
				}),
			);

			collectedIds.push(...result.items.map((item) => item.id));
			cursor = result.nextCursor ?? undefined;
		}

		expect(collectedIds).toEqual(sameHandlerItems.map((item) => item.id));
	});
});
