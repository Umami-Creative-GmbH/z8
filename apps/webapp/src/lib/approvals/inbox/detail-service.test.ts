import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { getApprovalInboxDetailFromRequest } from "@/lib/approvals/inbox/read-service";
import { DatabaseService } from "@/lib/effect/services/database.service";

const request = {
	id: "approval-1",
	entityType: "absence_entry",
	entityId: "absence-1",
	organizationId: "org-1",
	status: "pending",
	approverId: "manager-1",
};

function createDetail(overrides: Record<string, unknown> = {}) {
	return {
		approval: {
			id: "approval-1",
			approvalType: "absence_entry",
			entityId: "absence-1",
			typeName: "Absence Request",
			requester: {
				id: "employee-1",
				userId: "user-1",
				name: "Avery Employee",
				email: "avery@example.com",
				image: null,
				teamId: null,
			},
			approverId: "manager-1",
			organizationId: "org-1",
			status: "pending",
			createdAt: new Date("2026-05-31T09:00:00.000Z"),
			resolvedAt: null,
			priority: "normal",
			sla: { deadline: null, status: "on_time", hoursRemaining: null },
			display: { title: "Vacation", subtitle: "May 31", summary: "1 day off" },
			...overrides,
		},
		entity: { notes: "Family event" },
		timeline: [
			{
				id: "created",
				type: "created",
				performedBy: { name: "Avery Employee", image: null },
				timestamp: new Date("2026-05-31T09:00:00.000Z"),
				message: "Request created",
			},
		],
	};
}

function createHandler(detail = createDetail(), type = "absence_entry") {
	return {
		type,
		displayName: "Absence Request",
		supportsBulkApprove: true,
		getDetail: vi.fn(() => Effect.succeed(detail)),
	} as never;
}

describe("getApprovalInboxDetailFromRequest", () => {
	it("returns serializable generic detail sections", async () => {
		const result = await getApprovalInboxDetailFromRequest({
			request,
			handler: createHandler(),
		});

		expect(result.item.id).toBe("approval-1");
		expect(result.sections.map((section) => section.type)).toEqual(["key_value", "timeline"]);
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});

	it("provides database services required by registered detail handlers", async () => {
		const detail = createDetail();
		const handler = {
			type: "absence_entry",
			displayName: "Absence Request",
			supportsBulkApprove: true,
			getDetail: vi.fn(() =>
				Effect.gen(function* (_) {
					const dbService = yield* _(DatabaseService);
					return yield* _(dbService.query("getDetail", async () => detail));
				}),
			),
		} as never;

		const result = await getApprovalInboxDetailFromRequest({ request, handler });

		expect(result.item.id).toBe("approval-1");
		expect(handler.getDetail).toHaveBeenCalledWith("absence-1", "org-1", {
			approvalId: "approval-1",
		});
	});

	it("rejects unsupported entity types before calling the handler", async () => {
		const handler = createHandler();

		await expect(
			getApprovalInboxDetailFromRequest({
				request: { ...request, entityType: "shift_request" },
				handler,
			}),
		).rejects.toThrow("Unsupported approval type");
		expect(handler.getDetail).not.toHaveBeenCalled();
	});

	it("rejects mismatched handler types before calling the handler", async () => {
		const handler = createHandler(createDetail(), "time_entry");

		await expect(
			getApprovalInboxDetailFromRequest({
				request,
				handler,
			}),
		).rejects.toThrow("Approval detail mismatch");
		expect(handler.getDetail).not.toHaveBeenCalled();
	});

	it("rejects mismatched approval ids", async () => {
		await expect(
			getApprovalInboxDetailFromRequest({
				request,
				handler: createHandler(createDetail({ id: "approval-2" })),
			}),
		).rejects.toThrow("Approval detail mismatch");
	});

	it("rejects mismatched organizations", async () => {
		await expect(
			getApprovalInboxDetailFromRequest({
				request,
				handler: createHandler(createDetail({ organizationId: "org-2" })),
			}),
		).rejects.toThrow("Approval detail mismatch");
	});

	it("rejects mismatched approvers", async () => {
		await expect(
			getApprovalInboxDetailFromRequest({
				request,
				handler: createHandler(createDetail({ approverId: "manager-2" })),
			}),
		).rejects.toThrow("Approval detail mismatch");
	});

	it("rejects mismatched entity types", async () => {
		await expect(
			getApprovalInboxDetailFromRequest({
				request,
				handler: createHandler(createDetail({ approvalType: "time_entry" })),
			}),
		).rejects.toThrow("Approval detail mismatch");
	});
});
