import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { approvalRequest } from "../approval";
import { workPeriod } from "../time-tracking";

describe("workPeriod deletion metadata schema", () => {
	it("exposes audit fields for approved deletion", () => {
		expect(workPeriod.deletedAt.name).toBe("deleted_at");
		expect(workPeriod.deletedBy.name).toBe("deleted_by");
		expect(workPeriod.deletionReason.name).toBe("deletion_reason");
		expect(workPeriod.deletionApprovalRequestId.name).toBe("deletion_approval_request_id");
	});

	it("defines tenant-safe deletion approval metadata constraints", () => {
		const tableConfig = getTableConfig(workPeriod);

		expect(tableConfig.indexes.map((index) => index.config.name)).toEqual(
			expect.arrayContaining(["workPeriod_org_deletedAt_idx"]),
		);
		expect(
			tableConfig.foreignKeys.some((foreignKey) => {
				const reference = foreignKey.reference();

				return (
					reference.columns.length === 2 &&
					reference.foreignColumns.length === 2 &&
					reference.columns[0]?.name === "deletion_approval_request_id" &&
					reference.columns[1]?.name === "organization_id" &&
					reference.foreignColumns[0]?.name === "id" &&
					reference.foreignColumns[1]?.name === "organization_id" &&
					reference.foreignColumns[0]?.table === approvalRequest &&
					reference.foreignColumns[1]?.table === approvalRequest
				);
			}),
		).toBe(true);
	});
});
