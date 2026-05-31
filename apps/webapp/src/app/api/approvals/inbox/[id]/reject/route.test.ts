import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/effect/errors";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	findEmployee: vi.fn(),
	findApprovalRequest: vi.fn(),
	isEligibleManagerForApprovalRequest: vi.fn(async () => false),
	rejectApprovalInboxItem: vi.fn(),
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
	isEligibleManagerForApprovalRequest: mockState.isEligibleManagerForApprovalRequest,
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
	rejectApprovalInboxItem: mockState.rejectApprovalInboxItem,
}));

vi.mock("@/lib/approvals/inbox/source-adapters", () => ({
	isSupportedInboxType: (type: string) =>
		["absence_entry", "time_entry", "travel_expense_claim"].includes(type),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { POST } = await import("./route");

function createRequest(body: unknown): NextRequest {
	return {
		json: vi.fn().mockResolvedValue(body),
		headers: new Headers(),
	} as unknown as NextRequest;
}

function createMalformedJsonRequest(): NextRequest {
	return {
		json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
		headers: new Headers(),
	} as unknown as NextRequest;
}

describe("POST /api/approvals/inbox/[id]/reject", () => {
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
		});
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
		});
		mockState.rejectApprovalInboxItem.mockResolvedValue({
			id: "approval-1",
			type: "absence_entry",
			status: "rejected",
		});
	});

	it("allows an eligible fallback team manager to reject a request assigned to another manager", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.rejectApprovalInboxItem).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			reason: "Missing receipt",
			includeAllApprovers: undefined,
			eligibleApprovalScopes: [
				{
					requesterEmployeeId: "requester-1",
					eligibleApproverIds: ["employee-2", "employee-1"],
				},
			],
		});
	});

	it("returns 401 before parsing malformed JSON for unauthenticated requests", async () => {
		mockState.getSession.mockResolvedValue(null);
		const request = createMalformedJsonRequest();

		const response = await POST(request, {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(401);
		expect(request.json).not.toHaveBeenCalled();
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 when an assigned approver lacks approve or manage permission", async () => {
		mockState.getAbility.mockResolvedValue({ cannot: vi.fn(() => true) });
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 instead of unsupported type when an assigned approver lacks approval permission", async () => {
		mockState.getAbility.mockResolvedValue({ cannot: vi.fn(() => true) });
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "shift_request",
			approverId: "employee-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 when an eligible fallback manager lacks approve or manage permission", async () => {
		mockState.getAbility.mockResolvedValue({ cannot: vi.fn(() => true) });
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 when a requester manager tries to reject a request assigned to a non-manager policy approver", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(false);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "specific-employee-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("rejects requests when ability cannot be resolved before employee lookup or mutation", async () => {
		mockState.getAbility.mockResolvedValue(null);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("does not delegate when no active employee is found in the active organization", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("delegates rejected decisions to the DB-backed inbox decision service", async () => {
		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.rejectApprovalInboxItem).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			reason: "Missing receipt",
			includeAllApprovers: true,
			eligibleApprovalScopes: [],
		});
		await expect(response.json()).resolves.toEqual({
			success: true,
			result: { id: "approval-1", type: "absence_entry", status: "rejected" },
		});
	});

	it("returns 400 for unsupported approval types before parsing or delegating rejection decisions", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "shift_request",
			approverId: "employee-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});
		const request = createRequest({ reason: "Missing receipt" });

		const response = await POST(request, {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Unsupported approval type" });
		expect(request.json).not.toHaveBeenCalled();
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("allows manage-Approval users to reject requests assigned to another employee in the same organization", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.rejectApprovalInboxItem).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			reason: "Missing receipt",
			includeAllApprovers: true,
			eligibleApprovalScopes: [],
		});
	});

	it("returns 403 when a non-manage user rejects a request assigned to another employee", async () => {
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 403 instead of unsupported type when approval scope does not include the request", async () => {
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns wrapper success responses", async () => {
		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
	});

	it("returns decision service conflict errors as 409 responses", async () => {
		mockState.rejectApprovalInboxItem.mockRejectedValue(
			new ConflictError({
				message: "Approval request is already rejected",
				conflictType: "approval_status",
			}),
		);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: "Approval request is already rejected",
		});
	});

	it("returns decision service authorization errors as 403 responses", async () => {
		mockState.rejectApprovalInboxItem.mockRejectedValue(
			new AuthorizationError({
				message: "You are not allowed to reject this request",
			}),
		);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: "You are not allowed to reject this request",
		});
	});

	it("returns decision service not-found errors as 404 responses", async () => {
		mockState.rejectApprovalInboxItem.mockRejectedValue(
			new NotFoundError({
				message: "Absence request not found",
				entityType: "absence_request",
				entityId: "entity-1",
			}),
		);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Absence request not found",
		});
	});

	it("returns already-resolved approvals as stale conflicts", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			organizationId: "org-1",
			status: "rejected",
		});

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: "Request is already rejected",
		});
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});
});
