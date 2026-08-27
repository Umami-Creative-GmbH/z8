import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { OrdinaryCanonicalApproval } from "@/lib/approvals/inbox/ordinary-canonical-read";
import {
	getApprovalInboxDetail,
	getApprovalInboxDetailFromRequest,
} from "@/lib/approvals/inbox/read-service";
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
	it("resolves canonical-only detail by assignment id", async () => {
		const detail = {
			item: { id: "assignment-1" },
			sections: [],
			actions: {},
		};
		const canonical = {
			item: { id: "assignment-1" },
			detail,
		} as unknown as OrdinaryCanonicalApproval;
		const loadCanonicalOrdinaryApprovals = vi.fn(async () => [canonical]);

		await expect(
			getApprovalInboxDetail({
				approvalId: "assignment-1",
				organizationId: "org-1",
				approverId: "manager-1",
				database: {
					query: { approvalRequest: { findFirst: async () => null } },
				},
				loadCanonicalOrdinaryApprovals,
			}),
		).resolves.toBe(detail);
		expect(loadCanonicalOrdinaryApprovals).toHaveBeenCalledWith({
			approverId: "manager-1",
			organizationId: "org-1",
			includeAllApprovers: undefined,
			eligibleApprovalScopes: undefined,
			assignmentId: "assignment-1",
			limit: 1,
		});
	});

	it("returns serializable generic detail sections", async () => {
		const result = await getApprovalInboxDetailFromRequest({
			request,
			handler: createHandler(),
		});

		expect(result.item.id).toBe("approval-1");
		expect(result.sections.map((section) => section.type)).toEqual([
			"key_value",
			"timeline",
		]);
		expect(structuredClone(result)).toEqual(result);
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

		const result = await getApprovalInboxDetailFromRequest({
			request,
			handler,
		});

		expect(result.item.id).toBe("approval-1");
		expect(handler.getDetail).toHaveBeenCalledWith("absence-1", "org-1", {
			approvalId: "approval-1",
		});
	});

	it("renders original and requested times for time correction details", async () => {
		const timeCorrectionRequest = {
			...request,
			entityType: "time_entry",
			entityId: "period-1",
		};
		const detail = createDetail({
			approvalType: "time_entry",
			entityId: "period-1",
			typeName: "Time Correction",
			display: {
				title: "Time Correction",
				subtitle: "May 31",
				summary: "Pending correction",
			},
		});
		detail.entity = {
			pendingCorrection: {
				action: "edit",
				clockIn: {
					original: new Date("2026-05-31T08:00:00.000Z"),
					requested: new Date("2026-05-31T08:15:00.000Z"),
				},
				clockOut: {
					original: new Date("2026-05-31T16:00:00.000Z"),
					requested: new Date("2026-05-31T16:30:00.000Z"),
				},
				isOrphaned: false,
			},
		};

		const result = await getApprovalInboxDetailFromRequest({
			request: timeCorrectionRequest,
			handler: createHandler(detail, "time_entry"),
		});

		expect(result.sections).toContainEqual({
			type: "key_value",
			title: {
				key: "approvals:approvals.requestedCorrection",
				fallback: "Requested Correction",
			},
			rows: [
				{
					label: { key: "approvals:approvals.action", fallback: "Action" },
					value: { key: "approvals:approvals.edit", fallback: "Edit" },
				},
				{
					label: { key: "approvals:approvals.clockIn", fallback: "Clock in" },
					value: "08:00 -> 08:15",
				},
				{
					label: { key: "approvals:approvals.clockOut", fallback: "Clock out" },
					value: "16:00 -> 16:30",
				},
			],
		});
		expect(result.sections).toContainEqual({
			type: "timeline",
			title: "Timeline",
			events: [
				{
					id: "created",
					label: "Request created",
					at: "2026-05-31T09:00:00.000Z",
					actorName: "Avery Employee",
				},
			],
		});
	});

	it("renders only changed work metadata for a metadata-only correction", async () => {
		const timeCorrectionRequest = {
			...request,
			entityType: "time_entry",
			entityId: "period-1",
		};
		const detail = createDetail({
			approvalType: "time_entry",
			entityId: "period-1",
			typeName: "Time Correction",
		});
		detail.entity = {
			pendingCorrection: {
				action: "edit",
				clockIn: null,
				clockOut: null,
				metadataChanges: {
					workLocation: { original: "office", requested: "home" },
					workCategory: {
						original: {
							state: "named",
							id: "category-1",
							name: "Training",
						},
						requested: { state: "none" },
					},
				},
				isOrphaned: false,
			},
		};

		const result = await getApprovalInboxDetailFromRequest({
			request: timeCorrectionRequest,
			handler: createHandler(detail, "time_entry"),
		});

		expect(result.sections).toContainEqual({
			type: "key_value",
			title: {
				key: "approvals:approvals.requestedCorrection",
				fallback: "Requested Correction",
			},
			rows: [
				{
					label: { key: "approvals:approvals.action", fallback: "Action" },
					value: { key: "approvals:approvals.edit", fallback: "Edit" },
				},
				{
					label: {
						key: "approvals:approvals.workLocation",
						fallback: "Work location",
					},
					value: {
						kind: "change",
						original: { kind: "work_location", value: "office" },
						requested: { kind: "work_location", value: "home" },
					},
				},
				{
					label: {
						key: "approvals:approvals.workCategory",
						fallback: "Work category",
					},
					value: {
						kind: "change",
						original: {
							kind: "work_category",
							value: {
								state: "named",
								id: "category-1",
								name: "Training",
							},
						},
						requested: {
							kind: "work_category",
							value: { state: "none" },
						},
					},
				},
			],
		});
		expect(JSON.stringify(result.sections)).not.toContain("Clock in");
		expect(JSON.stringify(result.sections)).not.toContain("missing");
	});

	it("omits unchanged metadata rows from mixed correction details", async () => {
		const timeCorrectionRequest = {
			...request,
			entityType: "time_entry",
			entityId: "period-1",
		};
		const detail = createDetail({
			approvalType: "time_entry",
			entityId: "period-1",
			typeName: "Time Correction",
		});
		detail.entity = {
			pendingCorrection: {
				action: "edit",
				clockIn: {
					original: new Date("2026-05-31T08:00:00.000Z"),
					requested: new Date("2026-05-31T08:15:00.000Z"),
				},
				clockOut: null,
				metadataChanges: {},
				isOrphaned: false,
			},
		};

		const result = await getApprovalInboxDetailFromRequest({
			request: timeCorrectionRequest,
			handler: createHandler(detail, "time_entry"),
		});

		const correctionSection = result.sections.find(
			(section) =>
				section.type === "key_value" &&
				typeof section.title !== "string" &&
				section.title.key === "approvals:approvals.requestedCorrection",
		);
		expect(correctionSection).toMatchObject({
			rows: [
				{
					label: { key: "approvals:approvals.action", fallback: "Action" },
					value: { key: "approvals:approvals.edit", fallback: "Edit" },
				},
				{
					label: { key: "approvals:approvals.clockIn", fallback: "Clock in" },
					value: "08:00 -> 08:15",
				},
			],
		});
		expect(JSON.stringify(correctionSection)).not.toContain("Work location");
		expect(JSON.stringify(correctionSection)).not.toContain("Work category");
	});

	it("warns when a pending time correction approval has missing correction entries", async () => {
		const timeCorrectionRequest = {
			...request,
			entityType: "time_entry",
			entityId: "period-1",
		};
		const detail = createDetail({
			approvalType: "time_entry",
			entityId: "period-1",
			typeName: "Time Correction",
			display: {
				title: "Time Correction",
				subtitle: "May 31",
				summary: "Pending correction",
			},
		});
		detail.entity = {
			pendingCorrection: {
				action: "edit",
				clockIn: {
					original: new Date("2026-05-31T08:00:00.000Z"),
					requested: null,
				},
				clockOut: null,
				isOrphaned: true,
			},
		};

		const result = await getApprovalInboxDetailFromRequest({
			request: timeCorrectionRequest,
			handler: createHandler(detail, "time_entry"),
		});

		expect(result.sections).toContainEqual({
			type: "callout",
			title: "Correction data missing",
			body: "This approval references correction entries that no longer exist or no longer match the work period. Reject it or clean up the stale approval request before approving.",
			tone: "danger",
		});
		expect(result.actions.canApprove).toBe(false);
		expect(result.actions.canReject).toBe(true);
	});

	it("warns and disables decisions for an unclassified legacy time approval", async () => {
		const timeRequest = {
			...request,
			entityType: "time_entry",
			entityId: "period-1",
		};
		const warning =
			"This legacy time approval could not be classified. Reconcile it before making a decision.";
		const detail = createDetail({
			approvalType: "time_entry",
			entityId: "period-1",
			typeName: "Unclassified Time Approval",
			isActionable: false,
			warning,
			display: {
				title: "Unclassified Time Approval",
				subtitle: "May 31",
				summary: warning,
			},
		});
		detail.entity = {
			timeApprovalKind: "unclassified",
			timeRequestWarning: warning,
		};

		const result = await getApprovalInboxDetailFromRequest({
			request: timeRequest,
			handler: createHandler(detail, "time_entry"),
		});

		expect(result.sections).toContainEqual({
			type: "callout",
			title: "Reconciliation required",
			body: warning,
			tone: "warning",
		});
		expect(result.actions).toMatchObject({
			canApprove: false,
			canReject: false,
			canBulkApprove: false,
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
