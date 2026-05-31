import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { getApprovalInboxListFromSources } from "@/lib/approvals/inbox/read-service";
import type { ApprovalInboxSource } from "@/lib/approvals/inbox/source-adapters";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { DatabaseService } from "@/lib/effect/services/database.service";

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

	it("provides database services required by registered approval handlers", async () => {
		const approval = item({ id: "approval-from-db-service" });
		const databaseBackedSource: ApprovalInboxSource = {
			type: "absence_entry",
			displayName: "Absence Request",
			supportsBulkApprove: true,
			handler: {
				type: "absence_entry",
				displayName: "Absence Request",
				supportsBulkApprove: true,
				getApprovals: vi.fn(() =>
					Effect.gen(function* (_) {
						const dbService = yield* _(DatabaseService);
						return yield* _(dbService.query("getApprovals", async () => [approval]));
					}),
				),
				getCount: vi.fn(() =>
					Effect.gen(function* (_) {
						const dbService = yield* _(DatabaseService);
						return yield* _(dbService.query("getApprovalCount", async () => 1));
					}),
				),
			} as never,
		};

		const result = await getApprovalInboxListFromSources({
			sources: [databaseBackedSource],
			params: { approverId: "manager-1", organizationId: "org-1", status: "pending", limit: 20 },
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(result.items.map((approval) => approval.id)).toEqual(["approval-from-db-service"]);
		expect(result.counts.absence_entry).toBe(1);
		expect(result.warnings).toEqual([]);
	});

	it("returns page 2 from a stable cursor without repeating page 1", async () => {
		const sources = [
			source("absence_entry", [
				item({ id: "approval-1", createdAt: new Date("2026-05-27T09:00:00.000Z") }),
				item({ id: "approval-2", createdAt: new Date("2026-05-28T09:00:00.000Z") }),
				item({ id: "approval-3", createdAt: new Date("2026-05-29T09:00:00.000Z") }),
			]),
		];

		const firstPage = await getApprovalInboxListFromSources({
			sources,
			params: { approverId: "manager-1", organizationId: "org-1", status: "pending", limit: 2 },
			now: new Date("2026-05-31T09:00:00.000Z"),
		});
		const secondPage = await getApprovalInboxListFromSources({
			sources,
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 2,
				cursor: firstPage.nextCursor ?? undefined,
			},
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(firstPage.items.map((approval) => approval.id)).toEqual(["approval-1", "approval-2"]);
		expect(secondPage.items.map((approval) => approval.id)).toEqual(["approval-3"]);
		expect(secondPage.nextCursor).toBeNull();
	});

	it("clamps non-positive and fractional-under-1 limits to a usable default", async () => {
		const result = await getApprovalInboxListFromSources({
			sources: [source("absence_entry", [item({ id: "approval-1" })])],
			params: { approverId: "manager-1", organizationId: "org-1", status: "pending", limit: 0 },
			now: new Date("2026-05-31T09:00:00.000Z"),
		});
		const fractionalResult = await getApprovalInboxListFromSources({
			sources: [
				source("absence_entry", [item({ id: "approval-1" }), item({ id: "approval-2" })]),
			],
			params: { approverId: "manager-1", organizationId: "org-1", status: "pending", limit: 0.5 },
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(result.items.map((approval) => approval.id)).toEqual(["approval-1"]);
		expect(result.hasMore).toBe(false);
		expect(result.nextCursor).toBeNull();
		expect(fractionalResult.items.map((approval) => approval.id)).toEqual([
			"approval-1",
			"approval-2",
		]);
		expect(fractionalResult.hasMore).toBe(false);
		expect(fractionalResult.nextCursor).toBeNull();
	});

	it("filters list items while preserving full count shape and supported types", async () => {
		const result = await getApprovalInboxListFromSources({
			sources: [
				source("absence_entry", [item({ id: "absence-1" })]),
				source("time_entry", [item({ id: "time-1", approvalType: "time_entry" })]),
				source("travel_expense_claim", [
					item({ id: "expense-1", approvalType: "travel_expense_claim" }),
				]),
			],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
				types: ["absence_entry"],
			},
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(result.items.map((approval) => approval.type)).toEqual(["absence_entry"]);
		expect(result.counts).toEqual({
			absence_entry: 1,
			time_entry: 1,
			travel_expense_claim: 1,
		});
		expect(result.supportedTypes).toEqual(["absence_entry", "time_entry", "travel_expense_claim"]);
	});

	it("passes approval visibility options to count handlers", async () => {
		const absenceSource = source("absence_entry", [item({ id: "approval-1" })]);
		const eligibleApprovalScopes = [
			{ requesterEmployeeId: "employee-1", eligibleApproverIds: ["manager-1"] },
		];

		await getApprovalInboxListFromSources({
			sources: [absenceSource],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
				eligibleApprovalScopes,
				includeAllApprovers: true,
			},
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(absenceSource.handler.getCount).toHaveBeenCalledWith("manager-1", "org-1", {
			eligibleApprovalScopes,
			includeAllApprovers: true,
		});
	});
});
