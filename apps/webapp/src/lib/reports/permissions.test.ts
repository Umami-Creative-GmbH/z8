import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./permissions.ts", import.meta.url)), "utf8");

describe("report accessible employee name source", () => {
	it("returns auth user structured names for accessible employees", () => {
		expect(source).toContain("firstName: currentEmp.user.firstName");
		expect(source).toContain("lastName: currentEmp.user.lastName");
		expect(source).toContain("firstName: emp.user.firstName");
		expect(source).toContain("lastName: emp.user.lastName");
		expect(source).toContain("firstName: rel.employee.user.firstName");
		expect(source).toContain("lastName: rel.employee.user.lastName");
		expect(source).not.toContain("firstName: currentEmp.firstName");
		expect(source).not.toContain("lastName: currentEmp.lastName");
		expect(source).not.toContain("firstName: emp.firstName");
		expect(source).not.toContain("lastName: emp.lastName");
		expect(source).not.toContain("firstName: rel.employee.firstName");
		expect(source).not.toContain("lastName: rel.employee.lastName");
	});
});
