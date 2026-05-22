import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./corrections.ts", import.meta.url)), "utf8");

describe("time correction approval routing", () => {
	it("resolves the correction approver from manager links instead of employee.managerId", () => {
		expect(source).toContain("getPrimaryEligibleManagerIdForRequester");
		expect(source).toContain("requesterEmployeeId: currentEmployee.id");
		expect(source).toContain("defaultApproverId: managerId");
		expect(source).not.toContain("currentEmployee.managerId");
	});

	it("preserves the no-manager correction validation error", () => {
		expect(source).toContain('message: "No manager assigned to approve corrections"');
		expect(source).toContain('field: "managerId"');
	});
});
