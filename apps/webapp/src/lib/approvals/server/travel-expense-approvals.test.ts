import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, DatabaseError } from "@/lib/effect/errors";

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

vi.mock("@/db/schema", () => ({
	approvalRequest: {},
	approvalChainInstance: {},
	approvalChainStageInstance: {},
	approvalPolicy: { organizationId: "organizationId", isActive: "isActive", priority: "priority" },
	employeeGroupMember: { organizationId: "organizationId", employeeId: "employeeId" },
	employeeManagers: { organizationId: "organizationId" },
	travelExpenseClaim: {
		id: "id",
		organizationId: "organizationId",
		status: "status",
	},
	travelExpenseDecisionLog: {},
	employee: {
		id: "id",
	},
}));

import { and, eq } from "drizzle-orm";
import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import { persistTravelExpenseDecision } from "@/lib/approvals/server/travel-expense-approvals";
import { buildTravelExpenseApprovalPolicyContext } from "@/lib/approvals/server/travel-expense-approvals";
import type { ApprovalDbService, CurrentApprover } from "@/lib/approvals/server/types";

function createPolicyResolutionDbService(policies: unknown[]) {
	const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
	const dbService = {
		db: {
			query: {
				approvalPolicy: { findMany: vi.fn().mockResolvedValue(policies) },
				employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{ id: "emp-requester", organizationId: "org-1", isActive: true, role: "employee" },
						{ id: "emp-manager", organizationId: "org-1", isActive: true, role: "manager" },
					]),
				},
				employeeManagers: {
					findMany: vi.fn().mockResolvedValue([
						{ employeeId: "emp-requester", managerId: "emp-manager", isPrimary: true },
					]),
				},
			},
			insert: vi.fn((table: unknown) => ({
				values: vi.fn((values: Record<string, unknown>) => {
					inserts.push({ table, values });
					return { returning: vi.fn().mockResolvedValue([{ id: `insert-${inserts.length}` }]) };
				}),
			})),
			update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;

	return { dbService, inserts };
}

const travelPolicyContext = buildTravelExpenseApprovalPolicyContext({
	id: "claim-1",
	organizationId: "org-1",
	employeeId: "emp-requester",
	totalAmount: "1200.50",
	employee: { teamId: "team-1" },
});

describe("persistTravelExpenseDecision", () => {
	it("keeps the submitted-status guard on the write path", async () => {
		const returning = vi.fn().mockResolvedValue([{ id: "claim-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);

		const dbService = {
			db: {
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		await Effect.runPromise(
			persistTravelExpenseDecision(dbService, "claim-1", currentEmployee, "approve", "looks good"),
		);

		expect(eq).toHaveBeenCalledWith("status", "submitted");
		expect(and).toHaveBeenCalledWith(
			expect.objectContaining({ eq: ["id", "claim-1"] }),
			expect.objectContaining({ eq: ["organizationId", "org-1"] }),
			expect.objectContaining({ eq: ["status", "submitted"] }),
		);
	});

	it("fails stale writes before inserting a decision log", async () => {
		const where = vi.fn().mockResolvedValue([]);
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);

		const dbService = {
			db: {
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		const exit = await Effect.runPromiseExit(
			persistTravelExpenseDecision(
				dbService,
				"claim-1",
				currentEmployee,
				"approve",
				"looks good",
			),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error =
				Option.getOrNull(Cause.failureOption(exit.cause)) ??
				([...(Cause.defects(exit.cause) as Iterable<unknown>)] [0] as unknown);
			expect(error).toBeInstanceOf(ConflictError);
			expect(error).toMatchObject({
				message: "Only submitted claims can be decided",
				conflictType: "travel_expense_claim_status",
			});
		}

		expect(values).not.toHaveBeenCalled();
	});

	it("preserves ConflictError semantics when the database wrapper catches query callback throws", async () => {
		const where = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([]),
		});
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);

		const dbService = {
			db: {
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (name: string, fn: () => Promise<unknown>) =>
				Effect.tryPromise({
					try: fn,
					catch: (error) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause: error,
						}),
				}),
		} as unknown as ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		const exit = await Effect.runPromiseExit(
			persistTravelExpenseDecision(
				dbService,
				"claim-1",
				currentEmployee,
				"approve",
				"looks good",
			),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = Option.getOrNull(Cause.failureOption(exit.cause));
			expect(error).toBeInstanceOf(ConflictError);
			expect(error).not.toBeInstanceOf(DatabaseError);
			expect(error).toMatchObject({
				message: "Only submitted claims can be decided",
				conflictType: "travel_expense_claim_status",
			});
		}

		expect(values).not.toHaveBeenCalled();
	});
});

describe("travel expense approval policy resolution", () => {
	it("uses existing default approval behavior when no approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: travelPolicyContext,
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
		});
	});

	it("creates a chain approval request when an approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Expense policy",
				isActive: true,
				priority: 1,
				conditions: [
					{ conditionType: "approval_type", operator: "equals", valueJson: "travel_expense_claim" },
					{ conditionType: "travel_expense_amount", operator: "gte", amountMin: "1000.00" },
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Manager",
						approverType: "direct_manager",
						approverEmployeeId: null,
					},
				],
			},
		]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: travelPolicyContext,
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({ kind: "chain_created", chainInstanceId: "insert-1", approvalRequestId: "insert-2" });
		expect(inserts).toHaveLength(3);
		expect(inserts.map((insert) => insert.values.organizationId)).toEqual(["org-1", "org-1", "org-1"]);
		expect(inserts[0].values).toMatchObject({ policyId: "policy-1", entityType: "travel_expense_claim" });
		expect(inserts[1].values).toMatchObject({ approverId: "emp-manager", entityId: "claim-1" });
		expect(inserts[2].values).toMatchObject({
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
			resolvedApproverEmployeeId: "emp-manager",
		});
	});
});
