import { Context, Effect, Layer } from "effect";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/effect/errors";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	findEmployee: vi.fn(),
	findApprovalRequest: vi.fn(),
	insertAuditLog: vi.fn(),
	handlerReject: vi.fn(),
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
		insert: vi.fn(() => ({
			values: mockState.insertAuditLog,
		})),
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
	auditLog: "auditLog",
}));

vi.mock("@/lib/approvals/domain/registry", () => ({
	registerApprovalHandler: vi.fn(),
	getApprovalHandler: vi.fn(() => ({
		reject: mockState.handlerReject,
	})),
}));

vi.mock("@/lib/approvals/infrastructure/audit-logger", () => {
	const ApprovalAuditLogger = Context.GenericTag<any>("ApprovalAuditLogger");

	return {
		ApprovalAuditLogger,
		ApprovalAuditLoggerLive: Layer.succeed(
			ApprovalAuditLogger,
			ApprovalAuditLogger.of({
				log: vi.fn(() => Effect.succeed(undefined)),
				logBatch: vi.fn(() => Effect.succeed(undefined)),
			}),
		),
	};
});

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

describe("POST /api/approvals/inbox/[id]/reject", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
		mockState.handlerReject.mockReturnValue(Effect.succeed(undefined));
	});

	it("rejects forbidden requests before employee lookup or mutation", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => true),
		});

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.handlerReject).not.toHaveBeenCalled();
	});

	it("does not delegate when no active employee is found in the active organization", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.handlerReject).not.toHaveBeenCalled();
	});

	it("does not write a duplicate audit row after a successful rejection", async () => {
		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.handlerReject).toHaveBeenCalledWith(
			"entity-1",
			"employee-1",
			"Missing receipt",
		);
		expect(mockState.insertAuditLog).not.toHaveBeenCalled();
	});

	it("provides the approval audit logger layer required by shared approval handlers", async () => {
		mockState.handlerReject.mockReturnValue(
			Effect.flatMap(Context.GenericTag<any>("ApprovalAuditLogger"), () =>
				Effect.succeed(undefined),
			),
		);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
	});

	it("returns handler conflict errors as 409 responses", async () => {
		mockState.handlerReject.mockReturnValue(
			Effect.fail(
				new ConflictError({
					message: "Approval request is already rejected",
					conflictType: "approval_status",
				}),
			),
		);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: "Approval request is already rejected",
		});
	});

	it("returns handler authorization errors as 403 responses", async () => {
		mockState.handlerReject.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message: "You are not allowed to reject this request",
				}),
			),
		);

		const response = await POST(createRequest({ reason: "Missing receipt" }), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: "You are not allowed to reject this request",
		});
	});

	it("returns handler not-found errors as 404 responses", async () => {
		mockState.handlerReject.mockReturnValue(
			Effect.fail(
				new NotFoundError({
					message: "Absence request not found",
					entityType: "absence_request",
					entityId: "entity-1",
				}),
			),
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
		expect(mockState.handlerReject).not.toHaveBeenCalled();
	});
});
