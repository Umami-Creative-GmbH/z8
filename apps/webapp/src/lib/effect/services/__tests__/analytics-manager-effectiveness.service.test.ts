import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { employee } from "@/db/schema";

vi.mock("@/lib/time-tracking/calculations", () => ({
	calculateExpectedWorkHours: vi.fn(),
	calculateExpectedWorkHoursForEmployee: vi.fn(),
	calculateWorkHours: vi.fn(),
}));

import { DatabaseService } from "../database.service";
import { AnalyticsService } from "../analytics.service";

function conditionIncludes(value: unknown, expected: unknown): boolean {
	const seen = new WeakSet<object>();

	function visit(current: unknown): boolean {
		if (current === expected) return true;
		if (!current || typeof current !== "object") return false;
		if (seen.has(current)) return false;

		seen.add(current);
		return Object.values(current).some(visit);
	}

	return visit(value);
}

describe("AnalyticsService.getManagerEffectiveness", () => {
	it("combines approval sources and scopes manager team sizes through managed employees", async () => {
		const approvalRequestFindMany = vi.fn().mockResolvedValue([
			{
				id: "approval-1",
				organizationId: "org-1",
				entityType: "absence_entry",
				requestedBy: "employee-1",
				approverId: "manager-1",
				status: "approved",
				createdAt: new Date("2026-04-01T08:00:00.000Z"),
				approvedAt: new Date("2026-04-01T12:00:00.000Z"),
				updatedAt: new Date("2026-04-03T12:00:00.000Z"),
				approver: { user: { name: "Mina Manager" } },
				requester: {
					teamId: "team-1",
					user: { name: "Riley Requester" },
					team: { name: "Operations" },
				},
			},
		]);
		const travelExpenseClaimFindMany = vi.fn().mockResolvedValue([
			{
				id: "claim-1",
				organizationId: "org-1",
				employeeId: "employee-2",
				approverId: "manager-1",
				type: "travel_expense_claim",
				status: "submitted",
				submittedAt: new Date("2026-04-02T08:00:00.000Z"),
				decidedAt: null,
				employee: {
					teamId: "team-2",
					user: { name: "Tara Traveler" },
					team: { name: "Field Sales" },
				},
				approver: { user: { name: "Mina Manager" } },
			},
		]);
		const groupBy = vi.fn().mockResolvedValue([{ managerId: "manager-1", count: 7 }]);
		const where = vi.fn().mockReturnValue({ groupBy });
		const innerJoin = vi.fn().mockReturnValue({ where });
		const from = vi.fn().mockReturnValue({ innerJoin });
		const select = vi.fn().mockReturnValue({ from });

		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: {
					query: {
						approvalRequest: { findMany: approvalRequestFindMany },
						travelExpenseClaim: { findMany: travelExpenseClaimFindMany },
					},
					select,
				} as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(AnalyticsService);
				return yield* _(
					service.getManagerEffectiveness({
						organizationId: "org-1",
						dateRange: {
							start: new Date("2026-04-01T00:00:00.000Z"),
							end: new Date("2026-04-30T23:59:59.999Z"),
						},
					}),
				);
			}).pipe(Effect.provide(AnalyticsService.Live), Effect.provide(dbLayer)),
		);

		expect(travelExpenseClaimFindMany).toHaveBeenCalledTimes(1);
		expect(innerJoin).toHaveBeenCalledTimes(1);
		expect(where).toHaveBeenCalledTimes(1);
		const teamSizeWhereCondition = where.mock.calls[0]?.[0];
		expect(conditionIncludes(teamSizeWhereCondition, employee.organizationId)).toBe(true);
		expect(conditionIncludes(teamSizeWhereCondition, "org-1")).toBe(true);
		expect(result.approvalMetrics.totalApprovals).toBe(1);
		expect(result.approvalMetrics.avgDecisionTimeHours).toBe(4);
		expect(result.approvalMetrics.pendingSlaWarnings).toBe(1);
		expect(result.byManager[0]).toMatchObject({
			managerId: "manager-1",
			managerName: "Mina Manager",
			teamSize: 7,
			pendingCount: 1,
		});
		expect(result.byTeam.map((row) => row.label)).toContain("Field Sales");
		expect(result.byType.map((row) => row.id)).toContain("travel_expense_claim");
	});
});
