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
});
