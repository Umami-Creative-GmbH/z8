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
import { drizzleQueryFailure, serializedLog } from "@/test/log-redaction";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	findEmployee: vi.fn(),
	findApprovalRequest: vi.fn(),
	isEligibleManagerForApprovalRequest: vi.fn(async () => false),
	rejectApprovalInboxItem: vi.fn(),
	coversCurrentApprover: vi.fn(async () => false),
	findComplianceExceptionDecisionTarget: vi.fn(async (): Promise<unknown> => null),
	decideComplianceExceptionForActor: vi.fn(),
	logger: {
		info: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/lib/approvals/inbox/compliance-exception-inbox", () => ({
	findComplianceExceptionDecisionTarget: mockState.findComplianceExceptionDecisionTarget,
	decideComplianceExceptionForActor: mockState.decideComplianceExceptionForActor,
}));

vi.mock("@/lib/approvals/deputy/deputy-decision-store", () => ({
	coversCurrentApprover: mockState.coversCurrentApprover,
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
	rejectApprovalInboxItem: mockState.rejectApprovalInboxItem,
	loadApprovalInboxDecisionTarget: mockState.findApprovalRequest,
	canAttemptApprovalInboxDecisionTarget: ({
		status,
		workflowKind,
	}: Record<string, string>) =>
		status === "pending" ||
		workflowKind === "manual_time_submission" ||
		workflowKind === "policy_clock_out",
}));

