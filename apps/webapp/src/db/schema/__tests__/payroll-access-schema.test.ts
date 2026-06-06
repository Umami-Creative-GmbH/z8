import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { payrollAccessEmployee, payrollAccessGrant, payrollAccessTeam } from "@/db/schema";

function tableColumnNames(table: { [key: string]: unknown }): string[] {
	return Object.keys(table).filter((key) => !key.startsWith("_") && key !== "enableRLS");
}

function uniqueIndexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
	const config = getTableConfig(table);

	return [
		...config.indexes.filter((index) => index.config.unique).map((index) => index.config.name),
		...config.uniqueConstraints.map((constraint) => constraint.getName()),
	];
}

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

describe("payroll access schema", () => {
	it("defines organization-scoped grant and assignment tables", () => {
		expect(tableColumnNames(payrollAccessGrant)).toEqual(
			expect.arrayContaining([
				"id",
				"organizationId",
				"payrollEmployeeId",
				"scope",
				"isActive",
				"createdAt",
				"createdBy",
				"updatedAt",
				"updatedBy",
			]),
		);
		expect(tableColumnNames(payrollAccessTeam)).toEqual(
			expect.arrayContaining([
				"id",
				"organizationId",
				"grantId",
				"teamId",
				"createdAt",
				"createdBy",
			]),
		);
		expect(tableColumnNames(payrollAccessEmployee)).toEqual(
			expect.arrayContaining([
				"id",
				"organizationId",
				"grantId",
				"employeeId",
				"createdAt",
				"createdBy",
			]),
		);
	});

	it("enforces organization-scoped grant assignments", () => {
		expect(uniqueIndexNames(payrollAccessGrant)).toEqual(
			expect.arrayContaining(["payrollAccessGrant_id_organizationId_idx"]),
		);
		expect(
			hasCompositeForeignKey(
				payrollAccessTeam,
				["grant_id", "organization_id"],
				payrollAccessGrant,
				["id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				payrollAccessEmployee,
				["grant_id", "organization_id"],
				payrollAccessGrant,
				["id", "organization_id"],
			),
		).toBe(true);
	});
});
