import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";

const mockState = vi.hoisted(() => ({
	findFirst: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: { query: { member: { findFirst: mockState.findFirst } } },
}));

import { getCurrentApprovedMembership } from "./current-approved-membership";

describe("getCurrentApprovedMembership", () => {
	it("selects the newest approved user+organization membership deterministically", async () => {
		const rows = [
			{
				id: "member-pending",
				userId: "user-1",
				organizationId: "org-1",
				status: "pending",
				role: "owner",
				createdAt: new Date("2027-01-01T00:00:00.000Z"),
			},
			{
				id: "member-approved-a",
				userId: "user-1",
				organizationId: "org-1",
				status: "approved",
				role: "admin",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
			},
			{
				id: "member-approved-z",
				userId: "user-1",
				organizationId: "org-1",
				status: "approved",
				role: "owner",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		];
		mockState.findFirst.mockImplementationOnce(async (options) => {
			const dialect = new PgDialect();
			const predicate = dialect.sqlToQuery(options.where);
			const ordering = options
				.orderBy(member, {
					desc: (column: unknown) => ({ column, direction: "desc" }),
				})
				.map((entry: { column: unknown; direction: string }) => entry);
			const approvedOnly = predicate.params.includes("approved");
			const scopedUserId = predicate.params.includes("user-1");
			const scopedOrganizationId = predicate.params.includes("org-1");
			const deterministic =
				ordering[0]?.column === member.createdAt &&
				ordering[0]?.direction === "desc" &&
				ordering[1]?.column === member.id &&
				ordering[1]?.direction === "desc";

			const selected = rows
				.filter(
					(row) =>
						(!approvedOnly || row.status === "approved") &&
						(!scopedUserId || row.userId === "user-1") &&
						(!scopedOrganizationId || row.organizationId === "org-1"),
				)
				.toSorted((left, right) =>
					deterministic
						? right.createdAt.getTime() - left.createdAt.getTime() ||
							right.id.localeCompare(left.id)
						: 0,
				)[0];
			return selected ? { role: selected.role } : undefined;
		});

		const result = await getCurrentApprovedMembership({
			userId: "user-1",
			organizationId: "org-1",
		});

		expect(result).toEqual({ role: "owner" });
	});

	it("returns null when the user has no approved membership", async () => {
		mockState.findFirst.mockResolvedValueOnce(undefined);

		await expect(
			getCurrentApprovedMembership({
				userId: "user-1",
				organizationId: "org-1",
			}),
		).resolves.toBeNull();
	});
});
