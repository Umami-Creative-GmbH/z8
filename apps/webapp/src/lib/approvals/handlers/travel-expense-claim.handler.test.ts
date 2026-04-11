import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
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

const testState = vi.hoisted(() => ({
	approvalFindMany: vi.fn(),
	approvalFindFirst: vi.fn(),
	travelExpenseFindMany: vi.fn(),
	travelExpenseFindFirst: vi.fn(),
	employeeFindFirst: vi.fn(),
	countWhere: vi.fn(),
	dbUpdate: vi.fn(),
	dbTransaction: vi.fn(),
	updateReturning: vi.fn(),
	updateWhere: vi.fn(),
	updateSet: vi.fn(),
	insertValues: vi.fn(),
	query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
	committedUpdates: [] as unknown[],
	committedInserts: [] as unknown[],
}));

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context, Layer } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");
	return {
		DatabaseService,
		DatabaseServiceLive: Layer.succeed(DatabaseService, {}),
	};
});

vi.mock("../infrastructure/audit-logger", async () => {
	const { Context, Layer, Effect } = await import("effect");
	const ApprovalAuditLogger = Context.GenericTag<any>("ApprovalAuditLogger");
	const createApprovalAuditLogger = vi.fn(() =>
		ApprovalAuditLogger.of({
			log: vi.fn(() => Effect.void),
			logBatch: vi.fn(() => Effect.void),
		}),
	);
	return {
		ApprovalAuditLogger,
		createApprovalAuditLogger,
		ApprovalAuditLoggerLive: Layer.succeed(
			ApprovalAuditLogger,
			ApprovalAuditLogger.of({
				log: vi.fn(() => Effect.void),
				logBatch: vi.fn(() => Effect.void),
			}),
		),
	};
});

import { DatabaseService } from "@/lib/effect/services/database.service";
import { ApprovalAuditLogger } from "../infrastructure/audit-logger";
import { getApprovalHandler } from "../domain/registry";
import { initializeApprovalCenter } from "../init";

function createDatabaseService() {
	const database = {
		query: {
			employee: {
				findFirst: testState.employeeFindFirst,
			},
			approvalRequest: {
				findMany: testState.approvalFindMany,
				findFirst: testState.approvalFindFirst,
			},
			travelExpenseClaim: {
				findMany: testState.travelExpenseFindMany,
				findFirst: testState.travelExpenseFindFirst,
			},
		},
		update: testState.dbUpdate,
		insert: vi.fn(() => ({ values: testState.insertValues })),
		transaction: testState.dbTransaction,
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: testState.countWhere,
			})),
		})),
	};

	return DatabaseService.of({
		db: database,
		query: testState.query,
	});
}

function createAuditLogger() {
	return ApprovalAuditLogger.of({
		log: vi.fn(() => Effect.void),
		logBatch: vi.fn(() => Effect.void),
	});
}

function createUpdateBuilder() {
	return {
				set: testState.updateSet,
	};
}

