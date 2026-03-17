import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { absenceEntry } from "../absence";
import { approvalRequest } from "../approval";
import { timeRecord } from "../time-record";
import { workPeriod } from "../time-tracking";

function hasCompositeCanonicalFk(table: Parameters<typeof getTableConfig>[0]): boolean {
	const tableConfig = getTableConfig(table);

	return tableConfig.foreignKeys.some((foreignKey) => {
		const reference = foreignKey.reference();

		return (
			reference.columns.length === 2
			&& reference.foreignColumns.length === 2
			&& reference.columns[0]?.name === "canonical_record_id"
			&& reference.columns[1]?.name === "organization_id"
			&& reference.foreignColumns[0]?.name === "id"
			&& reference.foreignColumns[1]?.name === "organization_id"
			&& reference.foreignColumns[0]?.table === timeRecord
			&& reference.foreignColumns[1]?.table === timeRecord
		);
	});
}

describe("canonical linkage schema", () => {
	it("keeps organization + canonical record columns on all legacy tables", () => {
		expect(workPeriod.organizationId.name).toBe("organization_id");
		expect(workPeriod.canonicalRecordId.name).toBe("canonical_record_id");

		expect(approvalRequest.organizationId.name).toBe("organization_id");
		expect(approvalRequest.canonicalRecordId.name).toBe("canonical_record_id");

		expect(absenceEntry.organizationId.name).toBe("organization_id");
		expect(absenceEntry.canonicalRecordId.name).toBe("canonical_record_id");
	});

	it("enforces tenant-safe composite canonical foreign keys", () => {
		expect(hasCompositeCanonicalFk(workPeriod)).toBe(true);
		expect(hasCompositeCanonicalFk(approvalRequest)).toBe(true);
		expect(hasCompositeCanonicalFk(absenceEntry)).toBe(true);
	});
});
