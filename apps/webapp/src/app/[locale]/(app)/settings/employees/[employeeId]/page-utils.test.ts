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
		expect(formatEmployeeDetailDateInputValue(new Date("2026-05-01T22:30:00.000Z"))).toBe(
			"2026-05-01",
		);
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
	function createFormMock() {
		return {
			reset: vi.fn(),
			setFieldValue: vi.fn(),
		};
	}

	it("syncs auth user name fields into the detail form", () => {
		const form = createFormMock();
		const employee = {
			firstName: "Stale",
			lastName: "Employee",
			gender: "male",
			position: "Developer",
			employeeNumber: "EMP-001",
			startDate: new Date("2026-05-01T22:30:00.000Z"),
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
		expect(form.setFieldValue).toHaveBeenCalledWith("startDate", "2026-05-01");
	});

	it("syncs invitation draft identity fields into the employee detail form", () => {
		const form = createFormMock();
		syncEmployeeForm(form as never, {
			kind: "invitationDraft",
			id: "draft-1",
			user: {
				firstName: "Ada",
				lastName: "Lovelace",
				name: "Ada Lovelace",
				email: "ada@example.com",
				image: null,
				id: "draft-1",
			},
			gender: null,
			pronouns: "they/them",
			position: "Lead",
			employeeNumber: "D-100",
			startDate: new Date("2026-06-01T00:00:00.000Z"),
			role: "manager",
			contractType: "hourly",
			currentHourlyRate: "45.00",
			team: null,
		} as EmployeeDetail);

		expect(form.setFieldValue).toHaveBeenCalledWith("firstName", "Ada");
		expect(form.setFieldValue).toHaveBeenCalledWith("lastName", "Lovelace");
		expect(form.setFieldValue).toHaveBeenCalledWith("role", "manager");
		expect(form.setFieldValue).toHaveBeenCalledWith("hourlyRate", "45.00");
	});
});
