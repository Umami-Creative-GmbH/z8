import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerMocks = vi.hoisted(() => ({
	execute: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
		S3_PUBLIC_BUCKET: "test-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
		S3_PUBLIC_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_PUBLIC_REGION: "us-east-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));

vi.mock("./work-period-approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./work-period-approvals")>()),
	executeOrdinaryWorkPeriodDecisionInTransaction: ownerMocks.execute,
}));

import { decideTimeCorrectionWithStableTargetEffect } from "./time-correction-approvals";
import type { ApprovalDbService, CurrentApprover } from "./types";

const actor: CurrentApprover = {
	id: "manager-1",
	userId: "manager-user-1",
	organizationId: "org-1",
	role: "manager",
	user: {
		id: "manager-user-1",
		name: "Morgan Manager",
		email: "manager@example.com",
		image: null,
	},
};

function createFacadeDb(
	mode: "legacy" | "shadow" | "ready",
): ApprovalDbService {
	const request = {
		id: "approval-1",
		organizationId: "org-1",
		entityType: "time_entry",
		entityId: "period-1",
		requestedBy: "employee-1",
		approverId: "assigned-manager-1",
		status: "pending",
		reason: null,
		metadata: { timeRequest: { kind: "manual_time_submission" } },
	};
	const database = {
		execute: vi.fn(async (statement: SQL) => {
			const rendered = new PgDialect().sqlToQuery(statement).sql;
			return /approval_workflow_rollout/i.test(rendered)
				? { rows: [{ lifecycle_mode: mode }] }
				: { rows: [] };
		}),
		query: {
			employee: {
				findMany: vi.fn().mockResolvedValue([{ ...actor, isActive: true }]),
			},
			member: {
				findMany: vi.fn().mockResolvedValue([
					{
						organizationId: "org-1",
						userId: actor.userId,
						status: "approved",
					},
				]),
			},
			approvalRequest: { findFirst: vi.fn().mockResolvedValue(request) },
			approvalStageAssignment: { findFirst: vi.fn() },
			approvalWorkflowStage: { findFirst: vi.fn() },
			approvalWorkflow: { findFirst: vi.fn() },
			workPeriod: {
				findFirst: vi.fn().mockResolvedValue({
					id: "period-1",
					organizationId: "org-1",
					employeeId: "employee-1",
					pendingChanges: { isManualEntry: true },
					clockInId: "clock-in-1",
					clockOutId: "clock-out-1",
					approvalWorkflowId: null,
				}),
			},
			timeEntry: { findFirst: vi.fn() },
		},
		transaction: async <T>(operation: (tx: unknown) => Promise<T>) =>
			await operation(database),
	};
	return {
		db: database as never,
		query: <T>(_name: string, operation: () => Promise<T>) =>
			Effect.promise(operation),
	};
}

describe("time-correction ordinary authority facade", () => {
	beforeEach(() => {
		ownerMocks.execute.mockReset();
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
	] as const)("forwards inbox, bulk, and bot authority in %s mode", async (mode) => {
		for (const testCase of [
			{
				path: "inbox",
				options: { allowAnyApprover: true },
				eligible: true,
				succeeds: true,
			},
			{
				path: "bulk",
				options: { allowOrganizationWideApprover: true },
				eligible: false,
				succeeds: true,
			},
			{
				path: "bot",
				options: { allowAnyApprover: true },
				eligible: false,
				succeeds: false,
			},
		] as const) {
			ownerMocks.execute.mockImplementationOnce(async (input) => {
				const authority = input as {
					allowAnyApprover?: boolean;
					allowOrganizationWideApprover?: boolean;
				};
				if (
					authority.allowOrganizationWideApprover !== true &&
					!(authority.allowAnyApprover === true && testCase.eligible)
				) {
					throw new Error("not authorized");
				}
				return { result: { action: "approve" }, postCommit: null };
			});
			const decision = Effect.runPromise(
				decideTimeCorrectionWithStableTargetEffect(
					createFacadeDb(mode),
					actor,
					"approval-1",
					"approve",
					undefined,
					{
						approvalRequestId: "approval-1",
						...testCase.options,
					},
				),
			);

			if (testCase.succeeds) {
				await expect(decision, testCase.path).resolves.toBeUndefined();
			} else {
				await expect(decision, testCase.path).rejects.toThrow("not authorized");
			}
			expect(ownerMocks.execute).toHaveBeenLastCalledWith(
				expect.objectContaining({
					organizationId: "org-1",
					approvalRequestId: "approval-1",
					workPeriodId: "period-1",
					...testCase.options,
				}),
			);
		}
	});
});
