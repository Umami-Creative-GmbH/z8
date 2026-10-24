import { FieldApi, FormApi } from "@tanstack/react-form";
import { describe, expect, it } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import {
	buildEmployeeUpdatePayload,
	defaultFormValues,
	formatEmployeeDetailDateInputValue,
	parseEmployeeDetailDateInputValue,
	showEmployeeSaveRefusal,
	syncEmployeeForm,
} from "./page-utils";

const defaultValues = defaultFormValues;

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

describe("showEmployeeSaveRefusal", () => {
	function createForm() {
		const form = new FormApi({ defaultValues });
		form.mount();
		new FieldApi({ form, name: "employeeNumber" }).mount();
		return form;
	}

	it("puts a taken personnel number on the personnel number field", () => {
		const form = createForm();

		const shown = showEmployeeSaveRefusal(form as never, {
			error: "This personnel number belongs to Ada Holder.",
			refusal: "personnel_number_taken",
		});

		expect(shown).toBe(true);
		expect(form.getFieldMeta("employeeNumber")?.errors).toEqual([
			"This personnel number belongs to Ada Holder.",
		]);
	});

	it("leaves other failures to the caller", () => {
		const form = createForm();

		expect(
			showEmployeeSaveRefusal(form as never, {
				error: "Failed to update employee",
			}),
		).toBe(false);
		expect(form.getFieldMeta("employeeNumber")?.errors).toEqual([]);
	});
});

describe("syncEmployeeForm", () => {
	function createFormMock() {
		const form = new FormApi({ defaultValues });
		form.mount();
		return form;
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
			user: {
				firstName: "Ada",
				lastName: "Lovelace",
			},
		} as EmployeeDetail;

		syncEmployeeForm(form, employee);
		expect(form.state.values).toMatchObject({
			firstName: "Ada",
			lastName: "Lovelace",
			startDate: "2026-05-01",
		});
		expect(form.state.isDirty).toBe(false);
	});

	it("never loads an employee's wage or contract type into the detail form", () => {
		const form = createFormMock();
		syncEmployeeForm(form, {
			kind: "employee",
			contractType: "hourly",
			user: { firstName: "Ada", lastName: "Lovelace" },
		} as EmployeeDetail);

		expect(form.state.values.hourlyRate).toBe("");
		expect(form.state.values.contractType).toBe("fixed");
	});

	it("syncs invitation draft identity fields into the employee detail form", () => {
		const form = createFormMock();
		syncEmployeeForm(form, {
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

		expect(form.state.values).toMatchObject({
			firstName: "Ada",
			lastName: "Lovelace",
			role: "manager",
			hourlyRate: "45.00",
		});
		expect(form.state.isDirty).toBe(false);
	});
});
