import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";

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

import { ApprovalAuditLogger } from "@/lib/approvals/infrastructure/audit-logger";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { getApprovalStatusUpdate, processApprovalWithCurrentEmployee } from "@/lib/approvals/server/shared";
import { mapBulkDecisionError } from "@/lib/approvals/application/bulk-approval.service";

describe("getApprovalStatusUpdate", () => {
	it("builds approved status payload", () => {
		const result = getApprovalStatusUpdate("approve");

		expect(result.status).toBe("approved");
		expect(result.approvedAt).toBeDefined();
		expect(result.rejectionReason).toBeUndefined();
		expect(result.updatedAt).toBeDefined();
	});

	it("builds rejected status payload", () => {
		const result = getApprovalStatusUpdate("reject", "missing details");

		expect(result.status).toBe("rejected");
		expect(result.approvedAt).toBeDefined();
		expect(result.rejectionReason).toBe("missing details");
		expect(result.updatedAt).toBeDefined();
	});

	it("maps per-item bulk failures to coded outcomes", () => {
		expect(
			mapBulkDecisionError(
				"approval-conflict",
				new ConflictError({
					message: "Approval request is already approved",
					conflictType: "approval_status",
				}),
			),
		).toEqual({
			id: "approval-conflict",
			code: "stale",
			message: "Approval request is already approved",
		});

		expect(
			mapBulkDecisionError(
				"approval-missing",
				new NotFoundError({
					message: "Approval request not found",
					entityType: "approval_request",
					entityId: "approval-missing",
				}),
			),
		).toEqual({
			id: "approval-missing",
			code: "not_found",
			message: "Approval request not found",
		});

		expect(
			mapBulkDecisionError(
				"approval-invalid",
				new ValidationError({
					message: "Travel expense approval decisions are not implemented yet",
				}),
			),
		).toEqual({
			id: "approval-invalid",
			code: "validation_failed",
			message: "Travel expense approval decisions are not implemented yet",
		});
	});

	it("logs normalized single-item approval audits with the acting user id", async () => {
		const approvalFindFirst = vi.fn().mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "employee-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		const returning = vi.fn().mockResolvedValue([{ id: "approval-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const log = vi.fn().mockReturnValue(Effect.void);

		const dbService = DatabaseService.of({
			db: {
				query: {
					approvalRequest: {
						findFirst: approvalFindFirst,
					},
				},
				update: vi.fn().mockReturnValue({ set }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		});

		const auditLogger = ApprovalAuditLogger.of({
			log,
			logBatch: vi.fn(),
		});

		await Effect.runPromise(
			processApprovalWithCurrentEmployee(
				dbService,
				{
					id: "employee-1",
					userId: "user-1",
					organizationId: "org-1",
					user: {
						id: "user-1",
						name: "Morgan Reviewer",
						email: "morgan@example.com",
						image: null,
					},
				},
				"travel_expense_claim",
				"claim-1",
				"approve",
				undefined,
				undefined,
				undefined,
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);

		expect(log).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				approvalId: "approval-1",
				approvalType: "travel_expense_claim",
				entityId: "claim-1",
				action: "approve",
				performedBy: "user-1",
				previousStatus: "pending",
				newStatus: "approved",
			}),
		);
	});

	it("fails as stale when the pending approval row is no longer writable at update time", async () => {
		const approvalFindFirst = vi.fn().mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "employee-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		const returning = vi.fn().mockResolvedValue([]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const updateEntity = vi.fn().mockReturnValue(Effect.void);
		const log = vi.fn().mockReturnValue(Effect.void);

		const dbService = DatabaseService.of({
			db: {
				query: {
					approvalRequest: {
						findFirst: approvalFindFirst,
					},
				},
				update: vi.fn().mockReturnValue({ set }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		});

		const auditLogger = ApprovalAuditLogger.of({
			log,
			logBatch: vi.fn(),
		});

		const exit = await Effect.runPromiseExit(
			processApprovalWithCurrentEmployee(
				dbService,
				{
					id: "employee-1",
					userId: "user-1",
					organizationId: "org-1",
					user: {
						id: "user-1",
						name: "Morgan Reviewer",
						email: "morgan@example.com",
						image: null,
					},
				},
				"travel_expense_claim",
				"claim-1",
				"approve",
				undefined,
				updateEntity,
				undefined,
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error =
				Option.getOrNull(Cause.failureOption(exit.cause)) ??
				([...(Cause.defects(exit.cause) as Iterable<unknown>)] [0] as unknown);
			expect(error).toBeInstanceOf(ConflictError);
			expect(error).toMatchObject({
				message: "Approval request is no longer pending",
				conflictType: "approval_status",
			});
		}

		expect(updateEntity).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
	});

	it("preserves ConflictError semantics when the database wrapper catches query callback throws", async () => {
		const approvalFindFirst = vi.fn().mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "employee-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		const returning = vi.fn().mockResolvedValue([]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });

		const dbService = DatabaseService.of({
			db: {
				query: {
					approvalRequest: {
						findFirst: approvalFindFirst,
					},
				},
				update: vi.fn().mockReturnValue({ set }),
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
		});

		const auditLogger = ApprovalAuditLogger.of({
			log: vi.fn().mockReturnValue(Effect.void),
			logBatch: vi.fn(),
		});

		const exit = await Effect.runPromiseExit(
			processApprovalWithCurrentEmployee(
				dbService,
				{
					id: "employee-1",
					userId: "user-1",
					organizationId: "org-1",
					user: {
						id: "user-1",
						name: "Morgan Reviewer",
						email: "morgan@example.com",
						image: null,
					},
				},
				"travel_expense_claim",
				"claim-1",
				"approve",
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error =
				Option.getOrNull(Cause.failureOption(exit.cause)) ??
				([...(Cause.defects(exit.cause) as Iterable<unknown>)][0] as unknown);
			expect(error).toBeInstanceOf(ConflictError);
			expect(error).not.toBeInstanceOf(DatabaseError);
			expect(error).toMatchObject({
				message: "Approval request is no longer pending",
				conflictType: "approval_status",
			});
		}
	});

	it("uses the transaction-scoped audit logger for transactional approvals", async () => {
		const approvalFindFirst = vi.fn().mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "employee-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		const returning = vi.fn().mockResolvedValue([{ id: "approval-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const outerInsertValues = vi.fn().mockResolvedValue(undefined);
		const txInsertValues = vi.fn().mockResolvedValue(undefined);
		const tx = {
			query: {
				approvalRequest: {
					findFirst: approvalFindFirst,
				},
			},
			update: vi.fn().mockReturnValue({ set }),
			insert: vi.fn().mockReturnValue({ values: txInsertValues }),
		};

		const dbService = DatabaseService.of({
			db: {
				query: {
					approvalRequest: {
						findFirst: approvalFindFirst,
					},
				},
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values: outerInsertValues }),
				transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => {
					await callback(tx);
				}),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		});

		const auditLogger = ApprovalAuditLogger.of({
			log: vi.fn().mockReturnValue(Effect.void),
			logBatch: vi.fn(),
		});

		await Effect.runPromise(
			processApprovalWithCurrentEmployee(
				dbService,
				{
					id: "employee-1",
					userId: "user-1",
					organizationId: "org-1",
					user: {
						id: "user-1",
						name: "Morgan Reviewer",
						email: "morgan@example.com",
						image: null,
					},
				},
				"travel_expense_claim",
				"claim-1",
				"approve",
				undefined,
				undefined,
				undefined,
				{ transactional: true },
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);

		expect(txInsertValues).toHaveBeenCalledTimes(1);
		expect(outerInsertValues).not.toHaveBeenCalled();
	});
});
