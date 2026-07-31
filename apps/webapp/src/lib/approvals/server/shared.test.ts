import { Cause, Context, Effect, Exit, Option } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalActionOptions } from "@/lib/approvals/domain/types";
import {
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";

const loggerError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
	createLogger: vi.fn(() => ({ info: vi.fn(), error: loggerError })),
}));

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
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

const chainServiceMocks = vi.hoisted(() => ({
	progressApprovalChainIfLinked: vi.fn(),
}));
const managerEligibilityMocks = vi.hoisted(() => ({
	isEligibleManagerForApprovalRequest: vi.fn(),
}));

vi.mock("@/lib/approvals/policies/chain-service", () => ({
	progressApprovalChainIfLinked:
		chainServiceMocks.progressApprovalChainIfLinked,
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	isEligibleManagerForApprovalRequest:
		managerEligibilityMocks.isEligibleManagerForApprovalRequest,
}));

import { mapBulkDecisionError } from "@/lib/approvals/application/bulk-approval.service";
import { ApprovalAuditLogger } from "@/lib/approvals/infrastructure/audit-logger";
import {
	getApprovalStatusUpdate,
	processApprovalWithCurrentEmployee,
} from "@/lib/approvals/server/shared";
import { DatabaseService } from "@/lib/effect/services/database.service";

beforeEach(() => {
	loggerError.mockClear();
	chainServiceMocks.progressApprovalChainIfLinked.mockReset();
	chainServiceMocks.progressApprovalChainIfLinked.mockReturnValue(
		Effect.succeed({ kind: "not_linked" }),
	);
	managerEligibilityMocks.isEligibleManagerForApprovalRequest.mockReset();
	managerEligibilityMocks.isEligibleManagerForApprovalRequest.mockResolvedValue(
		false,
	);
});

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];

	const objectValue = value as {
		config?: { name?: unknown };
		queryChunks?: unknown[];
	};
	const ownName =
		typeof objectValue.config?.name === "string"
			? [objectValue.config.name]
			: [];
	const chunkNames = Array.isArray(objectValue.queryChunks)
		? objectValue.queryChunks.flatMap(collectColumnNames)
		: [];

	return [...ownName, ...chunkNames];
}

function createSharedApprovalTestContext(
	action: "approve" | "reject" = "approve",
	options?: ApprovalActionOptions,
) {
	const approvalFindFirst = vi.fn().mockResolvedValue({
		id: "approval-1",
		entityId: "claim-1",
		entityType: "travel_expense_claim",
		approverId: "employee-1",
		organizationId: "org-1",
		status: "pending",
		approvedAt: null,
		rejectionReason: null,
		updatedAt: new Date("2026-04-09T09:30:00.000Z"),
	});
	const returning = vi.fn().mockResolvedValue([{ id: "approval-1" }]);
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
			transaction: vi.fn(async (callback) =>
				callback({
					query: { approvalRequest: { findFirst: approvalFindFirst } },
					update: vi.fn().mockReturnValue({ set }),
					insert: vi
						.fn()
						.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
				}),
			),
		},
		query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
	});

	const auditLogger = ApprovalAuditLogger.of({
		log,
		logBatch: vi.fn(),
	});

	const currentEmployee = {
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

	const effect = (
		postCommitHandlers?: Parameters<
			typeof processApprovalWithCurrentEmployee
		>[9],
		transactionBehavior?: Parameters<
			typeof processApprovalWithCurrentEmployee
		>[10],
	) =>
		processApprovalWithCurrentEmployee(
			dbService,
			currentEmployee,
			"travel_expense_claim",
			"claim-1",
			action,
			action === "reject" ? "missing details" : undefined,
			updateEntity,
			undefined,
			options,
			postCommitHandlers,
			transactionBehavior,
		).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger));
	const run = (...args: Parameters<typeof effect>) =>
		Effect.runPromise(effect(...args));
	const runExit = (...args: Parameters<typeof effect>) =>
		Effect.runPromiseExit(effect(...args));

	return {
		approvalFindFirst,
		dbService,
		returning,
		updateEntity,
		run,
		runExit,
	};
}

