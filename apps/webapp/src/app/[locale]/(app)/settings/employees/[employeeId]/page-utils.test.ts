import { describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import {
	buildEmployeeUpdatePayload,
	defaultFormValues,
	formatEmployeeDetailDateInputValue,
	parseEmployeeDetailDateInputValue,
	syncEmployeeForm,
} from "./page-utils";

describe("employee detail page utilities", () => {
	it("includes an empty start date in default form values", () => {
		expect(defaultFormValues.startDate).toBe("");
	});

	it("formats employee dates for date inputs in UTC date-only form", () => {
		expect(
			formatEmployeeDetailDateInputValue(new Date("2026-05-01T22:30:00.000Z")),
		).toBe("2026-05-01");
		expect(formatEmployeeDetailDateInputValue(null)).toBe("");
		expect(formatEmployeeDetailDateInputValue(undefined)).toBe("");
	});

	it("parses date input values for employee updates", () => {
		expect(parseEmployeeDetailDateInputValue("")).toBeNull();
		expect(parseEmployeeDetailDateInputValue("2026-05-01")).toEqual(
			new Date("2026-05-01T00:00:00.000Z"),
		);
	});

	it("builds employee update payloads with nullable start dates", () => {
		expect(
			buildEmployeeUpdatePayload({
				...defaultFormValues,
				position: "Engineer",
				startDate: "2026-05-01",
			}),
		).toEqual(
			expect.objectContaining({
				position: "Engineer",
				startDate: new Date("2026-05-01T00:00:00.000Z"),
			}),
		);

		expect(buildEmployeeUpdatePayload(defaultFormValues)).toEqual(
			expect.objectContaining({ startDate: null }),
		);
	});
});

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
			startDate: null,
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
