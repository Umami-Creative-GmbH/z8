import { describe, expect, it } from "vitest";
import {
	payrollAccessEmployee,
	payrollAccessGrant,
	payrollAccessTeam,
} from "@/db/schema";

function tableColumnNames(table: { [key: string]: unknown }): string[] {
	return Object.keys(table).filter((key) => !key.startsWith("_") && key !== "enableRLS");
}

describe("payroll access schema", () => {
	it("defines organization-scoped grant and assignment tables", () => {
		expect(tableColumnNames(payrollAccessGrant)).toEqual(
			expect.arrayContaining([
				"id",
				"organizationId",
				"payrollEmployeeId",
				"isActive",
				"createdAt",
				"createdBy",
				"updatedAt",
				"updatedBy",
			]),
		);
		expect(tableColumnNames(payrollAccessTeam)).toEqual(
			expect.arrayContaining(["id", "organizationId", "grantId", "teamId", "createdAt", "createdBy"]),
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
});
