import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRAVEL_EXPENSE_VALIDATION_MESSAGES } from "@/lib/travel-expenses/types";

const mockState = vi.hoisted(() => {
	const updateReturning = vi.fn();
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const insertValues = vi.fn();
	const dbTransaction = vi.fn();

	return {
		getAuthContext: vi.fn(),
		revalidatePath: vi.fn(),
		logAudit: vi.fn().mockResolvedValue(undefined),
		findClaim: vi.fn(),
		findEmployee: vi.fn(),
		dbUpdate: vi.fn(() => ({ set: updateSet })),
		dbInsert: vi.fn(() => ({ values: insertValues })),
		dbTransaction,
		updateSet,
		updateWhere,
		updateReturning,
		insertValues,
		committedUpdates: [] as unknown[],
		committedInserts: [] as unknown[],
	};
});

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		asc: vi.fn((value: unknown) => ({ asc: value })),
		desc: vi.fn((value: unknown) => ({ desc: value })),
	};
});

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
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

vi.mock("next/cache", async (importOriginal) => {
	const actual = await importOriginal<typeof import("next/cache")>();
	return {
		...actual,
		revalidatePath: mockState.revalidatePath,
	};
});

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		TRAVEL_EXPENSE_DRAFT_CREATED: "travel_expense.draft_created",
		TRAVEL_EXPENSE_SUBMITTED: "travel_expense.submitted",
	},
	logAudit: mockState.logAudit,
}));

vi.mock("@/db/schema", () => ({
	travelExpenseClaim: {
		id: "id",
		organizationId: "organizationId",
		employeeId: "employeeId",
		status: "status",
		createdAt: "createdAt",
	},
	travelExpenseAttachment: {
		id: "id",
	},
	employee: {
		id: "id",
		organizationId: "organizationId",
		role: "role",
		isActive: "isActive",
		createdAt: "createdAt",
	},
	approvalRequest: {
		organizationId: "organizationId",
		entityType: "entityType",
		entityId: "entityId",
		approverId: "approverId",
		requestedBy: "requestedBy",
		status: "status",
		createdAt: "createdAt",
		updatedAt: "updatedAt",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			travelExpenseClaim: {
				findFirst: mockState.findClaim,
				findMany: vi.fn(),
			},
			employee: {
				findFirst: mockState.findEmployee,
			},
		},
		update: mockState.dbUpdate,
		insert: mockState.dbInsert,
		transaction: mockState.dbTransaction,
	},
}));

const { submitTravelExpenseClaim } = await import("./actions");

describe("submitTravelExpenseClaim", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.committedUpdates.length = 0;
		mockState.committedInserts.length = 0;
		mockState.dbTransaction.mockImplementation(async (run) => {
			const pendingUpdates: unknown[] = [];
			const pendingInserts: unknown[] = [];
			const tx = {
				update: vi.fn(() => ({
					set: vi.fn((values) => ({
						where: vi.fn(() => ({
							returning: vi.fn(async (...args) => {
								const result = await mockState.updateReturning(...args);
								pendingUpdates.push(values);
								return result;
							}),
						})),
					})),
				})),
				insert: vi.fn(() => ({
					values: vi.fn(async (values) => {
						await mockState.insertValues(values);
						pendingInserts.push(values);
					}),
				})),
			};

			const result = await run(tx);
			mockState.committedUpdates.push(...pendingUpdates);
			mockState.committedInserts.push(...pendingInserts);
			return result;
		});
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
			employee: {
				id: "emp-1",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
			},
		});
	});

	it("succeeds and returns submitted status when manager exists", async () => {
		mockState.findClaim.mockResolvedValue({
			id: "claim-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "draft",
			type: "receipt",
			attachments: [{ id: "att-1" }],
		});
		mockState.findEmployee.mockResolvedValueOnce({ managerId: "manager-1" });
		mockState.updateReturning.mockResolvedValue([{ id: "claim-1" }]);

		const result = await submitTravelExpenseClaim({ claimId: "claim-1" });

		expect(result).toEqual({ success: true, data: { status: "submitted" } });
		expect(mockState.dbTransaction).toHaveBeenCalledTimes(1);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "travel_expense_claim",
				entityId: "claim-1",
				approverId: "manager-1",
				requestedBy: "emp-1",
				status: "pending",
			}),
		);
		expect(mockState.committedUpdates).toHaveLength(1);
		expect(mockState.committedInserts).toHaveLength(1);
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/travel-expenses");
		expect(mockState.logAudit).toHaveBeenCalledTimes(1);
	});

	it("fails for receipt claim without attachment", async () => {
		mockState.findClaim.mockResolvedValue({
			id: "claim-2",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "draft",
			type: "receipt",
			attachments: [],
		});

		const result = await submitTravelExpenseClaim({ claimId: "claim-2" });

		expect(result).toEqual({
			success: false,
			error: TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED,
		});
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.logAudit).not.toHaveBeenCalled();
	});

	it("does not commit submission when approval request creation fails", async () => {
		mockState.findClaim.mockResolvedValue({
			id: "claim-3",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "draft",
			type: "receipt",
			attachments: [{ id: "att-1" }],
		});
		mockState.findEmployee.mockResolvedValueOnce({ managerId: "manager-1" });
		mockState.updateReturning.mockResolvedValue([{ id: "claim-3" }]);
		mockState.insertValues.mockRejectedValue(new Error("approval request insert failed"));

		const result = await submitTravelExpenseClaim({ claimId: "claim-3" });

		expect(result).toEqual({ success: false, error: "Failed to submit travel expense claim" });
		expect(mockState.dbTransaction).toHaveBeenCalledTimes(1);
		expect(mockState.committedUpdates).toEqual([]);
		expect(mockState.committedInserts).toEqual([]);
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
		expect(mockState.logAudit).not.toHaveBeenCalled();
	});
});
