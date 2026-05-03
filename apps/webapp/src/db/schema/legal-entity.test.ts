import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	employee,
	holiday,
	holidayCategory,
	holidayPreset,
	holidayAssignment,
	holidayPresetAssignment,
	legalEntity,
	legalEntityAdmin,
	payrollExportConfig,
	payrollExportJob,
	scheduledExport,
	scheduledExportExecution,
	workPolicy,
	workPolicyAssignment,
	workPolicyViolation,
	changePolicy,
	changePolicyAssignment,
	vacationAllowance,
	vacationPolicyAssignment,
} from "@/db/schema";

function hasCompositeForeignKey(
	table: Parameters<typeof getTableConfig>[0],
	columns: string[],
	foreignTable: Parameters<typeof getTableConfig>[0],
	foreignColumns: string[],
): boolean {
	return getTableConfig(table).foreignKeys.some((foreignKey) => {
		const reference = foreignKey.reference();

		return (
			reference.columns.map((column) => column.name).join(",") === columns.join(",") &&
			reference.foreignColumns.map((column) => column.name).join(",") ===
				foreignColumns.join(",") &&
			reference.foreignColumns.every((column) => column.table === foreignTable)
		);
	});
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
	return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe("legal entity schema", () => {
	it("exports the legal entity tables", () => {
		expect(legalEntity).toBeDefined();
		expect(legalEntityAdmin).toBeDefined();
	});

	it("adds legalEntityId to employee and entity-owned tables", () => {
		const tables = [
			employee,
			holidayCategory,
			holiday,
			holidayPreset,
			holidayAssignment,
			holidayPresetAssignment,
			workPolicy,
			workPolicyAssignment,
			changePolicy,
			changePolicyAssignment,
			vacationAllowance,
			vacationPolicyAssignment,
			payrollExportConfig,
			payrollExportJob,
			scheduledExport,
			scheduledExportExecution,
			workPolicyViolation,
		];

		for (const table of tables) {
			expect(table.legalEntityId).toBeDefined();
		}
	});

	it("enforces schema-level organization integrity for legal entity references", () => {
		expect(indexNames(legalEntity)).toContain("legalEntity_id_organizationId_idx");
		expect(indexNames(employee)).toContain("employee_id_org_entity_idx");

		const entityOwnedTables = [
			legalEntityAdmin,
			employee,
			holidayCategory,
			holiday,
			holidayPreset,
			holidayAssignment,
			holidayPresetAssignment,
			workPolicy,
			workPolicyAssignment,
			workPolicyViolation,
			changePolicy,
			changePolicyAssignment,
			vacationAllowance,
			vacationPolicyAssignment,
			payrollExportConfig,
			payrollExportJob,
			scheduledExport,
			scheduledExportExecution,
		];

		for (const table of entityOwnedTables) {
			expect(
				hasCompositeForeignKey(table, ["legal_entity_id", "organization_id"], legalEntity, [
					"id",
					"organization_id",
				]),
			).toBe(true);
		}

		expect(
			hasCompositeForeignKey(
				legalEntityAdmin,
				["employee_id", "organization_id", "legal_entity_id"],
				employee,
				["id", "organization_id", "legal_entity_id"],
			),
		).toBe(true);
	});
});
