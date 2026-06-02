import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EmployeeSelectModal layout", () => {
	it("lets the employee list fill the available sheet height", () => {
		const source = readFileSync(resolve(__dirname, "employee-select-modal.tsx"), "utf8");

		expect(source).not.toContain("max-h-[320px]");
		expect(source).toContain("flex-1 min-h-0 overflow-y-auto");
	});
});
