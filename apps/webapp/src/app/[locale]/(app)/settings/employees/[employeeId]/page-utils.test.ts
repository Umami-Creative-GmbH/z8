import { describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { syncEmployeeForm } from "./page-utils";

describe("syncEmployeeForm", () => {
	it("syncs auth user name fields into the detail form", () => {
		const form = {
			reset: vi.fn(),
			setFieldValue: vi.fn(),
		};
		const employee = {
			firstName: "Stale",
			lastName: "Employee",
			gender: "male",
			position: "Developer",
			employeeNumber: "EMP-001",
			role: "employee",
			contractType: "fixed",
			currentHourlyRate: null,
			user: {
				firstName: "Ada",
				lastName: "Lovelace",
				canUseWebapp: true,
				canUseDesktop: false,
				canUseMobile: true,
			},
		} as EmployeeDetail;

		syncEmployeeForm(form as never, employee);

		expect(form.reset).toHaveBeenCalledOnce();
		expect(form.setFieldValue).toHaveBeenCalledWith("firstName", "Ada");
		expect(form.setFieldValue).toHaveBeenCalledWith("lastName", "Lovelace");
	});
});
