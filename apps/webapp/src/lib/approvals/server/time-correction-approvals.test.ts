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
	buildTimeCorrectionApprovalPolicyContext,
	calculateCorrectedDurationMinutes,
	createTimeCorrectionApprovalWorkflow,
} from "@/lib/approvals/server/time-correction-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";

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

const timePolicyContext = buildTimeCorrectionApprovalPolicyContext({
	organizationId: "org-1",
	requesterEmployeeId: "emp-requester",
	teamId: "team-1",
	workPeriodId: "period-1",
	overtimeRisk: "warning",
});

describe("calculateCorrectedDurationMinutes", () => {
	it("returns minutes when corrected clock-in and clock-out exist", () => {
		const result = calculateCorrectedDurationMinutes(
			new Date("2026-03-09T09:00:00.000Z"),
			new Date("2026-03-09T17:30:00.000Z"),
		);

		expect(result).toBe(510);
	});
});

describe("time correction approval policy resolution", () => {
	it("forces time correction decisions through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { approveTimeCorrectionWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		approveTimeCorrectionWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
			},
			"period-1",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"time_entry",
			"period-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces time correction rejections through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { rejectTimeCorrectionWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		rejectTimeCorrectionWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
			},
			"period-1",
			"Incorrect shift",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"time_entry",
			"period-1",
			"reject",
			"Incorrect shift",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("creates time correction approvals through the shared policy resolver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			createTimeCorrectionApprovalWorkflow(dbService, {
				organizationId: "org-1",
				requesterEmployeeId: "emp-requester",
				teamId: "team-1",
				workPeriodId: "period-1",
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
				overtimeRisk: "warning",
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			reason: "Correct missed clock-in",
		});
	});

	it("uses existing default approval behavior when no approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: timePolicyContext,
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			reason: "Correct missed clock-in",
		});
	});

	it("creates a chain approval request when an approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Overtime policy",
				isActive: true,
				priority: 1,
				conditions: [
					{ conditionType: "approval_type", operator: "equals", valueJson: "time_entry" },
					{ conditionType: "overtime_risk", operator: "equals", overtimeRisk: "warning" },
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
				context: timePolicyContext,
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
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
		expect(inserts[0].values).toMatchObject({ policyId: "policy-1", entityType: "time_entry" });
		expect(inserts[1].values).toMatchObject({ approverId: "emp-manager", entityId: "period-1" });
		expect(inserts[2].values).toMatchObject({
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
			resolvedApproverEmployeeId: "emp-manager",
		});
	});
});
