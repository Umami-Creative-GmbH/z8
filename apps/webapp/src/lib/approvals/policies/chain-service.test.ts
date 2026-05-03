import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	approveCurrentStageInMemory,
	createChainInMemory,
	progressApprovalChainIfLinked,
	resolvePolicyAndCreateApproval,
	rejectCurrentStageInMemory,
} from "./chain-service";
import type { ApprovalDbService } from "../server/types";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

const context: ApprovalPolicyEvaluationContext = {
	organizationId: "org_1",
	approvalType: "absence_entry",
	requesterEmployeeId: "emp_requester",
	teamId: null,
	locationId: null,
	absenceCategoryId: null,
	travelExpenseAmount: null,
	overtimeRisk: null,
	employeeGroupIds: [],
	entityType: "absence_entry",
	entityId: "absence_1",
};

const policy: ApprovalPolicyDraft = {
	id: "policy_1",
	organizationId: "org_1",
	name: "Two step",
	isActive: true,
	priority: 1,
	conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
	stages: [
		{
			id: "stage_1",
			stepOrder: 1,
			label: "Manager",
			approverType: "specific_employee",
			approverEmployeeId: "emp_manager",
		},
		{
			id: "stage_2",
			stepOrder: 2,
			label: "Admin",
			approverType: "specific_employee",
			approverEmployeeId: "emp_admin",
		},
	],
};

describe("chain service in-memory model", () => {
	it("creates one current-stage approval request", () => {
		const chain = createChainInMemory({ context, policy });

		expect(chain.status).toBe("pending");
		expect(chain.stages).toHaveLength(2);
		expect(chain.stages[0].status).toBe("pending");
		expect(chain.stages[0].approvalRequestId).toBe("request_stage_1");
		expect(chain.stages[1].approvalRequestId).toBeNull();
	});

	it("advances to the next stage after approval", () => {
		const chain = createChainInMemory({ context, policy });
		const advanced = approveCurrentStageInMemory(chain, "emp_manager");

		expect(advanced.status).toBe("pending");
		expect(advanced.currentStageOrder).toBe(2);
		expect(advanced.stages[0].status).toBe("approved");
		expect(advanced.stages[1].status).toBe("pending");
		expect(advanced.stages[1].approvalRequestId).toBe("request_stage_2");
	});

	it("rejects the chain at the current stage", () => {
		const chain = createChainInMemory({ context, policy });
		const rejected = rejectCurrentStageInMemory(chain, "emp_manager");

		expect(rejected.status).toBe("rejected");
		expect(rejected.stages[0].status).toBe("rejected");
		expect(rejected.stages[1].approvalRequestId).toBeNull();
	});
});

function createChainProgressionDbService(params: {
	currentStage: Record<string, unknown> | null;
	nextStage?: Record<string, unknown> | null;
	chain?: Record<string, unknown> | null;
}) {
	const insertedApprovals: Record<string, unknown>[] = [];
	const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
	const dbService = {
		db: {
			query: {
				approvalChainStageInstance: {
					findFirst: vi
						.fn()
						.mockResolvedValueOnce(params.currentStage)
						.mockResolvedValueOnce(params.nextStage ?? null),
				},
				approvalChainInstance: {
					findFirst: vi.fn().mockResolvedValue(params.chain ?? null),
				},
			},
			insert: vi.fn((table: unknown) => ({
				values: vi.fn((values: Record<string, unknown>) => {
					insertedApprovals.push(values);
					return { returning: vi.fn().mockResolvedValue([{ id: "approval-next" }]) };
				}),
			})),
			update: vi.fn((table: unknown) => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn(() => {
						updates.push({ table, values });
						return { returning: vi.fn().mockResolvedValue([{ id: "updated" }]) };
					}),
				})),
			})),
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;

	return { dbService, insertedApprovals, updates };
}

