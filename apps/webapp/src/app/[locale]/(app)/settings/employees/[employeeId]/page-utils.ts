import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import {
	dateFromInstant,
	instantFromDate,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
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
	birthday: string;
	role: "admin" | "manager" | "employee" | undefined;
	contractType: "fixed" | "hourly";
	hourlyRate: string;
	/** The primary team; "" is none. Saved only when it changed (Organization ADR 0010). */
	teamId: string;
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
	birthday: "",
	role: undefined,
	contractType: "fixed",
	hourlyRate: "",
	teamId: "",
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
	try {
		if (value instanceof Date) {
			if (Number.isNaN(value.getTime())) return "";
			return plainDateAt(instantFromDate(value), "UTC").toString();
		}
		const trimmed = value.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
			return parsePlainDate(trimmed).toString();
		}
		return plainDateAt(parseInstant(trimmed), "UTC").toString();
	} catch {
		return "";
	}
}

export function parseEmployeeDetailDateInputValue(value: string) {
	if (!value) return null;
	try {
		const trimmed = value.trim();
		const plainDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
			? parsePlainDate(trimmed)
			: plainDateAt(parseInstant(trimmed), "UTC");
		return dateFromInstant(plainDate.toZonedDateTime("UTC").toInstant());
	} catch {
		return null;
	}
}

/**
 * The save of the form's values. The Team field is sent only when it changed from
 * `currentTeamId`, since saving it moves the employee (Organization ADR 0010).
 */
export function buildEmployeeUpdatePayload(
	value: EmployeeDetailFormValues,
	currentTeamId?: string | null,
) {
	const { teamId, ...rest } = value;
	const nextTeamId = teamId || null;
	return {
		...rest,
		startDate: parseEmployeeDetailDateInputValue(value.startDate),
		// Only an org admin's save keeps it: the server drops a manager's (#1579).
		birthday: parseEmployeeDetailDateInputValue(value.birthday),
		...(currentTeamId !== undefined && nextTeamId !== currentTeamId ? { teamId: nextTeamId } : {}),
	};
}

/**
 * Focuses the first field, in form order, that holds an error: a client
 * validation error or a save refusal the server put on the field (a taken
 * personnel number, `showEmployeeSaveRefusal`).
 */
export function focusFirstInvalidEmployeeDetailField(formApi: EmployeeDetailFormMetaApi) {
	for (const fieldName of ["firstName", "lastName", "pronouns", "employeeNumber"] as const) {
		if (formApi.getFieldMeta(fieldName)?.errors.length) {
			document.querySelector<HTMLInputElement>(`input[name="${fieldName}"]`)?.focus();
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

export function buildEmployeeDetailFormValues(employee: EmployeeDetail): EmployeeDetailFormValues {
	return {
		...defaultFormValues,
		firstName: employee.user.firstName || "",
		lastName: employee.user.lastName || "",
		gender: employee.gender || undefined,
		pronouns: employee.pronouns || "",
		position: employee.position || "",
		employeeNumber: employee.employeeNumber || "",
		startDate: formatEmployeeDetailDateInputValue(employee.startDate),
		birthday: formatEmployeeDetailDateInputValue(employee.birthday),
		role: employee.role || undefined,
		teamId: employee.teamId ?? "",
		// Employee wages change only through confirmed employment terms (ADR 0002).
		contractType: employee.kind === "invitationDraft" ? employee.contractType || "fixed" : "fixed",
		hourlyRate: employee.kind === "invitationDraft" ? employee.currentHourlyRate || "" : "",
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
