import type { PayrollSettleDaysRequest } from "@/app/[locale]/(app)/payroll/actions";
import type { PayrollPeriodRequest } from "./state";

/** The Settlement tab's settle form: which days of the period to settle or unsettle. */
export interface PayrollSettleFormValues {
	startDate: string;
	endDate: string;
	/** Every employee of the workspace's current scope and filters. */
	allEmployees: boolean;
	/** The chosen employees when `allEmployees` is off. */
	employeeIds: string[];
	skipUnclosedMonths: boolean;
	skipPendingAbsences: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The whole period, every employee in scope, pending absences left out. */
export function defaultSettleFormValues(period: PayrollPeriodRequest): PayrollSettleFormValues {
	return {
		startDate: period.startDate,
		endDate: period.endDate,
		allEmployees: true,
		employeeIds: [],
		skipUnclosedMonths: false,
		skipPendingAbsences: true,
	};
}

export type PayrollSettleFormError =
	| { field: "startDate" | "endDate"; error: "outside_period" }
	| { field: "endDate"; error: "before_start" }
	| { field: "employeeIds"; error: "no_employees" };

/** Why the form's selection cannot be settled, per field; empty when it can. */
export function settleFormErrors(
	values: PayrollSettleFormValues,
	period: Pick<PayrollPeriodRequest, "startDate" | "endDate">,
): PayrollSettleFormError[] {
	const errors: PayrollSettleFormError[] = [];
	const inPeriod = (date: string) =>
		ISO_DATE.test(date) && date >= period.startDate && date <= period.endDate;
	if (!inPeriod(values.startDate)) errors.push({ field: "startDate", error: "outside_period" });
	if (!inPeriod(values.endDate)) errors.push({ field: "endDate", error: "outside_period" });
	else if (inPeriod(values.startDate) && values.endDate < values.startDate) {
		errors.push({ field: "endDate", error: "before_start" });
	}
	if (!values.allEmployees && values.employeeIds.length === 0) {
		errors.push({ field: "employeeIds", error: "no_employees" });
	}
	return errors;
}

/**
 * The settle request of the form's selection: its dates, and its employees within the
 * workspace's scope (the chosen ones, or the scope's filter when all are chosen).
 */
export function settleFormRequest(
	values: PayrollSettleFormValues,
	workspace: PayrollPeriodRequest,
): PayrollSettleDaysRequest {
	return {
		startDate: values.startDate,
		endDate: values.endDate,
		label: workspace.label,
		employeeIds: values.allEmployees ? workspace.employeeIds : values.employeeIds,
		skipUnclosedMonths: values.skipUnclosedMonths,
		skipPendingAbsences: values.skipPendingAbsences,
	};
}