describe("TravelExpenseClaimHandler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-11T09:00:00.000Z"));
		testState.approvalFindMany.mockReset();
		testState.approvalFindFirst.mockReset();
		testState.travelExpenseFindMany.mockReset();
		testState.travelExpenseFindFirst.mockReset();
		testState.employeeFindFirst.mockReset();
		testState.countWhere.mockReset();
		testState.dbUpdate.mockReset();
		testState.dbTransaction.mockReset();
		testState.updateReturning.mockReset();
		testState.updateWhere.mockReset();
		testState.updateSet.mockReset();
		testState.insertValues.mockReset();
		testState.query.mockClear();
		testState.committedUpdates.length = 0;
		testState.committedInserts.length = 0;
		testState.dbUpdate.mockImplementation(() => createUpdateBuilder());
		testState.updateSet.mockReturnValue({ where: testState.updateWhere });
		testState.updateWhere.mockReturnValue({ returning: testState.updateReturning });
		testState.dbTransaction.mockImplementation(async (run) => {
			const pendingUpdates: unknown[] = [];
			const pendingInserts: unknown[] = [];
			const tx = {
				query: {
					employee: {
						findFirst: testState.employeeFindFirst,
					},
					approvalRequest: {
						findMany: testState.approvalFindMany,
						findFirst: testState.approvalFindFirst,
					},
					travelExpenseClaim: {
						findMany: testState.travelExpenseFindMany,
						findFirst: testState.travelExpenseFindFirst,
					},
				},
				update: vi.fn((table) => {
					testState.dbUpdate(table);
					return {
						set: vi.fn((values) => {
							testState.updateSet(values);
							return {
								where: vi.fn(async (...args) => {
									testState.updateWhere(...args);
									pendingUpdates.push({ table, values });
									return testState.updateReturning();
								}),
							};
						}),
					};
				}),
				insert: vi.fn((table) => ({
					values: vi.fn(async (values) => {
						await testState.insertValues(values);
						pendingInserts.push({ table, values });
					}),
				})),
			};

			const result = await run(tx);
			testState.committedUpdates.push(...pendingUpdates);
			testState.committedInserts.push(...pendingInserts);
			return result;
		});
		initializeApprovalCenter();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("registers the handler and maps travel expense approvals into unified items", async () => {
		testState.approvalFindMany.mockResolvedValue([
			{
				id: "approval-1",
				entityType: "travel_expense_claim",
				entityId: "claim-1",
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				createdAt: new Date("2026-04-09T10:00:00.000Z"),
				approvedAt: null,
				rejectionReason: null,
				requester: {
					id: "employee-1",
					userId: "user-1",
					teamId: "team-1",
					user: {
						id: "user-1",
						name: "Casey Booker",
						email: "casey@example.com",
						image: "https://example.com/casey.png",
					},
				},
			},
		]);

		testState.travelExpenseFindMany.mockResolvedValue([
			{
				id: "claim-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				approverId: "manager-1",
				type: "receipt",
				status: "submitted",
				tripStart: new Date("2026-04-15T00:00:00.000Z"),
				tripEnd: new Date("2026-04-17T00:00:00.000Z"),
				destinationCity: "Berlin",
				destinationCountry: "DE",
				projectId: "project-1",
				originalCurrency: "EUR",
				originalAmount: "120.50",
				calculatedCurrency: "EUR",
				calculatedAmount: "120.50",
				notes: "Client visit",
				submittedAt: new Date("2026-04-09T09:30:00.000Z"),
				decidedAt: null,
				createdAt: new Date("2026-04-08T12:00:00.000Z"),
				createdBy: "user-1",
				updatedAt: new Date("2026-04-09T09:30:00.000Z"),
				updatedBy: "user-1",
				employee: {
					id: "employee-1",
					userId: "user-1",
					teamId: "team-1",
					organizationId: "org-1",
					user: {
						id: "user-1",
						name: "Casey Booker",
						email: "casey@example.com",
						image: "https://example.com/casey.png",
					},
				},
				project: {
					id: "project-1",
					name: "Berlin rollout",
				},
			},
		]);

		const handler = getApprovalHandler("travel_expense_claim");

		expect(handler).toBeDefined();
		if (!handler) {
			return;
		}

		expect(handler.displayName).toBe("Travel Expense");
		expect(handler.supportsBulkApprove).toBe(true);

		const items = await Effect.runPromise(
			handler.getApprovals({
				approverId: "manager-1",
				organizationId: "org-1",
				limit: 10,
			}).pipe(
				Effect.provideService(DatabaseService, createDatabaseService()),
			),
		);

		expect(items).toEqual([
			{
				id: "approval-1",
				approvalType: "travel_expense_claim",
				entityId: "claim-1",
				typeName: "Travel Expense",
				requester: {
					id: "employee-1",
					userId: "user-1",
					name: "Casey Booker",
					email: "casey@example.com",
					image: "https://example.com/casey.png",
					teamId: "team-1",
				},
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				createdAt: new Date("2026-04-09T10:00:00.000Z"),
				resolvedAt: null,
				priority: "high",
				sla: {
					deadline: null,
					status: "on_time",
					hoursRemaining: null,
				},
				display: {
					title: "Travel Expense",
					subtitle: "Berlin - Apr 15-17, 2026",
					summary: "Receipt for EUR 120.50",
					badge: {
						label: "Berlin rollout",
						color: null,
					},
					icon: "receipt",
				},
			},
		]);

		expect(testState.approvalFindMany).toHaveBeenCalledTimes(1);
		expect(testState.travelExpenseFindMany).toHaveBeenCalledTimes(1);
	});

	it("filters out claims returned from a different organization at the entity-loading boundary", async () => {
		testState.approvalFindMany.mockResolvedValue([
			{
				id: "approval-1",
				entityType: "travel_expense_claim",
				entityId: "claim-1",
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				createdAt: new Date("2026-04-09T10:00:00.000Z"),
				approvedAt: null,
				rejectionReason: null,
				requester: {
					id: "employee-1",
					userId: "user-1",
					teamId: "team-1",
					user: {
						id: "user-1",
						name: "Casey Booker",
						email: "casey@example.com",
						image: null,
					},
				},
			},
		]);

		testState.travelExpenseFindMany.mockResolvedValue([
			{
				id: "claim-1",
				organizationId: "org-2",
				employeeId: "employee-1",
				approverId: "manager-1",
				type: "receipt",
				status: "submitted",
				tripStart: new Date("2026-04-15T00:00:00.000Z"),
				tripEnd: new Date("2026-04-17T00:00:00.000Z"),
				destinationCity: "Berlin",
				destinationCountry: "DE",
				projectId: null,
				originalCurrency: "EUR",
				originalAmount: "120.50",
				calculatedCurrency: "EUR",
				calculatedAmount: "120.50",
				notes: null,
				submittedAt: new Date("2026-04-09T09:30:00.000Z"),
				decidedAt: null,
				createdAt: new Date("2026-04-08T12:00:00.000Z"),
				createdBy: "user-1",
				updatedAt: new Date("2026-04-09T09:30:00.000Z"),
				updatedBy: "user-1",
				employee: {
					id: "employee-1",
					userId: "user-1",
					teamId: "team-1",
					organizationId: "org-2",
					user: {
						id: "user-1",
						name: "Casey Booker",
						email: "casey@example.com",
						image: null,
					},
				},
				project: null,
			},
		]);

		const handler = getApprovalHandler("travel_expense_claim");

		expect(handler).toBeDefined();
		if (!handler) {
			return;
		}

		const items = await Effect.runPromise(
			handler.getApprovals({ approverId: "manager-1", organizationId: "org-1", limit: 10 }).pipe(
				Effect.provideService(DatabaseService, createDatabaseService()),
				Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
			),
		);

		expect(items).toEqual([]);
		expect(testState.travelExpenseFindMany).toHaveBeenCalledTimes(1);
	});

	it("uses the shared count query for pending travel expense approvals", async () => {
		testState.countWhere.mockResolvedValue([{ count: 3 }]);

		const handler = getApprovalHandler("travel_expense_claim");

		expect(handler).toBeDefined();
		if (!handler) {
			return;
		}

		const count = await Effect.runPromise(
			handler
				.getCount("manager-1", "org-1")
				.pipe(
					Effect.provideService(DatabaseService, createDatabaseService()),
					Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
				),
		);

		expect(count).toBe(3);
		expect(testState.countWhere).toHaveBeenCalledTimes(1);
		expect(testState.query).toHaveBeenCalledWith("gettravel_expense_claimCount", expect.any(Function));
	});

	it("routes approve and reject through the shared approval state machine", async () => {
		const handler = getApprovalHandler("travel_expense_claim");

		expect(handler).toBeDefined();
		if (!handler) {
			return;
		}

		testState.employeeFindFirst.mockResolvedValue({
			id: "manager-1",
			userId: "user-manager-1",
			organizationId: "org-1",
			user: {
				id: "user-manager-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		});
		testState.approvalFindFirst.mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "manager-1",
			status: "pending",
			createdAt: new Date("2026-04-09T09:30:00.000Z"),
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		testState.travelExpenseFindFirst.mockResolvedValue({
			id: "claim-1",
			organizationId: "org-1",
			approverId: "manager-1",
			status: "submitted",
		});
		testState.updateReturning.mockResolvedValue([{ id: "claim-1" }]);
		testState.insertValues.mockResolvedValue(undefined);

		testState.travelExpenseFindFirst.mockResolvedValueOnce({
			id: "claim-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			approverId: "manager-1",
			type: "receipt",
			status: "submitted",
			tripStart: new Date("2026-04-15T00:00:00.000Z"),
			tripEnd: new Date("2026-04-17T00:00:00.000Z"),
			destinationCity: "Berlin",
			destinationCountry: "DE",
			projectId: "project-1",
			originalCurrency: "EUR",
			originalAmount: "120.50",
			calculatedCurrency: "EUR",
			calculatedAmount: "120.50",
			notes: "Client visit",
			submittedAt: new Date("2026-04-09T09:30:00.000Z"),
			decidedAt: null,
			createdAt: new Date("2026-04-08T12:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
			updatedBy: "user-1",
			employee: {
				id: "employee-1",
				userId: "user-1",
				teamId: "team-1",
				organizationId: "org-1",
				user: {
					id: "user-1",
					name: "Casey Booker",
					email: "casey@example.com",
					image: "https://example.com/casey.png",
				},
			},
			project: {
				id: "project-1",
				name: "Berlin rollout",
			},
		});

		const detail = await Effect.runPromise(
			handler.getDetail("claim-1", "org-1").pipe(
				Effect.provideService(DatabaseService, createDatabaseService()),
				Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
			),
		);

		expect(detail).toEqual({
			approval: expect.objectContaining({
				id: "approval-1",
				approvalType: "travel_expense_claim",
				entityId: "claim-1",
				typeName: "Travel Expense",
				organizationId: "org-1",
				approverId: "manager-1",
				status: "pending",
				createdAt: new Date("2026-04-09T09:30:00.000Z"),
				display: {
					title: "Travel Expense",
					subtitle: "Berlin - Apr 15-17, 2026",
					summary: "Receipt for EUR 120.50",
					badge: { label: "Berlin rollout", color: null },
					icon: "receipt",
				},
			}),
			entity: expect.objectContaining({
				id: "claim-1",
				organizationId: "org-1",
				type: "receipt",
				project: expect.objectContaining({ name: "Berlin rollout" }),
			}),
			timeline: [
				expect.objectContaining({
					id: "approval-1-created",
					type: "created",
					message: "Travel expense submitted for approval",
					performedBy: {
						name: "Casey Booker",
						image: "https://example.com/casey.png",
					},
					timestamp: new Date("2026-04-09T09:30:00.000Z"),
				}),
			],
		});

		await expect(
			Effect.runPromise(
				handler.approve("claim-1", "manager-1").pipe(
					Effect.provideService(DatabaseService, createDatabaseService()),
					Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
				),
			),
		).resolves.toBeUndefined();

		expect(testState.approvalFindFirst).toHaveBeenCalledTimes(2);
		expect(testState.dbUpdate).toHaveBeenNthCalledWith(1, expect.anything());
		expect(testState.updateSet).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				status: "approved",
			}),
		);
		expect(testState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "approved",
				updatedBy: "user-manager-1",
			}),
		);
		expect(testState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				claimId: "claim-1",
				actorEmployeeId: "manager-1",
				action: "approved",
				comment: null,
				reason: null,
			}),
		);

		testState.updateReturning.mockResolvedValueOnce([{ id: "claim-1" }]);
		testState.approvalFindFirst.mockResolvedValueOnce({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "manager-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});

		await expect(
			Effect.runPromise(
				handler.reject("claim-1", "manager-1", "Missing receipt").pipe(
					Effect.provideService(DatabaseService, createDatabaseService()),
					Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
				),
			),
		).resolves.toBeUndefined();

		expect(testState.approvalFindFirst).toHaveBeenCalledTimes(3);
		expect(testState.updateSet).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				status: "rejected",
				rejectionReason: "Missing receipt",
			}),
		);
		expect(testState.updateSet).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: "rejected",
				updatedBy: "user-manager-1",
			}),
		);
		expect(testState.insertValues).toHaveBeenLastCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				claimId: "claim-1",
				actorEmployeeId: "manager-1",
				action: "rejected",
				comment: null,
				reason: "Missing receipt",
			}),
		);
	});

	it("does not move the shared approval request when travel expense preflight fails", async () => {
		const handler = getApprovalHandler("travel_expense_claim");

		expect(handler).toBeDefined();
		if (!handler) {
			return;
		}

		testState.employeeFindFirst.mockResolvedValue({
			id: "manager-1",
			userId: "user-manager-1",
			organizationId: "org-1",
			user: {
				id: "user-manager-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		});
		testState.approvalFindFirst.mockResolvedValue({
			id: "approval-1",
			entityId: "claim-missing",
			entityType: "travel_expense_claim",
			approverId: "manager-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		testState.travelExpenseFindFirst.mockResolvedValue(null);

		await expect(
			Effect.runPromise(
				Effect.flip(
					handler.approve("claim-missing", "manager-1").pipe(
						Effect.provideService(DatabaseService, createDatabaseService()),
						Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
					),
				),
			),
		).resolves.toEqual(
			expect.objectContaining({
				_tag: "NotFoundError",
				message: "Travel expense claim not found",
			}),
		);

		expect(testState.approvalFindFirst).not.toHaveBeenCalled();
		expect(testState.dbUpdate).not.toHaveBeenCalled();
		expect(testState.insertValues).not.toHaveBeenCalled();
	});

	it("rolls back the approval transition when travel expense persistence fails after transition starts", async () => {
		const handler = getApprovalHandler("travel_expense_claim");

		expect(handler).toBeDefined();
		if (!handler) {
			return;
		}

		testState.employeeFindFirst.mockResolvedValue({
			id: "manager-1",
			userId: "user-manager-1",
			organizationId: "org-1",
			user: {
				id: "user-manager-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		});
		testState.travelExpenseFindFirst.mockResolvedValue({
			id: "claim-1",
			organizationId: "org-1",
			approverId: "manager-1",
			status: "submitted",
		});
		testState.approvalFindFirst.mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "manager-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		testState.updateReturning.mockResolvedValue([{ id: "claim-1" }]);
		testState.insertValues.mockRejectedValue(new Error("decision log insert failed"));

		await expect(
			Effect.runPromise(
				Effect.flip(
					handler.approve("claim-1", "manager-1").pipe(
						Effect.provideService(DatabaseService, createDatabaseService()),
						Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
					),
				),
			),
		).resolves.toEqual(
			expect.objectContaining({
				message: "decision log insert failed",
			}),
		);

		expect(testState.dbTransaction).toHaveBeenCalledTimes(1);
		expect(testState.dbUpdate).toHaveBeenCalled();
		expect(testState.insertValues).toHaveBeenCalledTimes(1);
		expect(testState.committedUpdates).toEqual([]);
		expect(testState.committedInserts).toEqual([]);
	});

	it("allows admins to approve when the shared approval request is assigned to them but the legacy claim approver differs", async () => {
		const handler = getApprovalHandler("travel_expense_claim");

		expect(handler).toBeDefined();
		if (!handler) {
			return;
		}

		testState.employeeFindFirst.mockResolvedValue({
			id: "admin-1",
			userId: "user-admin-1",
			organizationId: "org-1",
			role: "admin",
			user: {
				id: "user-admin-1",
				name: "Avery Admin",
				email: "avery@example.com",
				image: null,
			},
		});
		testState.approvalFindFirst.mockResolvedValue({
			id: "approval-1",
			entityId: "claim-1",
			entityType: "travel_expense_claim",
			approverId: "admin-1",
			organizationId: "org-1",
			status: "pending",
			approvedAt: null,
			rejectionReason: null,
			updatedAt: new Date("2026-04-09T09:30:00.000Z"),
		});
		testState.travelExpenseFindFirst.mockResolvedValue({
			id: "claim-1",
			organizationId: "org-1",
			approverId: "manager-1",
			status: "submitted",
		});
		testState.updateReturning.mockResolvedValue([{ id: "claim-1" }]);
		testState.insertValues.mockResolvedValue(undefined);

		await expect(
			Effect.runPromise(
				handler.approve("claim-1", "admin-1").pipe(
					Effect.provideService(DatabaseService, createDatabaseService()),
					Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
				),
			),
		).resolves.toBeUndefined();

		expect(testState.updateSet).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				status: "approved",
			}),
		);
		expect(testState.updateSet).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: "approved",
				updatedBy: "user-admin-1",
			}),
		);
		expect(testState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				claimId: "claim-1",
				actorEmployeeId: "admin-1",
				action: "approved",
			}),
		);
	});
});