describe("progressApprovalChainIfLinked", () => {
	const chain = {
		id: "chain-1",
		organizationId: "org-1",
		entityType: "absence_entry",
		entityId: "absence-1",
		requesterEmployeeId: "emp-requester",
	};

	it("returns chain_pending and creates the next stage approval for intermediate approvals", async () => {
		const { dbService, insertedApprovals, updates } = createChainProgressionDbService({
			chain,
			currentStage: {
				id: "stage-instance-1",
				organizationId: "org-1",
				chainInstanceId: "chain-1",
				stepOrder: 1,
				status: "pending",
			},
			nextStage: {
				id: "stage-instance-2",
				organizationId: "org-1",
				chainInstanceId: "chain-1",
				stepOrder: 2,
				status: "cancelled",
				resolvedApproverEmployeeId: "emp-admin",
			},
		});

		const result = await Effect.runPromise(
			progressApprovalChainIfLinked(dbService, {
				approvalRequestId: "approval-1",
				actorEmployeeId: "emp-manager",
				action: "approve",
			}),
		);

		expect(result).toEqual({ kind: "chain_pending" });
		expect(insertedApprovals).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "absence-1",
				requestedBy: "emp-requester",
				approverId: "emp-admin",
				status: "pending",
			}),
		]);
		expect(updates.map((update) => update.values)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "approved", decidedBy: "emp-manager" }),
				expect.objectContaining({ status: "pending", approvalRequestId: "approval-next" }),
				expect.objectContaining({ currentStageOrder: 2 }),
			]),
		);
	});

	it("returns chain_completed for final linked approvals", async () => {
		const { dbService, updates } = createChainProgressionDbService({
			chain,
			currentStage: {
				id: "stage-instance-2",
				organizationId: "org-1",
				chainInstanceId: "chain-1",
				stepOrder: 2,
				status: "pending",
			},
			nextStage: null,
		});

		const result = await Effect.runPromise(
			progressApprovalChainIfLinked(dbService, {
				approvalRequestId: "approval-2",
				actorEmployeeId: "emp-admin",
				action: "approve",
			}),
		);

		expect(result).toEqual({ kind: "chain_completed", completed: true });
		expect(updates.map((update) => update.values)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "approved", decidedBy: "emp-admin" }),
				expect.objectContaining({ status: "approved" }),
			]),
		);
	});

	it("returns chain_rejected for linked rejections", async () => {
		const { dbService, updates } = createChainProgressionDbService({
			chain,
			currentStage: {
				id: "stage-instance-1",
				organizationId: "org-1",
				chainInstanceId: "chain-1",
				stepOrder: 1,
				status: "pending",
			},
		});

		const result = await Effect.runPromise(
			progressApprovalChainIfLinked(dbService, {
				approvalRequestId: "approval-1",
				actorEmployeeId: "emp-manager",
				action: "reject",
			}),
		);

		expect(result).toEqual({ kind: "chain_rejected", rejected: true });
		expect(updates.map((update) => update.values)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "rejected", decidedBy: "emp-manager" }),
				expect.objectContaining({ status: "rejected" }),
			]),
		);
	});
});

describe("resolvePolicyAndCreateApproval", () => {
	it("creates matched policy chains inside a database transaction when available", async () => {
		const txInserts: Record<string, unknown>[] = [];
		const outerInserts: Record<string, unknown>[] = [];
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
			return await callback({
				insert: vi.fn(() => ({
					values: vi.fn((values: Record<string, unknown>) => {
						txInserts.push(values);
						return { returning: vi.fn().mockResolvedValue([{ id: `tx-${txInserts.length}` }]) };
					}),
				})),
			});
		});
		const dbService = {
			db: {
				query: {
					approvalPolicy: {
						findMany: vi.fn().mockResolvedValue([
							{
								id: "policy-1",
								organizationId: "org-1",
								name: "Absence chain",
								isActive: true,
								priority: 1,
								conditions: [
									{ conditionType: "approval_type", operator: "equals", valueJson: "absence_entry" },
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
						]),
					},
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
				insert: vi.fn(() => ({
					values: vi.fn((values: Record<string, unknown>) => {
						outerInserts.push(values);
						return { returning: vi.fn().mockResolvedValue([{ id: `outer-${outerInserts.length}` }]) };
					}),
				})),
				transaction,
			},
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: {
					organizationId: "org-1",
					approvalType: "absence_entry",
					requesterEmployeeId: "emp-requester",
					teamId: null,
					locationId: null,
					absenceCategoryId: null,
					travelExpenseAmount: null,
					overtimeRisk: null,
					employeeGroupIds: [],
					entityType: "absence_entry",
					entityId: "absence-1",
				},
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({ kind: "chain_created", chainInstanceId: "tx-1", approvalRequestId: "tx-2" });
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(txInserts).toHaveLength(3);
		expect(outerInserts).toHaveLength(0);
	});
});
