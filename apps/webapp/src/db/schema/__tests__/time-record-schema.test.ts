import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordBreak,
	timeRecordWork,
} from "../time-record";

describe("time-record schema", () => {
	it("exports canonical base and extension tables", () => {
		expect(timeRecord).toBeDefined();
		expect(timeRecordWork).toBeDefined();
		expect(timeRecordAbsence).toBeDefined();
		expect(timeRecordBreak).toBeDefined();
		expect(timeRecordAllocation).toBeDefined();
		expect(timeRecordApprovalDecision).toBeDefined();
	});

	it("keeps organization scoping on all canonical tables", () => {
		expect(timeRecord.organizationId).toBeDefined();
		expect(timeRecordWork.organizationId).toBeDefined();
		expect(timeRecordAbsence.organizationId).toBeDefined();
		expect(timeRecordBreak.organizationId).toBeDefined();
		expect(timeRecordAllocation.organizationId).toBeDefined();
		expect(timeRecordApprovalDecision.organizationId).toBeDefined();
	});

	it("defines core canonical time record columns with stable DB names", () => {
		expect(timeRecord.startAt.name).toBe("start_at");
		expect(timeRecord.endAt.name).toBe("end_at");
		expect(timeRecord.durationMinutes.name).toBe("duration_minutes");
		expect(timeRecord.recordKind.name).toBe("record_kind");
		expect(timeRecord.approvalState.name).toBe("approval_state");
		expect(timeRecord.origin.name).toBe("origin");
	});

	it("defines allocation discriminator shape for project and cost center", () => {
		expect(timeRecordAllocation.allocationKind.name).toBe("allocation_kind");
		expect(timeRecordAllocation.projectId.name).toBe("project_id");
		expect(timeRecordAllocation.costCenterId.name).toBe("cost_center_id");
		expect(timeRecordAllocation.weightPercent.name).toBe("weight_percent");
	});

	it("keeps record links for each extension table", () => {
		expect(timeRecordWork.recordId.name).toBe("record_id");
		expect(timeRecordAbsence.recordId.name).toBe("record_id");
		expect(timeRecordBreak.recordId.name).toBe("record_id");
		expect(timeRecordAllocation.recordId.name).toBe("record_id");
		expect(timeRecordApprovalDecision.recordId.name).toBe("record_id");
	});

	it("stores canonical kind on subtype extension tables", () => {
		expect(timeRecordWork.recordKind.name).toBe("record_kind");
		expect(timeRecordAbsence.recordKind.name).toBe("record_kind");
		expect(timeRecordBreak.recordKind.name).toBe("record_kind");
	});

	it("keeps canonical base uniqueness and preserves legacy work uniqueness for push compatibility", () => {
		const timeRecordUniqueConstraints = getTableConfig(timeRecord).uniqueConstraints.map(
			(constraint) => constraint.getName(),
		);
		const timeRecordWorkIndexes = getTableConfig(timeRecordWork)
			.indexes.filter((index) => index.config.unique)
			.map((index) => index.config.name);
		const timeRecordWorkUniqueConstraints = getTableConfig(timeRecordWork).uniqueConstraints.map(
			(constraint) => constraint.getName(),
		);
		const allocationForeignKeys = getTableConfig(timeRecordAllocation).foreignKeys.map(
			(foreignKey) => foreignKey.reference(),
		);

		expect(timeRecordUniqueConstraints).toEqual(
			expect.arrayContaining(["timeRecord_id_organizationId_idx", "timeRecord_id_recordKind_idx"]),
		);
		expect(timeRecordWorkIndexes).not.toEqual(
			expect.arrayContaining(["timeRecordWork_record_org_idx"]),
		);
		expect(timeRecordWorkUniqueConstraints).not.toEqual(
			expect.arrayContaining(["timeRecordWork_record_org_idx"]),
		);
		expect(
			allocationForeignKeys.some((reference) => {
				return (
					reference.columns.length === 1 &&
					reference.columns[0]?.name === "record_id" &&
					reference.foreignColumns.length === 1 &&
					reference.foreignColumns[0]?.table === timeRecordWork &&
					reference.foreignColumns[0]?.name === "record_id"
				);
			}),
		).toBe(true);
		expect(
			allocationForeignKeys.some((reference) => {
				return (
					reference.columns.length === 2 &&
					reference.columns[0]?.name === "record_id" &&
					reference.columns[1]?.name === "organization_id" &&
					reference.foreignColumns.length === 2 &&
					reference.foreignColumns[0]?.table === timeRecord &&
					reference.foreignColumns[0]?.name === "id" &&
					reference.foreignColumns[1]?.table === timeRecord &&
					reference.foreignColumns[1]?.name === "organization_id"
				);
			}),
		).toBe(true);
	});
});
