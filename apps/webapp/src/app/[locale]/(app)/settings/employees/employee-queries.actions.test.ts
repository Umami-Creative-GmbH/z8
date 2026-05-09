import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./employee-queries.actions.ts", import.meta.url)),
	"utf8",
);

describe("employee query name source", () => {
	it("uses auth user structured names for employee search and sort", () => {
		expect(source).toContain("$" + "{user.firstName}");
		expect(source).toContain("$" + "{user.lastName}");
		expect(source).toContain("ilike(user.firstName, pattern)");
		expect(source).toContain("ilike(user.lastName, pattern)");
		expect(source).not.toContain("ilike(employee.firstName, pattern)");
		expect(source).not.toContain("ilike(employee.lastName, pattern)");
	});

	it("mirrors auth structured names onto selectable root fields", () => {
		expect(source).toContain("firstName: row.user.firstName");
		expect(source).toContain("lastName: row.user.lastName");
		expect(source).not.toContain("firstName: row.employee.firstName");
		expect(source).not.toContain("lastName: row.employee.lastName");
	});
});
