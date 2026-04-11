import { Context, Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findMany: vi.fn(),
	fetchEntitiesByIds: vi.fn(),
}));

vi.mock("@/lib/effect/services/database.service", async () => {
	const DatabaseService = Context.GenericTag<any>("DatabaseService");

	return {
		DatabaseService,
		DatabaseServiceLive: Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				query: (_label: string, query: () => Promise<unknown>) => Effect.promise(query),
				db: {
					query: {
						approvalRequest: {
							findMany: mockState.findMany,
						},
					},
				},
			}),
		),
	};
});

import { buildBaseConditions, fetchApprovals } from "@/lib/approvals/handlers/base-handler";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";

describe("fetchApprovals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findMany.mockImplementation(async (query) => {
			const rows = [
				{
					id: "approval-a",
					entityType: "absence_entry",
					entityId: "entity-a",
					approverId: "manager-1",
					organizationId: "org-1",
					status: "pending",
					createdAt: new Date("2026-04-11T09:00:00.000Z"),
					approvedAt: null,
					rejectionReason: null,
					requester: {
						id: "employee-1",
						userId: "user-1",
						teamId: null,
						user: {
							id: "user-1",
							name: "Casey Booker",
							email: "casey@example.com",
							image: null,
						},
					},
				},
				{
					id: "approval-b",
					entityType: "absence_entry",
					entityId: "entity-b",
					approverId: "manager-1",
					organizationId: "org-1",
					status: "pending",
					createdAt: new Date("2026-04-11T09:00:00.000Z"),
					approvedAt: null,
					rejectionReason: null,
					requester: {
						id: "employee-1",
						userId: "user-1",
						teamId: null,
						user: {
							id: "user-1",
							name: "Casey Booker",
							email: "casey@example.com",
							image: null,
						},
					},
				},
				{
					id: "approval-c",
					entityType: "absence_entry",
					entityId: "entity-c",
					approverId: "manager-1",
					organizationId: "org-1",
					status: "pending",
					createdAt: new Date("2026-04-11T09:00:00.000Z"),
					approvedAt: null,
					rejectionReason: null,
					requester: {
						id: "employee-1",
						userId: "user-1",
						teamId: null,
						user: {
							id: "user-1",
							name: "Casey Booker",
							email: "casey@example.com",
							image: null,
						},
					},
				},
			];

			return query.limit ? rows.slice(0, query.limit) : rows;
		});
		mockState.fetchEntitiesByIds.mockResolvedValue(
			new Map([
				["entity-a", { title: "A" }],
				["entity-b", { title: "B" }],
				["entity-c", { title: "C" }],
			]),
		);
	});

	it("does not cap handler candidates by params.limit * 3", async () => {
		const rows = Array.from({ length: 8 }, (_, index) => ({
			id: `approval-${index + 1}`,
			entityType: "absence_entry",
			entityId: `entity-${index + 1}`,
			approverId: "manager-1",
			organizationId: "org-1",
			status: "pending",
			createdAt: new Date(`2026-04-${String(11 - index).padStart(2, "0")}T09:00:00.000Z`),
			approvedAt: null,
			rejectionReason: null,
			requester: {
				id: "employee-1",
				userId: "user-1",
				teamId: null,
				user: {
					id: "user-1",
					name: "Casey Booker",
					email: "casey@example.com",
					image: null,
				},
			},
		}));

		mockState.findMany.mockImplementation(async (query) =>
			query.limit ? rows.slice(0, query.limit) : rows,
		);
		mockState.fetchEntitiesByIds.mockResolvedValue(
			new Map(rows.map((row) => [row.entityId, { title: row.id }])),
		);

		const result = await Effect.runPromise(
			fetchApprovals({
				entityType: "absence_entry",
				params: {
					approverId: "manager-1",
					organizationId: "org-1",
					status: "pending",
					limit: 2,
				},
				fetchEntitiesByIds: (entityIds) => Effect.promise(() => mockState.fetchEntitiesByIds(entityIds)),
				transformToItem: (request, entity) => ({
					id: request.id,
					approvalType: request.entityType,
					entityId: request.entityId,
					typeName: entity.title,
					requester: {
						id: request.requester.id,
						userId: request.requester.userId,
						name: request.requester.user.name,
						email: request.requester.user.email,
						image: request.requester.user.image,
						teamId: request.requester.teamId,
					},
					approverId: request.approverId,
					organizationId: request.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: null,
					priority: "normal",
					sla: {
						deadline: null,
						status: "on_time",
						hoursRemaining: null,
					},
					display: {
						title: entity.title,
						subtitle: entity.title,
						summary: entity.title,
					},
				}),
			}).pipe(Effect.provide(DatabaseServiceLive)),
		);

		expect(result).toHaveLength(8);
		expect(mockState.findMany).toHaveBeenCalledWith(
			expect.not.objectContaining({
				limit: expect.anything(),
			}),
		);
	});

	it("returns all transformed rows from the overfetch window instead of truncating to the page size", async () => {
		const result = await Effect.runPromise(
			fetchApprovals({
				entityType: "absence_entry",
				params: {
					approverId: "manager-1",
					organizationId: "org-1",
					status: "pending",
					limit: 1,
				},
				fetchEntitiesByIds: (entityIds) => Effect.promise(() => mockState.fetchEntitiesByIds(entityIds)),
				transformToItem: (request, entity) => ({
					id: request.id,
					approvalType: request.entityType,
					entityId: request.entityId,
					typeName: entity.title,
					requester: {
						id: request.requester.id,
						userId: request.requester.userId,
						name: request.requester.user.name,
						email: request.requester.user.email,
						image: request.requester.user.image,
						teamId: request.requester.teamId,
					},
					approverId: request.approverId,
					organizationId: request.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: null,
					priority: "normal",
					sla: {
						deadline: null,
						status: "on_time",
						hoursRemaining: null,
					},
					display: {
						title: entity.title,
						subtitle: entity.title,
						summary: entity.title,
					},
				}),
			}).pipe(Effect.provide(DatabaseServiceLive)),
		);

		expect(result.map((item) => item.id)).toEqual(["approval-a", "approval-b", "approval-c"]);
	});

	it("does not apply a handler-level createdAt cursor filter that hides newer lower-priority items", () => {
		const conditions = buildBaseConditions("absence_entry", {
			approverId: "manager-1",
			organizationId: "org-1",
			status: "pending",
			limit: 20,
			cursor: JSON.stringify({
				priority: "urgent",
				createdAt: "2026-04-10T09:00:00.000Z",
				id: "approval-urgent",
			}),
		});

		expect(conditions).toHaveLength(4);
	});
});
