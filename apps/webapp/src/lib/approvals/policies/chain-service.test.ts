import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalDbService } from "../server/types";
import {
	approveCurrentStageInMemory,
	createChainInMemory,
	progressApprovalChainIfLinked,
	rejectCurrentStageInMemory,
	resolvePolicyAndCreateApproval,
} from "./chain-service";
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
	const auditEvents: Record<string, unknown>[] = [];
	const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
	const dbService = {
		db: {
			query: {
				approvalRequest: {
					findFirst: vi.fn().mockResolvedValue({ metadata: null }),
				},
				auditLog: {},
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
					if (
						values.action &&
						typeof values.action === "string" &&
						values.action.startsWith("approval_")
					) {
						auditEvents.push(values);
					} else {
						insertedApprovals.push(values);
					}
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

	return { dbService, insertedApprovals, auditEvents, updates };
}

function expectAuditEvents(auditEvents: Record<string, unknown>[], eventNames: string[]) {
	expect(auditEvents.map((event) => event.action)).toEqual(eventNames);
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
				actorUserId: "user-manager",
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
				actorUserId: "user-admin",
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
				actorUserId: "user-manager",
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

	it("records stage approved and chain approved audit events", async () => {
		const { dbService, auditEvents } = createChainProgressionDbService({
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

		await Effect.runPromise(
			progressApprovalChainIfLinked(dbService, {
				approvalRequestId: "approval-2",
				actorEmployeeId: "emp-admin",
				actorUserId: "user-admin",
				action: "approve",
			}),
		);

		expectAuditEvents(auditEvents, ["approval_chain.stage_approved", "approval_chain.approved"]);
		expect(auditEvents).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "absence-1",
				performedBy: "user-admin",
				employeeId: "emp-admin",
			}),
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "absence-1",
				performedBy: "user-admin",
				employeeId: "emp-admin",
			}),
		]);
	});

	it("records stage rejected and chain rejected audit events", async () => {
		const { dbService, auditEvents } = createChainProgressionDbService({
			chain,
			currentStage: {
				id: "stage-instance-1",
				organizationId: "org-1",
				chainInstanceId: "chain-1",
				stepOrder: 1,
				status: "pending",
			},
		});

		await Effect.runPromise(
			progressApprovalChainIfLinked(dbService, {
				approvalRequestId: "approval-1",
				actorEmployeeId: "emp-manager",
				actorUserId: "user-manager",
				action: "reject",
			}),
		);

		expectAuditEvents(auditEvents, ["approval_chain.stage_rejected", "approval_chain.rejected"]);
	});
});

