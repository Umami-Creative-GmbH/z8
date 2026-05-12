import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

describe("organization fiscal year start month action", () => {
	test("exports updateOrganizationFiscalYearStartMonth", () => {
		expect(source).toContain("export async function updateOrganizationFiscalYearStartMonth");
	});

	test("requires organization owners to update fiscal year settings", () => {
		expect(source).toContain('if (memberRecord.role !== "owner")');
		expect(source).toContain("Only owners can change organization fiscal year settings");
	});

	test("validates fiscal year start month is an integer from 1 through 12", () => {
		expect(source).toContain("Number.isInteger(month)");
		expect(source).toContain("month < 1 || month > 12");
		expect(source).toContain("Invalid fiscal year start month");
	});

	test("updates fiscal year start month only for the scoped organization", () => {
		expect(source).toContain(".set({ fiscalYearStartMonth: month })");
		expect(source).toContain(".where(eq(authSchema.organization.id, organizationId))");
	});
});
