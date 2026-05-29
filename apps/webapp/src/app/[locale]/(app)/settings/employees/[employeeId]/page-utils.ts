import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import { DateTime } from "luxon";
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
	canUseWebapp: boolean;
	canUseDesktop: boolean;
	canUseMobile: boolean;
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
	canUseWebapp: true,
	canUseDesktop: true,
	canUseMobile: true,
};

export const scheduleDayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const scheduleDayKeys = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

export function formatEmployeeDetailDateInputValue(value: Date | string | null | undefined) {
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

export function focusFirstInvalidEmployeeDetailField(formApi: EmployeeDetailFormMetaApi) {
	for (const fieldName of ["firstName", "lastName", "pronouns"] as const) {
		if (formApi.getFieldMeta(fieldName)?.errors.length) {
			document.querySelector<HTMLInputElement>(`input[name="${fieldName}"]`)?.focus();
			break;
		}
	}
}

export function syncEmployeeForm(form: EmployeeDetailFormApi, employee: EmployeeDetail) {
	form.reset();
	form.setFieldValue("firstName", employee.user.firstName || "");
	form.setFieldValue("lastName", employee.user.lastName || "");
	form.setFieldValue("gender", employee.gender || undefined);
	form.setFieldValue("pronouns", employee.pronouns || "");
	form.setFieldValue("position", employee.position || "");
	form.setFieldValue("employeeNumber", employee.employeeNumber || "");
	form.setFieldValue("startDate", formatEmployeeDetailDateInputValue(employee.startDate));
	form.setFieldValue("role", employee.role || undefined);
	form.setFieldValue("contractType", employee.contractType || "fixed");
	form.setFieldValue("hourlyRate", employee.currentHourlyRate || "");
	form.setFieldValue("canUseWebapp", employee.user?.canUseWebapp ?? true);
	form.setFieldValue("canUseDesktop", employee.user?.canUseDesktop ?? true);
	form.setFieldValue("canUseMobile", employee.user?.canUseMobile ?? true);
}
