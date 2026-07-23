import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEmptyAbility,
	defineAbilityFor,
	type PrincipalContext,
} from "@/lib/authorization/ability";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	findEmployee: vi.fn(),
	findApprovalRequest: vi.fn(),
	isEligibleManagerForApprovalRequest: vi.fn(async () => false),
	approveApprovalInboxItem: vi.fn(),
	logger: {
		info: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAbility: mockState.getAbility,
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	isEligibleManagerForApprovalRequest:
		mockState.isEligibleManagerForApprovalRequest,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: mockState.findEmployee,
			},
			approvalRequest: {
				findFirst: mockState.findApprovalRequest,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	approvalRequest: {
		id: "approvalId",
	},
	employee: {
		userId: "userId",
		organizationId: "organizationId",
		isActive: "isActive",
	},
}));

vi.mock("@/lib/approvals/inbox/decision-service", () => ({
	approveApprovalInboxItem: mockState.approveApprovalInboxItem,
	loadApprovalInboxDecisionTarget: mockState.findApprovalRequest,
}));

vi.mock("@/lib/approvals/inbox/source-adapters", () => ({
	isSupportedInboxType: (type: string) =>
		["absence_entry", "time_entry", "travel_expense_claim"].includes(type),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { POST } = await import("./route");

function createRequest(): NextRequest {
	return {
		headers: new Headers(),
	} as NextRequest;
}

function createManagerAbility() {
	return defineAbilityFor({
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: {
			organizationId: "org-1",
			role: "member",
			status: "active",
		},
		employee: {
			id: "employee-1",
			organizationId: "org-1",
			role: "manager",
			teamId: null,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	} satisfies PrincipalContext);
}

describe("POST /api/approvals/inbox/[id]/approve", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(false);
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => false),
		});
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			role: "manager",
		});
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			targetType: "compatibility_request",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
		});
		mockState.approveApprovalInboxItem.mockResolvedValue({
			id: "approval-1",
			type: "absence_entry",
			status: "approved",
		});
	});

	it("allows an eligible fallback team manager to approve a request assigned to another manager", async () => {
		mockState.getAbility.mockResolvedValue(createManagerAbility());
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(true);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			targetType: "compatibility_request",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			requestedBy: "requester-1",
			requesterEmployeeId: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.findApprovalRequest).toHaveBeenCalledWith({
			approvalId: "approval-1",
			organizationId: "org-1",
		});
		expect(mockState.approveApprovalInboxItem).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			includeAllApprovers: undefined,
			eligibleApprovalScopes: [
				{
					requesterEmployeeId: "requester-1",
					eligibleApproverIds: ["employee-2", "employee-1"],
				},
			],
		});
	});

	it("rejects an active manager when approved membership is absent from the ability", async () => {
		mockState.getAbility.mockResolvedValue(createEmptyAbility());

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(
			mockState.isEligibleManagerForApprovalRequest,
		).not.toHaveBeenCalled();
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 when an assigned approver lacks approve or manage permission", async () => {
		mockState.getAbility.mockResolvedValue({ cannot: vi.fn(() => true) });
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
		});
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 instead of unsupported type when an assigned approver lacks approval permission", async () => {
		mockState.getAbility.mockResolvedValue({ cannot: vi.fn(() => true) });
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
		});
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "shift_request",
			approverId: "employee-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 when an ordinary employee is reported as manager-eligible", async () => {
		mockState.getAbility.mockResolvedValue({ cannot: vi.fn(() => true) });
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
		});
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(true);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 404 when a requester manager tries to approve a request assigned to a non-manager policy approver", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(false);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "org-admin-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("rejects requests when ability cannot be resolved before employee lookup or mutation", async () => {
		mockState.getAbility.mockResolvedValue(null);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("does not delegate when no active employee is found in the active organization", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("delegates approved decisions to the DB-backed inbox decision service", async () => {
		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.approveApprovalInboxItem).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			includeAllApprovers: true,
			eligibleApprovalScopes: [],
		});
		await expect(response.json()).resolves.toEqual({
			success: true,
			result: { id: "approval-1", type: "absence_entry", status: "approved" },
		});
	});

	it("returns 400 for unsupported approval types before delegating approval decisions", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "shift_request",
			approverId: "employee-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Unsupported approval type",
		});
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("allows manage-Approval users to approve requests assigned to another employee in the same organization", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.approveApprovalInboxItem).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			includeAllApprovers: true,
			eligibleApprovalScopes: [],
		});
	});

	it("returns 404 when a non-manage user approves a request assigned to another employee", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 404 instead of unsupported type when approval scope does not include the request", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(false);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "shift_request",
			approverId: "employee-2",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns the same 404 response when the approval ID is missing", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.findApprovalRequest.mockResolvedValue(null);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-missing" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 404 before approver authorization when the approval belongs to another organization", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			organizationId: "org-2",
			status: "pending",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		expect(mockState.approveApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns wrapper success responses", async () => {
		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
	});

	it("returns decision service conflict errors as 409 responses", async () => {
		mockState.approveApprovalInboxItem.mockRejectedValue(
			new ConflictError({
				message: "Approval request is already approved",
				conflictType: "approval_status",
			}),
		);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: "Approval request is already approved",
		});
	});

	it("returns decision service authorization errors as 403 responses", async () => {
		mockState.approveApprovalInboxItem.mockRejectedValue(
			new AuthorizationError({
				message: "You are not allowed to approve this request",
			}),
		);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: "You are not allowed to approve this request",
		});
	});

	it("returns decision service not-found errors as 404 responses", async () => {
		mockState.approveApprovalInboxItem.mockRejectedValue(
			new NotFoundError({
				message: "Absence request not found",
				entityType: "absence_request",
				entityId: "entity-1",
			}),
		);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Absence request not found",
		});
	});

	it("returns decision service validation errors as 400 responses", async () => {
		mockState.approveApprovalInboxItem.mockRejectedValue(
			new ValidationError({ message: "Invalid approval decision" }),
		);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Invalid approval decision",
		});
	});

	it.each([
		{
			code: "forbidden",
			error: new AuthorizationError({
				message: "You are not authorized to decide this request",
			}),
			status: 403,
		},
		{
			code: "version_conflict",
			error: new ConflictError({
				message: "Approval workflow decision conflicts with the current state",
				conflictType: "approval_transition",
			}),
			status: 409,
		},
		{
			code: "idempotency_mismatch",
			error: new ConflictError({
				message: "Approval workflow decision conflicts with the current state",
				conflictType: "approval_transition",
			}),
			status: 409,
		},
		{
			code: "malformed_command",
			error: new ValidationError({
				message: "Approval workflow decision is invalid",
			}),
			status: 400,
		},
	])("returns translated canonical $code errors without a 500", async ({
		error,
		status,
	}) => {
		mockState.approveApprovalInboxItem.mockRejectedValue(error);

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(status);
		await expect(response.json()).resolves.toEqual({ error: error.message });
	});

	it("delegates an exact terminal ordinary request for owner replay", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			targetType: "compatibility_request",
			entityId: "period-1",
			entityType: "time_entry",
			approverId: "employee-1",
			requesterEmployeeId: "requester-1",
			organizationId: "org-1",
			status: "approved",
		});
		mockState.approveApprovalInboxItem.mockResolvedValue({
			id: "approval-1",
			type: "time_entry",
			status: "approved",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.approveApprovalInboxItem).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			includeAllApprovers: true,
			eligibleApprovalScopes: [],
		});
	});

	it("delegates a complete canonical assignment to the ordinary owner", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "assignment-1",
			targetType: "canonical_assignment",
			entityId: "period-1",
			entityType: "time_entry",
			approverId: "employee-1",
			requesterEmployeeId: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});
		mockState.approveApprovalInboxItem.mockResolvedValue({
			id: "assignment-1",
			type: "time_entry",
			status: "approved",
		});

		const response = await POST(createRequest(), {
			params: Promise.resolve({ id: "assignment-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.findApprovalRequest).toHaveBeenCalledWith({
			approvalId: "assignment-1",
			organizationId: "org-1",
		});
		expect(mockState.approveApprovalInboxItem).toHaveBeenCalledWith(
			expect.objectContaining({ approvalId: "assignment-1" }),
		);
	});
});