vi.mock("@/lib/approvals/inbox/source-adapters", () => ({
	isSupportedInboxType: (type: string) =>
		["absence_entry", "time_entry", "travel_expense_claim"].includes(type),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { POST } = await import("./route");

const pendingException = {
	entityType: "compliance_exception",
	targetType: "compliance_exception",
	status: "pending",
	workflowKind: null,
};

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

describe("POST /api/approvals/inbox/[id]/reject", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(false);
		mockState.coversCurrentApprover.mockResolvedValue(false);
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
		mockState.rejectApprovalInboxItem.mockResolvedValue({
			id: "approval-1",
			type: "absence_entry",
			status: "rejected",
		});
		mockState.findComplianceExceptionDecisionTarget.mockResolvedValue(null);
	});

	describe("compliance exceptions (#1977)", () => {
		beforeEach(() => {
			mockState.getAbility.mockResolvedValue(
				defineAbilityFor({
					userId: "user-1",
					isPlatformAdmin: false,
					activeOrganizationId: "org-1",
					orgMembership: { organizationId: "org-1", role: "member", status: "active" },
					employee: { id: "employee-1", organizationId: "org-1", role: "manager", teamId: null },
					permissions: { orgWide: null, byTeamId: new Map() },
					managedEmployeeIds: ["employee-2"],
					customRoles: [],
				} satisfies PrincipalContext),
			);
			mockState.findComplianceExceptionDecisionTarget.mockResolvedValue(pendingException);
		});

		it("rejects through the compliance exception adapter with the manager's reason", async () => {
			mockState.decideComplianceExceptionForActor.mockResolvedValue({
				id: "exception-1",
				type: "compliance_exception",
				status: "rejected",
			});

			const response = await POST(createRequest({ reason: "Cover is planned" }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			expect(response.status).toBe(200);
			expect(mockState.decideComplianceExceptionForActor).toHaveBeenCalledWith({
				organizationId: "org-1",
				exceptionId: "exception-1",
				actorEmployeeId: "employee-1",
				canManageCompliance: false,
				action: "reject",
				reason: "Cover is planned",
			});
			expect(mockState.findApprovalRequest).not.toHaveBeenCalled();
			expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
		});

		it("logs the rejection with the approver and the exception, never the reason's text", async () => {
			mockState.decideComplianceExceptionForActor.mockResolvedValue({
				id: "exception-1",
				type: "compliance_exception",
				status: "rejected",
			});

			await POST(createRequest({ reason: "Cover is planned" }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			expect(mockState.logger.info).toHaveBeenCalledWith(
				{
					approvalId: "exception-1",
					entityType: "compliance_exception",
					entityId: "exception-1",
					approverId: "employee-1",
					reasonLength: 16,
				},
				"Compliance exception rejected via unified inbox",
			);
			expect(JSON.stringify(mockState.logger.info.mock.calls)).not.toContain("Cover is planned");
		});

		it("logs a failed decision with its compliance exception target", async () => {
			mockState.decideComplianceExceptionForActor.mockRejectedValue(
				Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
			);

			const response = await POST(createRequest({ reason: "Cover is planned" }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			expect(response.status).toBe(500);
			expect(mockState.logger.error).toHaveBeenCalledWith(
				{
					err: { name: "Error", code: "ECONNRESET" },
					errorCode: "ECONNRESET",
					action: "reject",
					approvalId: "exception-1",
					decisionStage: "decision",
					entityType: "compliance_exception",
					targetType: "compliance_exception",
					requestStatus: "pending",
				},
				"Failed to reject",
			);
		});

		it("logs a failed decision update without the reason its query bound", async () => {
			mockState.decideComplianceExceptionForActor.mockRejectedValue(
				drizzleQueryFailure("update compliance_exception exception set status = $1", [
					"rejected",
					"Cover is planned",
				]),
			);

			const response = await POST(createRequest({ reason: "Cover is planned" }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			expect(response.status).toBe(500);
			expect(mockState.logger.error).toHaveBeenCalledTimes(1);
			const [logged, message] = mockState.logger.error.mock.calls[0] ?? [];
			expect(message).toBe("Failed to reject");
			const line = await serializedLog(logged);
			expect(line).not.toContain("Cover is planned");
			expect(JSON.parse(line)).toMatchObject({
				err: { name: "DrizzleQueryError", code: "22001" },
			});
		});

		it("leaves a blank reason to the adapter, which refuses it after authorizing", async () => {
			mockState.decideComplianceExceptionForActor.mockRejectedValue(
				new ValidationError({ message: "Rejection reason is required", field: "reason" }),
			);

			const response = await POST(createRequest({ reason: "  " }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({ error: "Rejection reason is required" });
			expect(mockState.decideComplianceExceptionForActor).toHaveBeenCalledWith(
				expect.objectContaining({ exceptionId: "exception-1", action: "reject", reason: "  " }),
			);
		});

		// A blank reason must not tell which ids are compliance exceptions: authorization,
		// self-decision and staleness answer first, as for any other id.
		it.each([
			{
				case: "an exception outside the actor's scope as an unknown id",
				error: new NotFoundError({
					message: "Approval not found",
					entityType: "compliance_exception",
					entityId: "exception-1",
				}),
				status: 404,
				body: { error: "Approval not found" },
			},
			{
				case: "the actor's own exception as forbidden",
				error: new AuthorizationError({
					message: "You cannot decide your own compliance exception",
				}),
				status: 403,
				body: { error: "You cannot decide your own compliance exception" },
			},
			{
				case: "an expired exception as stale",
				error: new ConflictError({
					message: "Request is already expired",
					conflictType: "approval_decision",
				}),
				status: 409,
				body: { error: "Request is already expired" },
			},
		])("refuses $case before the blank reason", async ({ error, status, body }) => {
			mockState.decideComplianceExceptionForActor.mockRejectedValue(error);

			const response = await POST(createRequest({ reason: " " }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			expect(response.status).toBe(status);
			await expect(response.json()).resolves.toEqual(body);
		});

		it("answers an out-of-scope exception with a blank reason as it answers an unknown id", async () => {
			mockState.decideComplianceExceptionForActor.mockRejectedValue(
				new NotFoundError({
					message: "Approval not found",
					entityType: "compliance_exception",
					entityId: "exception-1",
				}),
			);
			const exceptionResponse = await POST(createRequest({ reason: "" }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			mockState.findComplianceExceptionDecisionTarget.mockResolvedValue(null);
			mockState.findApprovalRequest.mockResolvedValue(null);
			const unknownResponse = await POST(createRequest({ reason: "" }), {
				params: Promise.resolve({ id: "unknown-1" }),
			});

			expect(exceptionResponse.status).toBe(unknownResponse.status);
			await expect(exceptionResponse.json()).resolves.toEqual(await unknownResponse.json());
		});

		it("never lets a deputy covering for the exception's manager reject it", async () => {
			mockState.coversCurrentApprover.mockResolvedValue(true);
			mockState.decideComplianceExceptionForActor.mockRejectedValue(
				new NotFoundError({
					message: "Approval not found",
					entityType: "compliance_exception",
					entityId: "exception-1",
				}),
			);

			const response = await POST(createRequest({ reason: "Cover is planned" }), {
				params: Promise.resolve({ id: "exception-1" }),
			});

			expect(response.status).toBe(404);
			// The exception's own scope decides; a cover grants nothing here.
			expect(mockState.coversCurrentApprover).not.toHaveBeenCalled();
			expect(mockState.decideComplianceExceptionForActor).toHaveBeenCalledWith({
				organizationId: "org-1",
				exceptionId: "exception-1",
				actorEmployeeId: "employee-1",
				canManageCompliance: false,
				action: "reject",
				reason: "Cover is planned",
			});
			expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
		});

		it("refuses an ordinary request to an employee who only manages Compliance", async () => {
			mockState.getAbility.mockResolvedValue(
				defineAbilityFor({
					userId: "user-1",
					isPlatformAdmin: false,
					activeOrganizationId: "org-1",
					orgMembership: { organizationId: "org-1", role: "admin", status: "active" },
					employee: { id: "employee-1", organizationId: "org-1", role: "employee", teamId: null },
					permissions: { orgWide: null, byTeamId: new Map() },
					managedEmployeeIds: [],
					customRoles: [],
				} satisfies PrincipalContext),
			);
			mockState.findEmployee.mockResolvedValue({
				id: "employee-1",
				organizationId: "org-1",
				role: "employee",
			});
			mockState.findComplianceExceptionDecisionTarget.mockResolvedValue(null);
			// A leftover assignment: managing Compliance never makes them an approver.
			mockState.findApprovalRequest.mockResolvedValue({
				id: "approval-1",
				targetType: "compatibility_request",
				entityId: "entity-1",
				entityType: "absence_entry",
				approverId: "employee-1",
				organizationId: "org-1",
				status: "pending",
			});

			const response = await POST(createRequest({ reason: "Not needed" }), {
				params: Promise.resolve({ id: "approval-1" }),
			});

			expect(response.status).toBe(403);
			expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
			expect(mockState.coversCurrentApprover).not.toHaveBeenCalled();
		});
	});

	it("logs an approval's rejection without the reason's text", async () => {
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

		await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(mockState.logger.info).toHaveBeenCalledWith(
			{
				approvalId: "approval-1",
				entityType: "absence_entry",
				entityId: "entity-1",
				approverId: "employee-1",
				reasonLength: 15,
			},
			"Approval rejected via unified inbox",
		);
		expect(JSON.stringify(mockState.logger.info.mock.calls)).not.toContain("Missing receipt");
	});

	it("allows an eligible fallback team manager to reject a request assigned to another manager", async () => {
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.findApprovalRequest).toHaveBeenCalledWith({
			approvalId: "approval-1",
			organizationId: "org-1",
		});
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

	it("rejects an active manager when approved membership is absent from the ability", async () => {
		mockState.getAbility.mockResolvedValue(createEmptyAbility());

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(
			mockState.isEligibleManagerForApprovalRequest,
		).not.toHaveBeenCalled();
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns 404 when a requester manager tries to reject a request assigned to a non-manager policy approver", async () => {
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

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
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
		await expect(response.json()).resolves.toEqual({
			error: "Unsupported approval type",
		});
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

	it("returns 404 when a non-manage user rejects a request assigned to another employee", async () => {
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

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
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

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
		expect(mockState.rejectApprovalInboxItem).not.toHaveBeenCalled();
	});

	it("returns the same 404 response when the approval ID is missing", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.findApprovalRequest.mockResolvedValue(null);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-missing" }),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Approval not found",
		});
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

	it("returns decision service validation errors as 400 responses", async () => {
		mockState.rejectApprovalInboxItem.mockRejectedValue(
			new ValidationError({ message: "Invalid rejection decision" }),
		);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Invalid rejection decision",
		});
	});

	it("logs actionable context for an unhandled decision failure", async () => {
		const error = Object.assign(
			new Error("Canonical approval invariant failed"),
			{
				_tag: "ApprovalTransitionEngineError",
				code: "invariant",
			},
		);
		mockState.rejectApprovalInboxItem.mockRejectedValue(error);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(500);
		expect(mockState.logger.error).toHaveBeenCalledWith(
			{
				err: { name: "Error", errorTag: "ApprovalTransitionEngineError", code: "invariant" },
				action: "reject",
				approvalId: "approval-1",
				decisionStage: "decision",
				entityType: "absence_entry",
				targetType: "compatibility_request",
				requestStatus: "pending",
				errorTag: "ApprovalTransitionEngineError",
				errorCode: "invariant",
			},
			"Failed to reject",
		);
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
	])(
		"returns translated canonical $code errors without a 500",
		async ({ error, status }) => {
			mockState.rejectApprovalInboxItem.mockRejectedValue(error);

			const response = await POST(
				createRequest({ reason: "Missing receipt" }),
				{
					params: Promise.resolve({ id: "approval-1" }),
				},
			);

			expect(response.status).toBe(status);
			await expect(response.json()).resolves.toEqual({ error: error.message });
		},
	);

	it("delegates an exact terminal ordinary request for owner replay", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			targetType: "compatibility_request",
			entityId: "period-1",
			entityType: "time_entry",
			approverId: "employee-1",
			requesterEmployeeId: "requester-1",
			organizationId: "org-1",
			status: "rejected",
			workflowKind: "manual_time_submission",
		});
		mockState.rejectApprovalInboxItem.mockResolvedValue({
			id: "approval-1",
			type: "time_entry",
			status: "rejected",
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

	it("returns the previous conflict response for a terminal time correction", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			targetType: "compatibility_request",
			entityId: "period-1",
			entityType: "time_entry",
			approverId: "employee-1",
			requesterEmployeeId: "requester-1",
			organizationId: "org-1",
			status: "rejected",
			workflowKind: "time_correction",
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
		mockState.rejectApprovalInboxItem.mockResolvedValue({
			id: "assignment-1",
			type: "time_entry",
			status: "rejected",
		});

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "assignment-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.findApprovalRequest).toHaveBeenCalledWith({
			approvalId: "assignment-1",
			organizationId: "org-1",
		});
		expect(mockState.rejectApprovalInboxItem).toHaveBeenCalledWith(
			expect.objectContaining({ approvalId: "assignment-1" }),
		);
	});
});
