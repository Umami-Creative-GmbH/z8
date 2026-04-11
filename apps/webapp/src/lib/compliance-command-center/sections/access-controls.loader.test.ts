import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findMany: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((value: unknown) => ({ desc: value })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			auditLog: {
				findMany: mockState.findMany,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	auditLog: {
		organizationId: "auditLog.organizationId",
		timestamp: "auditLog.timestamp",
	},
}));

const { getAccessControlsSection } = await import("./access-controls");

describe("getAccessControlsSection", () => {
	it("queries the last 24 hours without pre-filter sampling", async () => {
		mockState.findMany.mockResolvedValue([
				{
					id: "evt-1",
					action: "permission.revoked",
					entityType: "employee",
					timestamp: new Date("2026-04-11T10:00:00.000Z"),
				},
				{
					id: "evt-2",
					action: "schedule.updated",
					entityType: "schedule",
					timestamp: new Date("2026-04-11T11:00:00.000Z"),
				},
		]);

		const result = await getAccessControlsSection("org-1");
		const [query] = mockState.findMany.mock.calls[0] ?? [];

		expect(query.where.and).toEqual(
			expect.arrayContaining([
				{ eq: ["auditLog.organizationId", "org-1"] },
				expect.objectContaining({ gte: ["auditLog.timestamp", expect.any(Date)] }),
			]),
		);
		expect(Object.hasOwn(query, "limit")).toBe(false);
		expect(query.orderBy).toEqual([{ desc: "auditLog.timestamp" }]);
		expect(result.card.status).toBe("critical");
		expect(result.recentCriticalEvents).toHaveLength(1);
	});
});
