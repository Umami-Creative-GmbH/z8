import { describe, expect, it } from "vitest";
import { mapRecentlyApprovedRequestRows } from "./recently-approved-requests";

describe("mapRecentlyApprovedRequestRows", () => {
	it("returns the relation names expected by the recently approved widget", () => {
		const updatedAt = new Date("2026-06-05T10:00:00.000Z");

		const result = mapRecentlyApprovedRequestRows([
			{
				id: "approval-1",
				entityType: "absence_entry",
				updatedAt,
				requester: { user: { name: "Ada" } },
				approver: { user: { name: "Grace" } },
			},
		]);

		expect(result).toEqual([
			{
				id: "approval-1",
				type: "absence",
				updatedAt,
				requestedByEmployee: { user: { name: "Ada" } },
				approverEmployee: { user: { name: "Grace" } },
			},
		]);
	});
});
