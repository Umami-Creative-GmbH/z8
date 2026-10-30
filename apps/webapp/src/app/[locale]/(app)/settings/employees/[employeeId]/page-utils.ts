import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import { DateTime } from "luxon";
import { PERSONNEL_NUMBER_TAKEN } from "@/lib/organization/personnel-number-refusal";
import type { EmployeeDetail } from "@/lib/query/use-employee";

export interface EmployeeDetailFormValues {
	firstName: string;
	lastName: string;
	gender: "male" | "female" | "other" | undefined;
	pronouns: string;
	position: string;
	employeeNumber: string;
	startDate: string;
	role: "admin" | "manager" | "employee" | undefined;
	contractType: "fixed" | "hourly";
	hourlyRate: string;
}

export type EmployeeDetailFormApi = ReactFormExtendedApi<
	EmployeeDetailFormValues,
	FormValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormAsyncValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormAsyncValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormAsyncValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormAsyncValidateOrFn<EmployeeDetailFormValues> | undefined,
	FormAsyncValidateOrFn<EmployeeDetailFormValues> | undefined,
	unknown
>;

type EmployeeDetailFormMetaApi = Pick<EmployeeDetailFormApi, "getFieldMeta">;

export const defaultFormValues: EmployeeDetailFormValues = {
	firstName: "",
	lastName: "",
	gender: undefined,
	pronouns: "",
	position: "",
	employeeNumber: "",
	startDate: "",
	role: undefined,
	contractType: "fixed",
	hourlyRate: "",
};

export const scheduleDayLabels = [
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
	"Sun",
];

export const scheduleDayKeys = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

export function formatEmployeeDetailDateInputValue(
	value: Date | string | null | undefined,
) {
	if (!value) return "";
	const date =
		value instanceof Date
			? DateTime.fromJSDate(value, { zone: "utc" })
			: DateTime.fromISO(value, { zone: "utc" });
	return date.isValid ? (date.toISODate() ?? "") : "";
}

export function parseEmployeeDetailDateInputValue(value: string) {
	if (!value) return null;
	const date = DateTime.fromISO(value, { zone: "utc" }).startOf("day");
	return date.isValid ? date.toJSDate() : null;
}

export function buildEmployeeUpdatePayload(value: EmployeeDetailFormValues) {
	return {
		...value,
		startDate: parseEmployeeDetailDateInputValue(value.startDate),
	};
}

/**
 * Focuses the first field, in form order, that holds an error: a client
 * validation error or a save refusal the server put on the field (a taken
 * personnel number, `showEmployeeSaveRefusal`).
 */
export function focusFirstInvalidEmployeeDetailField(
	formApi: EmployeeDetailFormMetaApi,
) {
	for (const fieldName of [
		"firstName",
		"lastName",
		"pronouns",
		"employeeNumber",
	] as const) {
		if (formApi.getFieldMeta(fieldName)?.errors.length) {
			document
				.querySelector<HTMLInputElement>(`input[name="${fieldName}"]`)
				?.focus();
			break;
		}
	}
}

/**
 * Puts a save refusal the server ties to a form field on that field: a taken
 * personnel number (#881) goes on the personnel number field and stays there
 * until the field changes. False for any other failure, which the caller shows.
 */
export function showEmployeeSaveRefusal(
	form: Pick<EmployeeDetailFormApi, "setFieldMeta">,
	result: { error: string; refusal?: string },
): boolean {
	if (
		result.refusal !== PERSONNEL_NUMBER_TAKEN &&
		result.refusal !== "personnel_number_managed_by_idp"
	)
		return false;
	form.setFieldMeta("employeeNumber", (meta) => ({
		...meta,
		errorMap: { ...meta.errorMap, onSubmit: result.error },
	}));
	return true;
}

export function buildEmployeeDetailFormValues(
	employee: EmployeeDetail,
): EmployeeDetailFormValues {
	return {
		...defaultFormValues,
		firstName: employee.user.firstName || "",
		lastName: employee.user.lastName || "",
		gender: employee.gender || undefined,
		pronouns: employee.pronouns || "",
		position: employee.position || "",
		employeeNumber: employee.employeeNumber || "",
		startDate: formatEmployeeDetailDateInputValue(employee.startDate),
		role: employee.role || undefined,
		// Employee wages change only through confirmed employment terms (ADR 0002).
		contractType:
			employee.kind === "invitationDraft"
				? employee.contractType || "fixed"
				: "fixed",
		hourlyRate:
			employee.kind === "invitationDraft"
				? employee.currentHourlyRate || ""
				: "",
	};
}

export function syncEmployeeForm(
	form: Pick<EmployeeDetailFormApi, "reset">,
	employee: EmployeeDetail,
) {
	// Reset the baseline to the received values. Populating via setFieldValue
	// marks untouched fields dirty, which would prevent a later safe refresh.
	form.reset(buildEmployeeDetailFormValues(employee));
}