describe("getApprovalStatusUpdate", () => {
	it.each([
		"approved",
		"rejected",
	] as const)("returns a typed stale conflict when the explicitly selected request is already %s", async (status) => {
		const { approvalFindFirst, run, updateEntity } =
			createSharedApprovalTestContext(
				status === "rejected" ? "reject" : "approve",
				{ approvalRequestId: "approval-1" },
			);
		approvalFindFirst.mockResolvedValueOnce({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "employee-1",
			organizationId: "org-1",
			status,
		});

		await expect(run()).rejects.toThrow(
			`Approval request is already ${status}`,
		);
		expect(updateEntity).not.toHaveBeenCalled();
	});

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
		expect(result.approvedAt).toBeNull();
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

	it("allows an organization approval manager to process another employee's pending approval as the actor", async () => {
		const approvalFindFirst = vi.fn().mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "assigned-employee-1",
			organizationId: "org-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		const returning = vi.fn().mockResolvedValue([{ id: "approval-1" }]);
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

		await Effect.runPromise(
			processApprovalWithCurrentEmployee(
				dbService,
				{
					id: "admin-employee-1",
					userId: "admin-user-1",
					organizationId: "org-1",
					user: {
						id: "admin-user-1",
						name: "Avery Admin",
						email: "avery@example.com",
						image: null,
					},
				},
				"travel_expense_claim",
				"claim-1",
				"approve",
				undefined,
				updateEntity,
				undefined,
				{
					approvalRequestId: "approval-1",
					allowOrganizationWideApprover: true,
				},
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);

		expect(approvalFindFirst).toHaveBeenCalledTimes(1);
		expect(updateEntity).toHaveBeenCalledWith(
			dbService,
			"claim-1",
			expect.objectContaining({ id: "admin-employee-1" }),
			expect.objectContaining({ id: "approval-1", organizationId: "org-1" }),
		);
		expect(log).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				approvalId: "approval-1",
				performedBy: "admin-user-1",
			}),
		);
		expect(
			managerEligibilityMocks.isEligibleManagerForApprovalRequest,
		).not.toHaveBeenCalled();
	});

	it.each([
		true,
		false,
	])("transactionally revalidates delegated eligible-manager authority: %s", async (eligible) => {
		managerEligibilityMocks.isEligibleManagerForApprovalRequest.mockResolvedValueOnce(
			eligible,
		);
		const { dbService, run, updateEntity } = createSharedApprovalTestContext(
			"approve",
			{
				approvalRequestId: "approval-1",
				allowAnyApprover: true,
				transactional: true,
			},
		);
		const approvalFindFirst = dbService.db.query.approvalRequest.findFirst;
		vi.mocked(approvalFindFirst).mockResolvedValueOnce({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "assigned-employee-1",
			organizationId: "org-1",
			requestedBy: "requester-1",
			status: "pending",
		});

		const decision = run(undefined, "existing");
		if (eligible) {
			await expect(decision).resolves.toBeUndefined();
			expect(updateEntity).toHaveBeenCalledOnce();
		} else {
			await expect(decision).rejects.toThrow(/authorized/i);
			expect(updateEntity).not.toHaveBeenCalled();
		}
		expect(
			managerEligibilityMocks.isEligibleManagerForApprovalRequest,
		).toHaveBeenCalledWith({
			db: dbService.db,
			approvalRequestId: "approval-1",
			managerEmployeeId: "employee-1",
			organizationId: "org-1",
		});
	});

	it.each([
		{
			path: "assigned",
			assignedApproverId: "employee-1",
			allowAnyApprover: false,
		},
		{
			path: "delegated",
			assignedApproverId: "assigned-employee-1",
			allowAnyApprover: true,
		},
	])("rejects a concurrent approver escalation after $path authorization without side effects", async ({
		assignedApproverId,
		allowAnyApprover,
	}) => {
		let persistedApproverId = assignedApproverId;
		let updatePredicate: unknown;
		const approvalFindFirst = vi.fn(async () => {
			const validated = {
				id: "approval-1",
				entityId: "claim-1",
				entityType: "travel_expense_claim",
				approverId: persistedApproverId,
				organizationId: "org-1",
				requestedBy: "requester-1",
				status: "pending",
			};
			persistedApproverId = "escalated-approver-1";
			return validated;
		});
		const returning = vi.fn(async () =>
			collectColumnNames(updatePredicate).includes("approver_id") &&
			persistedApproverId === "escalated-approver-1"
				? []
				: [{ id: "approval-1" }],
		);
		const where = vi.fn((predicate) => {
			updatePredicate = predicate;
			return { returning };
		});
		const set = vi.fn().mockReturnValue({ where });
		const updateEntity = vi.fn().mockReturnValue(Effect.void);
		const afterCommit = vi.fn().mockReturnValue(Effect.void);
		const dbService = DatabaseService.of({
			db: {
				query: { approvalRequest: { findFirst: approvalFindFirst } },
				update: vi.fn().mockReturnValue({ set }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		});
		const auditLogger = ApprovalAuditLogger.of({
			log: vi.fn().mockReturnValue(Effect.void),
			logBatch: vi.fn(),
		});
		managerEligibilityMocks.isEligibleManagerForApprovalRequest.mockResolvedValueOnce(
			true,
		);

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
				{
					approvalRequestId: "approval-1",
					allowAnyApprover: allowAnyApprover || undefined,
				},
				{ updateEntity, afterCommit },
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Option.getOrNull(Cause.failureOption(exit.cause))).toBeInstanceOf(
				ConflictError,
			);
		}

		expect(collectColumnNames(updatePredicate)).toEqual(
			expect.arrayContaining([
				"id",
				"organization_id",
				"status",
				"approver_id",
				"entity_type",
				"entity_id",
			]),
		);
		expect(
			chainServiceMocks.progressApprovalChainIfLinked,
		).not.toHaveBeenCalled();
		expect(updateEntity).not.toHaveBeenCalled();
		expect(afterCommit).not.toHaveBeenCalled();
	});

	it("rejects duplicate approval mutation evidence before chain or source effects", async () => {
		const { returning, runExit, updateEntity } =
			createSharedApprovalTestContext("approve", {
				approvalRequestId: "approval-1",
			});
		returning.mockResolvedValueOnce([
			{ id: "approval-1" },
			{ id: "approval-1" },
		]);

		const exit = await runExit();
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Option.getOrNull(Cause.failureOption(exit.cause))).toBeInstanceOf(
				ConflictError,
			);
		}
		expect(
			chainServiceMocks.progressApprovalChainIfLinked,
		).not.toHaveBeenCalled();
		expect(updateEntity).not.toHaveBeenCalled();
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
				([...(Cause.defects(exit.cause) as Iterable<unknown>)][0] as unknown);
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
				transaction: vi.fn(
					async (callback: (transaction: typeof tx) => Promise<void>) => {
						await callback(tx);
					},
				),
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

	it("preserves caller-provided services inside transactional approval side effects", async () => {
		class TestApprovalSideEffectService extends Context.Tag(
			"TestApprovalSideEffectService",
		)<
			TestApprovalSideEffectService,
			{ readonly run: () => Effect.Effect<void> }
		>() {}

		const approvalFindFirst = vi.fn().mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		const returning = vi.fn().mockResolvedValue([{ id: "approval-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const tx = {
			query: {
				approvalRequest: {
					findFirst: approvalFindFirst,
				},
			},
			update: vi.fn().mockReturnValue({ set }),
			insert: vi
				.fn()
				.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
		};
		const dbService = DatabaseService.of({
			db: {
				query: {
					approvalRequest: {
						findFirst: approvalFindFirst,
					},
				},
				update: vi.fn().mockReturnValue({ set }),
				insert: vi
					.fn()
					.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
				transaction: vi.fn(
					async (callback: (transaction: typeof tx) => Promise<void>) => {
						await callback(tx);
					},
				),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		});
		const auditLogger = ApprovalAuditLogger.of({
			log: vi.fn().mockReturnValue(Effect.void),
			logBatch: vi.fn(),
		});
		const sideEffect = vi.fn().mockReturnValue(Effect.void);

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
				() =>
					Effect.gen(function* (_) {
						const service = yield* _(TestApprovalSideEffectService);
						yield* _(service.run());
					}),
				undefined,
				{ transactional: true },
			).pipe(
				Effect.provideService(ApprovalAuditLogger, auditLogger),
				Effect.provideService(TestApprovalSideEffectService, {
					run: sideEffect,
				}),
			),
		);

		expect(sideEffect).toHaveBeenCalledTimes(1);
	});

	it("composes inside an existing transaction without opening a nested transaction", async () => {
		const { dbService, run, updateEntity } = createSharedApprovalTestContext(
			"approve",
			{ transactional: true },
		);

		await run(undefined, "existing");

		expect(dbService.db.transaction).not.toHaveBeenCalled();
		expect(updateEntity).toHaveBeenCalledWith(
			dbService,
			"claim-1",
			expect.objectContaining({ id: "employee-1" }),
			expect.objectContaining({ id: "approval-1" }),
		);
	});

	it("continues existing side effects for unlinked approval requests", async () => {
		const { updateEntity, run } = createSharedApprovalTestContext();

		await run();

		expect(updateEntity).toHaveBeenCalledTimes(1);
	});

	it("loads the exact organization-scoped request before validating assignment and status", async () => {
		const { approvalFindFirst, run } = createSharedApprovalTestContext(
			"approve",
			{
				approvalRequestId: "approval-1",
			},
		);

		await run();

		const query = approvalFindFirst.mock.calls[0]?.[0]?.where;
		expect(collectColumnNames(query)).toEqual(
			expect.arrayContaining([
				"id",
				"organization_id",
				"entity_type",
				"entity_id",
			]),
		);
		expect(collectColumnNames(query)).not.toEqual(
			expect.arrayContaining(["approver_id", "status"]),
		);
	});

	it("does not run final approve side effects for intermediate chain stages", async () => {
		chainServiceMocks.progressApprovalChainIfLinked.mockReturnValue(
			Effect.succeed({ kind: "chain_pending" }),
		);
		const { updateEntity, run } = createSharedApprovalTestContext();

		await run();

		expect(updateEntity).not.toHaveBeenCalled();
	});

	it("runs final approve side effects when the last chain stage completes", async () => {
		chainServiceMocks.progressApprovalChainIfLinked.mockReturnValue(
			Effect.succeed({ kind: "chain_completed", completed: true }),
		);
		const { updateEntity, run } = createSharedApprovalTestContext();

		await run();

		expect(updateEntity).toHaveBeenCalledTimes(1);
	});

	it("persists trailing requester auto-completion in the transaction and notifies after commit", async () => {
		chainServiceMocks.progressApprovalChainIfLinked.mockReturnValue(
			Effect.succeed({ kind: "chain_auto_completed", completed: true }),
		);
		let transactionOpen = false;
		let durableStateFinalized = false;
		const approvalFindFirst = vi.fn().mockResolvedValue({
			id: "approval-1",
			entityId: "absence-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		const returning = vi.fn().mockResolvedValue([{ id: "approval-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const tx = {
			query: { approvalRequest: { findFirst: approvalFindFirst } },
			update: vi.fn().mockReturnValue({ set }),
			insert: vi
				.fn()
				.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
		};
		const dbService = DatabaseService.of({
			db: {
				query: { approvalRequest: { findFirst: approvalFindFirst } },
				update: vi.fn().mockReturnValue({ set }),
				insert: vi
					.fn()
					.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
				transaction: vi.fn(
					async (callback: (transaction: typeof tx) => Promise<void>) => {
						transactionOpen = true;
						await callback(tx);
						transactionOpen = false;
					},
				),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		});
		const auditLogger = ApprovalAuditLogger.of({
			log: vi.fn().mockReturnValue(Effect.void),
			logBatch: vi.fn(),
		});
		const combinedPersistenceAndNotification = vi
			.fn()
			.mockReturnValue(Effect.void);
		const persistAutoCompletion = vi.fn(() =>
			Effect.sync(() => {
				expect(transactionOpen).toBe(true);
				durableStateFinalized = true;
				return { entityId: "absence-1" };
			}),
		);
		const notifyAfterCommit = vi.fn(() =>
			Effect.sync(() => {
				expect(transactionOpen).toBe(false);
				expect(durableStateFinalized).toBe(true);
			}),
		);

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
				"absence_entry",
				"absence-1",
				"approve",
				undefined,
				combinedPersistenceAndNotification,
				undefined,
				{ transactional: true },
				{
					updateEntity: persistAutoCompletion,
					afterCommit: notifyAfterCommit,
				},
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);

		expect(combinedPersistenceAndNotification).not.toHaveBeenCalled();
		expect(persistAutoCompletion).toHaveBeenCalledTimes(1);
		expect(notifyAfterCommit).toHaveBeenCalledTimes(1);
	});

	it("keeps a committed auto-completion successful when after-commit work fails", async () => {
		chainServiceMocks.progressApprovalChainIfLinked.mockReturnValue(
			Effect.succeed({ kind: "chain_auto_completed", completed: true }),
		);
		const persistAutoCompletion = vi.fn(() =>
			Effect.succeed({ entityId: "absence-1" }),
		);
		const afterCommitError = new NotFoundError({
			message: "Calendar maintenance failed",
			entityType: "absence_entry",
			entityId: "absence-1",
		});
		const afterCommit = vi.fn(() => Effect.fail(afterCommitError));
		const { run } = createSharedApprovalTestContext("approve", {
			transactional: true,
		});

		await expect(
			run({ updateEntity: persistAutoCompletion, afterCommit }),
		).resolves.toEqual({ entityId: "absence-1" });

		expect(persistAutoCompletion).toHaveBeenCalledTimes(1);
		expect(afterCommit).toHaveBeenCalledTimes(1);
		expect(loggerError).toHaveBeenCalledWith(
			expect.objectContaining({ error: afterCommitError, entityId: "claim-1" }),
			"Approval after-commit work failed",
		);
	});

	it("runs rejection side effects when any chain stage is rejected", async () => {
		chainServiceMocks.progressApprovalChainIfLinked.mockReturnValue(
			Effect.succeed({ kind: "chain_rejected", rejected: true }),
		);
		const { updateEntity, run } = createSharedApprovalTestContext("reject");

		await run();

		expect(updateEntity).toHaveBeenCalledTimes(1);
	});
});

const ordinaryDecisionCases = [
	["absence approve", "absence_entry", "approve"],
	["absence reject", "absence_entry", "reject"],
	["time correction approve", "time_entry", "approve"],
	["time correction reject", "time_entry", "reject"],
] as const;

function createOrdinaryPostCommitContext(
	entityType: "absence_entry" | "time_entry",
	action: "approve" | "reject",
	options?: { auditFails?: boolean; afterCommitFails?: boolean },
) {
	const events: string[] = [];
	let transactionOpen = false;
	const approval = {
		id: "approval-1",
		entityId: "entity-1",
		entityType,
		approverId: "employee-1",
		organizationId: "org-1",
		status: "pending" as const,
		reason: null,
		approvedAt: null,
		rejectionReason: null,
		metadata: null,
		updatedAt: new Date("2026-07-01T08:00:00.000Z"),
	};
	const approvalFindFirst = vi.fn().mockResolvedValue(approval);
	const returning = vi.fn().mockResolvedValue([{ id: "approval-1" }]);
	const where = vi.fn().mockReturnValue({ returning });
	const set = vi.fn().mockReturnValue({ where });
	const auditValues = vi.fn(async () => {
		if (options?.auditFails) throw new Error("final audit failed");
	});
	const tx = {
		query: { approvalRequest: { findFirst: approvalFindFirst } },
		update: vi.fn().mockReturnValue({ set }),
		insert: vi.fn().mockReturnValue({ values: auditValues }),
	};
	const dbService = DatabaseService.of({
		db: {
			query: { approvalRequest: { findFirst: approvalFindFirst } },
			update: vi.fn().mockReturnValue({ set }),
			insert: vi
				.fn()
				.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
			transaction: vi.fn(
				async (callback: (transaction: typeof tx) => Promise<unknown>) => {
					transactionOpen = true;
					try {
						const result = await callback(tx);
						events.push("commit");
						return result;
					} finally {
						transactionOpen = false;
					}
				},
			),
		},
		query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
	});
	const currentEmployee = {
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
	const notification = vi.fn(() => {
		events.push("notify");
	});
	const legacyCombinedHandler = vi.fn(() =>
		Effect.sync(() => {
			expect(transactionOpen).toBe(true);
			events.push("persist");
			notification();
			return { entityId: "entity-1" };
		}),
	);
	const persistDecision = vi.fn(() =>
		Effect.sync(() => {
			expect(transactionOpen).toBe(true);
			events.push("persist");
			return { entityId: "entity-1" };
		}),
	);
	const afterCommit = vi.fn(() =>
		Effect.gen(function* (_) {
			expect(transactionOpen).toBe(false);
			notification();
			if (options?.afterCommitFails) {
				yield* _(
					Effect.fail(
						new NotFoundError({
							message: "notification failed",
							entityType,
							entityId: "entity-1",
						}),
					),
				);
			}
		}),
	);
	const auditLogger = ApprovalAuditLogger.of({
		log: vi.fn().mockReturnValue(Effect.void),
		logBatch: vi.fn(),
	});
	const run = () =>
		Effect.runPromise(
			processApprovalWithCurrentEmployee(
				dbService,
				currentEmployee,
				entityType,
				"entity-1",
				action,
				action === "reject" ? "Rejected" : undefined,
				legacyCombinedHandler,
				undefined,
				{ transactional: true },
				{ updateEntity: persistDecision, afterCommit },
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
		);

	return {
		afterCommit,
		events,
		legacyCombinedHandler,
		notification,
		persistDecision,
		run,
	};
}

describe.each(
	ordinaryDecisionCases,
)("ordinary %s post-commit boundary", (_label, entityType, action) => {
	it("does not notify when final audit persistence rolls back", async () => {
		const context = createOrdinaryPostCommitContext(entityType, action, {
			auditFails: true,
		});

		await expect(context.run()).rejects.toThrow("final audit failed");

		expect(context.notification).not.toHaveBeenCalled();
		expect(context.events).not.toContain("commit");
	});

	it("notifies only after the transaction commits", async () => {
		const context = createOrdinaryPostCommitContext(entityType, action);

		await expect(context.run()).resolves.toEqual({ entityId: "entity-1" });

		expect(context.events).toEqual(["persist", "commit", "notify"]);
		expect(context.legacyCombinedHandler).not.toHaveBeenCalled();
	});

	it("keeps the committed decision successful when post-commit work fails", async () => {
		const context = createOrdinaryPostCommitContext(entityType, action, {
			afterCommitFails: true,
		});

		await expect(context.run()).resolves.toEqual({ entityId: "entity-1" });

		expect(context.afterCommit).toHaveBeenCalledOnce();
		expect(loggerError).toHaveBeenCalledWith(
			expect.objectContaining({ entityType, entityId: "entity-1" }),
			"Approval after-commit work failed",
		);
	});
});

describe.each([
	["absence", "absence_entry"],
	["time correction", "time_entry"],
] as const)("intermediate %s approval", (_label, entityType) => {
	it("does not emit final requester notification", async () => {
		chainServiceMocks.progressApprovalChainIfLinked.mockReturnValueOnce(
			Effect.succeed({ kind: "chain_pending" }),
		);
		const context = createOrdinaryPostCommitContext(entityType, "approve");

		await expect(context.run()).resolves.toBeUndefined();

		expect(context.persistDecision).not.toHaveBeenCalled();
		expect(context.afterCommit).not.toHaveBeenCalled();
		expect(context.notification).not.toHaveBeenCalled();
	});
});
