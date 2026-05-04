import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		S3_BUCKET: "test-bucket",
		S3_ACCESS_KEY_ID: "test-access-key",
		S3_SECRET_ACCESS_KEY: "test-secret-key",
		S3_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_REGION: "us-east-1",
		S3_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));

import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import {
	buildAbsenceApprovalPolicyContext,
	createAbsenceApprovalWorkflow,
	formatAbsenceDateForEmail,
} from "@/lib/approvals/server/absence-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";

function createPolicyResolutionDbService(policies: unknown[]) {
	const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
	const dbService = {
		db: {
			query: {
				approvalPolicy: { findMany: vi.fn().mockResolvedValue(policies) },
				employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
				employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{ id: "emp-requester", userId: "user-requester", organizationId: "org-1", isActive: true, role: "employee" },
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

const absencePolicyContext = buildAbsenceApprovalPolicyContext({
	id: "absence-1",
	organizationId: "org-1",
	employeeId: "emp-requester",
	categoryId: "category-1",
	employee: { teamId: "team-1" },
});

describe("formatAbsenceDateForEmail", () => {
	it("formats dates for absence emails", () => {
		expect(formatAbsenceDateForEmail(new Date("2026-03-09T00:00:00.000Z"))).toBe("Mar 9, 2026");
	});
});

describe("absence approval policy resolution", () => {
	it("forces absence decisions through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { approveAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);

		approveAbsenceWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
			},
			"absence-1",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"absence_entry",
			"absence-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces absence rejections through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { rejectAbsenceWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/absence-approvals"
		);

		rejectAbsenceWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
			},
			"absence-1",
			"Too late",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"absence_entry",
			"absence-1",
			"reject",
			"Too late",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces exported absence approval actions through the transactional process path", async () => {
		vi.resetModules();
		const processApproval = vi.fn().mockResolvedValue(undefined);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval,
			processApprovalWithCurrentEmployee: vi.fn(),
		}));
		const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");

		await approveAbsenceEffect("absence-1");

		expect(processApproval).toHaveBeenCalledWith(
			"absence_entry",
			"absence-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces exported absence rejection actions through the transactional process path", async () => {
		vi.resetModules();
		const processApproval = vi.fn().mockResolvedValue(undefined);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval,
			processApprovalWithCurrentEmployee: vi.fn(),
		}));
		const { rejectAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");

		await rejectAbsenceEffect("absence-1", "Too late");

		expect(processApproval).toHaveBeenCalledWith(
			"absence_entry",
			"absence-1",
			"reject",
			"Too late",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("creates absence approvals through the shared policy resolver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			createAbsenceApprovalWorkflow(dbService, {
				absence: {
					id: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-requester",
					categoryId: "category-1",
					employee: { teamId: "team-1" },
				},
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "absence_entry",
			entityId: "absence-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
		});
	});

	it("uses existing default approval behavior when no approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: absencePolicyContext,
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "absence_entry",
			entityId: "absence-1",
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
				name: "Absence policy",
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
		]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: absencePolicyContext,
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({
			kind: "chain_created",
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
		});
		expect(inserts).toHaveLength(3);
		expect(inserts.map((insert) => insert.values.organizationId)).toEqual([
			"org-1",
			"org-1",
			"org-1",
		]);
		expect(inserts[0].values).toMatchObject({ policyId: "policy-1", entityType: "absence_entry" });
		expect(inserts[1].values).toMatchObject({ approverId: "emp-manager", entityId: "absence-1" });
		expect(inserts[2].values).toMatchObject({
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
			resolvedApproverEmployeeId: "emp-manager",
		});
	});

	it("falls back to manager approval when a matched absence policy cannot resolve", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Broken absence policy",
				isActive: true,
				priority: 1,
				conditions: [{ conditionType: "approval_type", operator: "equals", valueJson: "absence_entry" }],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Missing approver",
						approverType: "specific_employee",
						approverEmployeeId: "missing-employee",
					},
				],
			},
		]);

		const result = await Effect.runPromise(
			createAbsenceApprovalWorkflow(dbService, {
				absence: {
					id: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-requester",
					categoryId: "category-1",
					employee: { teamId: "team-1" },
				},
				defaultApproverId: "emp-manager",
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "absence_entry",
			entityId: "absence-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
		});
	});
});
