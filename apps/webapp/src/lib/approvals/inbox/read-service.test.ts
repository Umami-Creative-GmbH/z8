import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import type { OrdinaryCanonicalApproval } from "@/lib/approvals/inbox/ordinary-canonical-read";
import { getApprovalInboxListFromSources } from "@/lib/approvals/inbox/read-service";
import type { ApprovalInboxSource } from "@/lib/approvals/inbox/source-adapters";
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

function source(
	type: ApprovalInboxSource["type"],
	items: UnifiedApprovalItem[],
): ApprovalInboxSource {
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

function canonicalItem(
	id: string,
	createdAt: string,
	priority: "urgent" | "high" | "normal" | "low",
	riskLevel: "high" | "medium" | "low",
): OrdinaryCanonicalApproval {
	return {
		item: {
			id,
			type: "time_entry",
			entityId: id,
			status: "pending",
			requester: {
				id: "employee-1",
				name: "Avery",
				email: "avery@example.com",
				image: null,
				teamId: null,
			},
			summary: {
				title: "Manual Time Submission",
				subtitle: "Jun 1",
				detail: "8h",
				badge: null,
			},
			timing: {
				createdAt,
				resolvedAt: null,
				slaDeadline: null,
				ageDays: 0,
			},
			triage: {
				priority,
				riskLevel,
				riskReasons: [riskLevel === "high" ? "stale_pending" : "needs_review"],
				fastLaneGroup: riskLevel === "high" ? "stale_pending" : null,
				isPayrollRelevant: false,
				explanation: "Needs review.",
			},
			capabilities: {
				canApprove: true,
				canReject: true,
				canBulkApprove: true,
				requiresRejectReason: true,
			},
		},
	} as OrdinaryCanonicalApproval;
}

describe("getApprovalInboxListFromSources", () => {
	it("merges canonical-only ordinary items into list and count", async () => {
		const canonicalItem = {
			item: {
				id: "assignment-1",
				type: "time_entry",
				entityId: "period-1",
				status: "pending",
				requester: {
					id: "employee-1",
					name: "Avery",
					email: "avery@example.com",
					image: null,
					teamId: null,
				},
				summary: {
					title: "Manual Time Submission",
					subtitle: "Jul 20",
					detail: "8h",
					badge: null,
				},
				timing: {
					createdAt: "2026-05-30T09:00:00.000Z",
					resolvedAt: null,
					slaDeadline: null,
					ageDays: 1,
				},
				triage: {
					priority: "low",
					riskLevel: "medium",
					riskReasons: ["needs_review"],
					fastLaneGroup: null,
					isPayrollRelevant: false,
					explanation: "Needs manual review.",
				},
				capabilities: {
					canApprove: true,
					canReject: true,
					canBulkApprove: true,
					requiresRejectReason: true,
				},
			},
		} as OrdinaryCanonicalApproval;
		const canonicalBatch = Object.assign(
			[canonicalItem, "assignment-2", "assignment-3"].map((value, index) =>
				typeof value === "string"
					? ({
							...canonicalItem,
							item: {
								...canonicalItem.item,
								id: value,
								timing: {
									...canonicalItem.item.timing,
									createdAt: [
										"2026-05-30T09:00:00.000Z",
										"2026-05-31T09:00:00.000Z",
										"2026-06-01T09:00:00.000Z",
									][index] as string,
								},
							},
						} as OrdinaryCanonicalApproval)
					: value,
			),
			{ totalCount: 3 },
		);
		const loadCanonicalOrdinaryApprovals = vi.fn(async () => canonicalBatch);

		const result = await getApprovalInboxListFromSources({
			sources: [source("time_entry", [])],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 2,
			},
			loadCanonicalOrdinaryApprovals,
		});

		expect(result.items.map(({ id }) => id)).toEqual([
			"assignment-1",
			"assignment-2",
		]);
		expect(result.hasMore).toBe(true);
		expect(result.nextCursor).not.toBeNull();
		expect(result.counts.time_entry).toBe(3);
		expect(result.total).toBe(3);
		expect(loadCanonicalOrdinaryApprovals).toHaveBeenCalledWith({
			approverId: "manager-1",
			organizationId: "org-1",
			eligibleApprovalScopes: undefined,
			includeAllApprovers: undefined,
			search: undefined,
			teamId: undefined,
			limit: 3,
			cursor: undefined,
			now: expect.any(Date),
		});
	});

	it("does not load canonical ordinary items when time entries are excluded", async () => {
		const loadCanonicalOrdinaryApprovals = vi.fn(async () => []);
		const countCanonicalOrdinaryApprovals = vi.fn(async () => 2);

		const result = await getApprovalInboxListFromSources({
			sources: [
				source("absence_entry", [item({ id: "absence-1" })]),
				source("time_entry", [
					item({ id: "legacy-time-1", approvalType: "time_entry" }),
				]),
			],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				types: ["absence_entry"],
			},
			loadCanonicalOrdinaryApprovals,
			countCanonicalOrdinaryApprovals,
		});

		expect(loadCanonicalOrdinaryApprovals).not.toHaveBeenCalled();
		expect(countCanonicalOrdinaryApprovals).toHaveBeenCalledTimes(1);
		expect(result.items.map(({ id }) => id)).toEqual(["absence-1"]);
		expect(result.counts.time_entry).toBe(3);
		expect(result.total).toBe(4);
	});

	it("returns serializable items sorted by risk and age", async () => {
		const result = await getApprovalInboxListFromSources({
			sources: [
				source("absence_entry", [
					item({
						id: "new-low",
						createdAt: new Date("2026-05-31T09:00:00.000Z"),
						priority: "low",
					}),
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

		expect(result.items.map((approval) => approval.id)).toEqual([
			"old-high",
			"new-low",
		]);
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
			sources: [
				source("absence_entry", [item({ id: "approval-1" })]),
				brokenSource,
			],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			},
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(result.items).toHaveLength(1);
		expect(result.warnings).toEqual([
			{
				source: "time_entry",
				message: "Time Correction approvals could not be loaded.",
			},
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
						return yield* _(
							dbService.query("getApprovals", async () => [approval]),
						);
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
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			},
			now: new Date("2026-05-31T09:00:00.000Z"),
		});

		expect(result.items.map((approval) => approval.id)).toEqual([
			"approval-from-db-service",
		]);
		expect(result.counts.absence_entry).toBe(1);
		expect(result.warnings).toEqual([]);
	});

	it("returns page 2 from a stable cursor without repeating page 1", async () => {
		const sources = [
			source("absence_entry", [
				item({
					id: "approval-1",
					createdAt: new Date("2026-05-27T09:00:00.000Z"),
				}),
				item({
					id: "approval-2",
					createdAt: new Date("2026-05-28T09:00:00.000Z"),
				}),
				item({
					id: "approval-3",
					createdAt: new Date("2026-05-29T09:00:00.000Z"),
				}),
			]),
		];

		const firstPage = await getApprovalInboxListFromSources({
			sources,
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 2,
			},
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

		expect(firstPage.items.map((approval) => approval.id)).toEqual([
			"approval-1",
			"approval-2",
		]);
		expect(secondPage.items.map((approval) => approval.id)).toEqual([
			"approval-3",
		]);
		expect(secondPage.nextCursor).toBeNull();
	});

	it("pages interleaved compatibility and canonical ordinary rows without gaps", async () => {
		const now = new Date("2026-06-01T09:00:00.000Z");
		const canonical = [
			canonicalItem(
				"canonical-high",
				"2026-05-28T09:00:00.000Z",
				"high",
				"high",
			),
			canonicalItem(
				"canonical-normal",
				"2026-05-29T09:00:00.000Z",
				"normal",
				"high",
			),
			canonicalItem(
				"canonical-urgent",
				"2026-05-31T09:00:00.000Z",
				"urgent",
				"medium",
			),
			canonicalItem(
				"canonical-low",
				"2026-06-01T09:00:00.000Z",
				"low",
				"medium",
			),
		];
		const ranks = {
			risk: { high: 0, medium: 1, low: 2 },
			priority: { urgent: 0, high: 1, normal: 2, low: 3 },
		} as const;
		const loadCanonicalOrdinaryApprovals = vi.fn(async (input) => {
			const rows = input.cursor
				? canonical.filter(
						({ item: candidate }) =>
							ranks.risk[candidate.triage.riskLevel] >
								ranks.risk[
									input.cursor?.riskLevel as keyof typeof ranks.risk
								] ||
							(ranks.risk[candidate.triage.riskLevel] ===
								ranks.risk[
									input.cursor?.riskLevel as keyof typeof ranks.risk
								] &&
								(ranks.priority[candidate.triage.priority] >
									ranks.priority[
										input.cursor?.priority as keyof typeof ranks.priority
									] ||
									(ranks.priority[candidate.triage.priority] ===
										ranks.priority[
											input.cursor?.priority as keyof typeof ranks.priority
										] &&
										(candidate.timing.createdAt > input.cursor.createdAt ||
											(candidate.timing.createdAt === input.cursor.createdAt &&
												candidate.id > input.cursor.id))))),
					)
				: canonical;
			return rows.slice(0, input.limit);
		});
		const sources = [
			source("time_entry", [
				item({
					id: "compatibility-urgent",
					approvalType: "time_entry",
					createdAt: new Date("2026-05-27T09:00:00.000Z"),
					priority: "urgent",
				}),
				item({
					id: "compatibility-low",
					approvalType: "time_entry",
					createdAt: new Date("2026-06-01T08:00:00.000Z"),
					priority: "low",
				}),
			]),
		];
		const ids: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await getApprovalInboxListFromSources({
				sources,
				params: {
					approverId: "manager-1",
					organizationId: "org-1",
					status: "pending",
					limit: 2,
					cursor,
				},
				now,
				loadCanonicalOrdinaryApprovals,
				countCanonicalOrdinaryApprovals: async () => canonical.length,
			});
			ids.push(...page.items.map(({ id }) => id));
			cursor = page.nextCursor ?? undefined;
		} while (cursor);

		expect(ids).toEqual([
			"compatibility-urgent",
			"canonical-high",
			"canonical-normal",
			"canonical-urgent",
			"compatibility-low",
			"canonical-low",
		]);
		expect(
			loadCanonicalOrdinaryApprovals.mock.calls[1]?.[0].cursor,
		).toMatchObject({
			riskLevel: "high",
			priority: "high",
		});
	});

	it("clamps non-positive and fractional-under-1 limits to a usable default", async () => {
		const result = await getApprovalInboxListFromSources({
			sources: [source("absence_entry", [item({ id: "approval-1" })])],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 0,
			},
			now: new Date("2026-05-31T09:00:00.000Z"),
		});
		const fractionalResult = await getApprovalInboxListFromSources({
			sources: [
				source("absence_entry", [
					item({ id: "approval-1" }),
					item({ id: "approval-2" }),
				]),
			],
			params: {
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 0.5,
			},
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
				source("time_entry", [
					item({ id: "time-1", approvalType: "time_entry" }),
				]),
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

		expect(result.items.map((approval) => approval.type)).toEqual([
			"absence_entry",
		]);
		expect(result.counts).toEqual({
			absence_entry: 1,
			time_entry: 1,
			travel_expense_claim: 1,
		});
		expect(result.supportedTypes).toEqual([
			"absence_entry",
			"time_entry",
			"travel_expense_claim",
		]);
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

		expect(absenceSource.handler.getCount).toHaveBeenCalledWith(
			"manager-1",
			"org-1",
			{
				eligibleApprovalScopes,
				includeAllApprovers: true,
			},
		);
	});

	it("keeps unclassified time approvals visible but disables every decision capability", async () => {
		const result = await getApprovalInboxListFromSources({
			sources: [
				source("time_entry", [
					item({
						id: "legacy-time-1",
						approvalType: "time_entry",
						isActionable: false,
						warning: "Reconcile this legacy request before making a decision.",
						display: {
							title: "Unclassified Time Approval",
							subtitle: "Jul 14, 2026",
							summary:
								"Reconcile this legacy request before making a decision.",
						},
					}),
				]),
			],
			params: { approverId: "manager-1", organizationId: "org-1", limit: 20 },
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			id: "legacy-time-1",
			summary: {
				title: "Unclassified Time Approval",
				detail: "Reconcile this legacy request before making a decision.",
			},
			capabilities: {
				canApprove: false,
				canReject: false,
				canBulkApprove: false,
			},
		});
	});
});