describe("resolvePolicyAndCreateApproval", () => {
	function createPolicyResolutionDbService(params: {
		policies: Record<string, unknown>[];
		groupRows?: Record<string, unknown>[];
		activeGroups?: Record<string, unknown>[];
		employees?: Record<string, unknown>[];
		employeeManagers?: Record<string, unknown>[];
		teamMemberships?: Record<string, unknown>[];
		teams?: Record<string, unknown>[];
	}) {
		const txInserts: Record<string, unknown>[] = [];
		const outerInserts: Record<string, unknown>[] = [];
		const auditEvents: Record<string, unknown>[] = [];
		const captureInsert = (values: Record<string, unknown>) => {
			if (
				values.action &&
				typeof values.action === "string" &&
				values.action.startsWith("approval_")
			) {
				auditEvents.push(values);
			} else {
				txInserts.push(values);
			}
			return { returning: vi.fn().mockResolvedValue([{ id: `tx-${txInserts.length}` }]) };
		};
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
			return await callback({
				insert: vi.fn(() => ({
					values: vi.fn(captureInsert),
				})),
			});
		});
		const dbService = {
			db: {
				query: {
					auditLog: {},
					approvalPolicy: { findMany: vi.fn().mockResolvedValue(params.policies) },
					employeeGroupMember: { findMany: vi.fn().mockResolvedValue(params.groupRows ?? []) },
					employeeGroup: { findMany: vi.fn().mockResolvedValue(params.activeGroups ?? []) },
					employee: {
						findMany: vi.fn().mockResolvedValue(
							params.employees ?? [
								{
									id: "emp-requester",
									userId: "user-requester",
									organizationId: "org-1",
									isActive: true,
									role: "employee",
								},
								{ id: "emp-manager", organizationId: "org-1", isActive: true, role: "manager" },
							],
						),
					},
					employeeManagers: {
						findMany: vi
							.fn()
							.mockResolvedValue(
								params.employeeManagers ?? [
									{ employeeId: "emp-requester", managerId: "emp-manager", isPrimary: true },
								],
							),
					},
					teamMembership: { findMany: vi.fn().mockResolvedValue(params.teamMemberships ?? []) },
					team: { findMany: vi.fn().mockResolvedValue(params.teams ?? []) },
				},
				insert: vi.fn(() => ({
					values: vi.fn((values: Record<string, unknown>) => {
						if (
							values.action &&
							typeof values.action === "string" &&
							values.action.startsWith("approval_")
						) {
							auditEvents.push(values);
						} else {
							outerInserts.push(values);
						}
						return {
							returning: vi.fn().mockResolvedValue([{ id: `outer-${outerInserts.length}` }]),
						};
					}),
				})),
				transaction,
			},
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		return { dbService, txInserts, outerInserts, auditEvents, transaction };
	}

	const dbPolicy = {
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
	};

	it("creates matched policy chains inside a database transaction when available", async () => {
		const txInserts: Record<string, unknown>[] = [];
		const auditEvents: Record<string, unknown>[] = [];
		const outerInserts: Record<string, unknown>[] = [];
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
			return await callback({
				insert: vi.fn(() => ({
					values: vi.fn((values: Record<string, unknown>) => {
						if (
							values.action &&
							typeof values.action === "string" &&
							values.action.startsWith("approval_")
						) {
							auditEvents.push(values);
						} else {
							txInserts.push(values);
						}
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
									{
										conditionType: "approval_type",
										operator: "equals",
										valueJson: "absence_entry",
									},
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
					employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
					employee: {
						findMany: vi.fn().mockResolvedValue([
							{
								id: "emp-requester",
								userId: "user-requester",
								organizationId: "org-1",
								isActive: true,
								role: "employee",
							},
							{ id: "emp-manager", organizationId: "org-1", isActive: true, role: "manager" },
						]),
					},
					employeeManagers: {
						findMany: vi
							.fn()
							.mockResolvedValue([
								{ employeeId: "emp-requester", managerId: "emp-manager", isPrimary: true },
							]),
					},
					teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
					team: { findMany: vi.fn().mockResolvedValue([]) },
				},
				insert: vi.fn(() => ({
					values: vi.fn((values: Record<string, unknown>) => {
						outerInserts.push(values);
						return {
							returning: vi.fn().mockResolvedValue([{ id: `outer-${outerInserts.length}` }]),
						};
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

		expect(result).toEqual({
			kind: "chain_created",
			chainInstanceId: "tx-1",
			approvalRequestId: "tx-2",
		});
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(txInserts).toHaveLength(3);
		expect(outerInserts).toHaveLength(0);
	});

	it("resolves direct manager policy stages through team primary manager fallback", async () => {
		const { dbService, txInserts } = createPolicyResolutionDbService({
			policies: [
				{
					id: "policy-1",
					organizationId: "org-1",
					name: "Absence policy",
					isActive: true,
					priority: 1,
					conditions: [],
					stages: [
						{ id: "stage-1", stepOrder: 1, label: "Manager", approverType: "direct_manager" },
					],
				},
			],
			employees: [
				{
					id: "requester",
					organizationId: "org-1",
					userId: "user-requester",
					isActive: true,
					role: "employee",
				},
				{
					id: "team-manager",
					organizationId: "org-1",
					userId: "user-manager",
					isActive: true,
					role: "manager",
				},
			],
			employeeManagers: [],
			teamMemberships: [{ employeeId: "requester", teamId: "team-1" }],
			teams: [{ id: "team-1", organizationId: "org-1", primaryManagerId: "team-manager" }],
		});

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: {
					organizationId: "org-1",
					approvalType: "absence_entry",
					requesterEmployeeId: "requester",
					teamId: null,
					locationId: null,
					absenceCategoryId: null,
					travelExpenseAmount: null,
					overtimeRisk: null,
					employeeGroupIds: [],
					entityType: "absence_entry",
					entityId: "absence-1",
				},
				defaultApproverId: "fallback-manager",
			}),
		);

		expect(result.kind).toBe("chain_created");
		expect(txInserts.some((insert) => insert.approverId === "team-manager")).toBe(true);
	});

	it("matches policy conditions stored by settings actions", async () => {
		const { dbService } = createPolicyResolutionDbService({
			policies: [
				{
					...dbPolicy,
					conditions: [
						{
							conditionType: "approval_type",
							operator: "in",
							valueJson: { value: undefined, values: ["absence_entry"] },
						},
					],
				},
			],
		});

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

		expect(result.kind).toBe("chain_created");
	});

	it("ignores requester memberships in inactive employee groups", async () => {
		const { dbService } = createPolicyResolutionDbService({
			groupRows: [
				{ organizationId: "org-1", employeeId: "emp-requester", groupId: "group-inactive" },
			],
			activeGroups: [],
			policies: [
				{
					...dbPolicy,
					conditions: [
						{ conditionType: "employee_group", operator: "equals", valueJson: "group-inactive" },
					],
				},
			],
		});

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

		expect(result.kind).toBe("default_created");
	});

	it("records chain created and stage request created audit events", async () => {
		const { dbService, auditEvents } = createPolicyResolutionDbService({ policies: [dbPolicy] });

		await Effect.runPromise(
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

		expectAuditEvents(auditEvents, [
			"approval_policy.matched",
			"approval_chain.created",
			"approval_chain.stage_request_created",
		]);
		expect(auditEvents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					organizationId: "org-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					performedBy: "user-requester",
					employeeId: "emp-requester",
				}),
			]),
		);
		expect(JSON.parse(auditEvents[2].metadata as string)).toEqual(
			expect.objectContaining({ stageId: "tx-3" }),
		);
	});

	it("records no-match fallback audit events", async () => {
		const { dbService, auditEvents } = createPolicyResolutionDbService({ policies: [] });

		await Effect.runPromise(
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

		expectAuditEvents(auditEvents, ["approval_policy.no_match_fallback"]);
	});
});
