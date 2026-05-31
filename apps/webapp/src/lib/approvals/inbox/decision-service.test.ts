import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

const { approvalRequestFindManyMock } = vi.hoisted(() => ({
	approvalRequestFindManyMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: {
				findMany: approvalRequestFindManyMock,
			},
		},
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
	}),
}));

import {
	bulkApproveApprovalInboxItems,
	bulkDecideApprovalInboxItemsFromRequests,
	decideApprovalInboxItemFromRequest,
} from "@/lib/approvals/inbox/decision-service";

describe("approval inbox decision service", () => {
	it("requires rejection reasons", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "reject",
				reason: "   ",
				handler: { type: "absence_entry", reject: vi.fn(), approve: vi.fn() } as never,
			}),
		).rejects.toThrow("Rejection reason is required");
	});

	it("delegates approve to the persisted source handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { type: "absence_entry", approve, reject: vi.fn() } as never,
			}),
		).resolves.toEqual({ id: "approval-1", type: "absence_entry", status: "approved" });
		expect(approve).toHaveBeenCalledWith("absence-1", "manager-1", undefined);
	});

	it("passes approval request options when approving as a non-assigned actor", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "delegate-1",
				action: "approve",
				handler: { type: "absence_entry", approve, reject: vi.fn() } as never,
			}),
		).resolves.toEqual({ id: "approval-1", type: "absence_entry", status: "approved" });
		expect(approve).toHaveBeenCalledWith("absence-1", "delegate-1", {
			approvalRequestId: "approval-1",
			allowAnyApprover: true,
		});
	});

	it("uses an injected effect runner for single decisions", async () => {
		const effect = Effect.succeed(undefined);
		const runEffect = vi.fn(async () => Exit.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { type: "absence_entry", approve: vi.fn(() => effect), reject: vi.fn() } as never,
				runEffect,
			}),
		).resolves.toEqual({ id: "approval-1", type: "absence_entry", status: "approved" });
		expect(runEffect).toHaveBeenCalledWith(effect);
	});

	it("delegates reject to the persisted source handler with trimmed reason", async () => {
		const reject = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "reject",
				reason: "  Missing documentation  ",
				handler: { type: "absence_entry", approve: vi.fn(), reject } as never,
			}),
		).resolves.toEqual({ id: "approval-1", type: "absence_entry", status: "rejected" });
		expect(reject).toHaveBeenCalledWith("absence-1", "manager-1", "Missing documentation", undefined);
	});

	it("passes approval request options when rejecting as a non-assigned actor", async () => {
		const reject = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "delegate-1",
				action: "reject",
				reason: "  Missing documentation  ",
				handler: { type: "absence_entry", approve: vi.fn(), reject } as never,
			}),
		).resolves.toEqual({ id: "approval-1", type: "absence_entry", status: "rejected" });
		expect(reject).toHaveBeenCalledWith("absence-1", "delegate-1", "Missing documentation", {
			approvalRequestId: "approval-1",
			allowAnyApprover: true,
		});
	});

	it("rejects wrong handler type without calling the handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { type: "time_entry", approve, reject: vi.fn() } as never,
			}),
		).rejects.toThrow("Unsupported approval type: absence_entry");
		expect(approve).not.toHaveBeenCalled();
	});

	it("rejects non-pending requests as stale", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "approved",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { type: "absence_entry", approve: vi.fn(), reject: vi.fn() } as never,
			}),
		).rejects.toThrow("Request is already approved");
	});

	it("rejects unsupported entity types", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "shift_request",
					entityId: "shift-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { type: "absence_entry", approve: vi.fn(), reject: vi.fn() } as never,
			}),
		).rejects.toThrow("Unsupported approval type: shift_request");
	});

	it("unwraps handler effect failures", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: {
					type: "absence_entry",
					approve: vi.fn(() => Effect.fail(new Error("domain failed"))),
					reject: vi.fn(),
				} as never,
			}),
		).rejects.toThrow("domain failed");
	});

	it("returns partial success for bulk decisions", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				{
					id: "approval-2",
					entityType: "absence_entry",
					entityId: "absence-2",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "approved",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({ type: "absence_entry", approve: vi.fn(() => Effect.succeed(undefined)), reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toHaveLength(1);
		expect(result.failed).toEqual([
			{ id: "approval-2", code: "stale", message: "Request is already approved" },
		]);
	});

	it("returns not found failures for bulk approval ids missing from the org-scoped query", async () => {
		approvalRequestFindManyMock.mockResolvedValueOnce([
			{
				id: "approval-1",
				entityType: "unsupported_type",
				entityId: "entity-1",
				organizationId: "org-1",
				approverId: "manager-1",
				requestedBy: "employee-1",
				status: "pending",
			},
		]);

		const result = await bulkApproveApprovalInboxItems({
			approvalIds: ["approval-1", "missing-approval"],
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "unsupported",
				message: "Unsupported approval type: unsupported_type",
			},
			{ id: "missing-approval", code: "not_found", message: "Approval not found" },
		]);
	});

	it("returns forbidden for bulk decisions by actors outside assigned and eligible scopes", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					requesterEmployeeId: "employee-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-2",
			action: "approve",
			resolveHandler: () => ({ type: "absence_entry", approve, reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "forbidden",
				message: "You are not authorized to decide this request",
			},
		]);
		expect(approve).not.toHaveBeenCalled();
	});

	it("allows bulk decisions by eligible fallback managers for the request requester and approver", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					requesterEmployeeId: "employee-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-2",
			action: "approve",
			eligibleApprovalScopes: [
				{
					requesterEmployeeId: "employee-1",
					eligibleApproverIds: ["manager-1", "manager-2"],
				},
			],
			resolveHandler: () => ({ type: "absence_entry", approve, reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toEqual([
			{ id: "approval-1", type: "absence_entry", status: "approved" },
		]);
		expect(result.failed).toEqual([]);
		expect(approve).toHaveBeenCalledWith("absence-1", "manager-2", {
			approvalRequestId: "approval-1",
			allowAnyApprover: true,
		});
	});

	it("allows bulk decisions by org-wide manage approvers", async () => {
		const reject = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					requesterEmployeeId: "employee-1",
					status: "pending",
				},
			],
			actorEmployeeId: "admin-1",
			action: "reject",
			reason: "Missing documentation",
			includeAllApprovers: true,
			resolveHandler: () => ({ type: "absence_entry", approve: vi.fn(), reject }) as never,
		});

		expect(result.succeeded).toEqual([
			{ id: "approval-1", type: "absence_entry", status: "rejected" },
		]);
		expect(result.failed).toEqual([]);
		expect(reject).toHaveBeenCalledWith("absence-1", "admin-1", "Missing documentation", {
			approvalRequestId: "approval-1",
			allowAnyApprover: true,
		});
	});

	it("passes an injected effect runner through bulk successful decisions", async () => {
		const effect = Effect.succeed(undefined);
		const runEffect = vi.fn(async () => Exit.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({ type: "absence_entry", approve: vi.fn(() => effect), reject: vi.fn() }) as never,
			runEffect,
		});

		expect(result.succeeded).toEqual([{ id: "approval-1", type: "absence_entry", status: "approved" }]);
		expect(result.failed).toEqual([]);
		expect(runEffect).toHaveBeenCalledWith(effect);
	});

	it("returns a bulk failure for wrong handler type without calling the handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () => ({ type: "time_entry", approve, reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{ id: "approval-1", code: "unsupported", message: "Unsupported approval type: absence_entry" },
		]);
		expect(approve).not.toHaveBeenCalled();
	});

	it("returns a bulk failure for unresolved handlers", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () => null,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{ id: "approval-1", code: "unsupported", message: "Unsupported approval type: absence_entry" },
		]);
	});

	it("maps ambiguous already processed authorization failures as forbidden", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() =>
						Effect.fail({
							_tag: "AuthorizationError",
							message: "Approval request not found, already processed, or you are not the approver",
						}),
					),
					reject: vi.fn(),
				}) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "forbidden",
				message: "You are not authorized to decide this request",
			},
		]);
	});

	it("maps clear already approved failures as stale", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() => Effect.fail(new Error("Approval request is already approved"))),
					reject: vi.fn(),
				}) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "stale",
				message: "Approval request is already approved",
			},
		]);
	});

	it("maps arbitrary bulk handler failures to a generic message", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() => Effect.fail(new Error("database password connection string leaked"))),
					reject: vi.fn(),
				}) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "validation_failed",
				message: "Approval decision failed",
			},
		]);
	});
});
