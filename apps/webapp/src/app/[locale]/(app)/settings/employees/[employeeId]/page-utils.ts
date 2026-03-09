import type { FormAsyncValidateOrFn, FormValidateOrFn, ReactFormExtendedApi } from "@tanstack/react-form";
import type { EmployeeDetail } from "@/lib/query/use-employee";

export interface EmployeeDetailFormValues {
	firstName: string;
	lastName: string;
	gender: "male" | "female" | "other" | undefined;
	position: string;
	employeeNumber: string;
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

export const defaultFormValues: EmployeeDetailFormValues = {
	firstName: "",
	lastName: "",
	gender: undefined,
	position: "",
	employeeNumber: "",
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

export function syncEmployeeForm(form: EmployeeDetailFormApi, employee: EmployeeDetail) {
	form.reset();
	form.setFieldValue("firstName", employee.firstName || "");
	form.setFieldValue("lastName", employee.lastName || "");
	form.setFieldValue("gender", employee.gender || undefined);
	form.setFieldValue("position", employee.position || "");
	form.setFieldValue("employeeNumber", employee.employeeNumber || "");
	form.setFieldValue("role", employee.role || undefined);
	form.setFieldValue("contractType", employee.contractType || "fixed");
	form.setFieldValue("hourlyRate", employee.currentHourlyRate || "");
	form.setFieldValue("canUseWebapp", employee.user?.canUseWebapp ?? true);
	form.setFieldValue("canUseDesktop", employee.user?.canUseDesktop ?? true);
	form.setFieldValue("canUseMobile", employee.user?.canUseMobile ?? true);
}
