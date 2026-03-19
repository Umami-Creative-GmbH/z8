import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	canAccessManagedEmployeeSettingsTarget,
	filterEmployeeUpdateForScopedManager,
} from "./employee-scope";

const source = readFileSync(fileURLToPath(new URL("./employee-action-utils.ts", import.meta.url)), "utf8");

describe("employee settings scope helpers", () => {
	it("keeps org admins fully enabled regardless of manager relationships", () => {
		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "admin",
				isManagedEmployee: false,
			}),
		).toBe(true);
	});

	it("limits managers to employees they actively manage", () => {
		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "manager",
				isManagedEmployee: true,
			}),
		).toBe(true);

		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "manager",
				isManagedEmployee: false,
			}),
		).toBe(false);
	});

	it("keeps regular employees out of managed settings surfaces", () => {
		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "employee",
				isManagedEmployee: true,
			}),
		).toBe(false);
	});

	it("strips org-admin-only employee fields from scoped manager edits", () => {
		expect(
			filterEmployeeUpdateForScopedManager({
				firstName: "Alex",
				lastName: "Stone",
				position: "Supervisor",
				role: "admin",
				employeeNumber: "EMP-1",
				contractType: "hourly",
				hourlyRate: "24",
				canUseWebapp: false,
			}),
		).toEqual({
			firstName: "Alex",
			lastName: "Stone",
			position: "Supervisor",
		});
	});

	it("keeps employee actor lookups restricted to active employee rows", () => {
		expect(source.includes("eq(employee.isActive, true)")).toBe(true);
		expect(source.includes("getEmployeeSettingsActor")).toBe(true);
		expect(source.includes("getCurrentEmployee")).toBe(true);
	});
});
