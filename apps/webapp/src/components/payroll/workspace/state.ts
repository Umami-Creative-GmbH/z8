import type { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import type { PayrollBlockerIdentity } from "@/lib/payroll-workspace/blocker-identity";
import type { PayrollDateRangeMode, PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";

/** The period, scope and format state every tab of the payroll workspace shares. */

export type PayrollTranslate = ReturnType<typeof useTranslate>["t"];

export interface PayrollPeriodRequest {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
}

export interface PayrollWorkspaceState {
	summary: PayrollWorkspaceSummary;
	dateMode: PayrollDateRangeMode;
	startDate: string;
	endDate: string;
	selectedEmployeeIds: string[];
	selectedTeamNames: string[];
	formatId: string;
}

export type PayrollWorkspaceAction =
	| { type: "summaryRefreshed"; summary: PayrollWorkspaceSummary }
	| { type: "summaryDataRefreshed"; summary: PayrollWorkspaceSummary }
	| { type: "dateModeChanged"; dateMode: PayrollDateRangeMode }
	| { type: "startDateChanged"; value: string }
	| { type: "endDateChanged"; value: string }
	| { type: "employeeFilterChanged"; employeeIds: string[] }
	| { type: "teamFilterChanged"; teamNames: string[] }
	| { type: "formatChanged"; formatId: string };

export type SummaryLoadResult =
	| { status: "applied"; summary: PayrollWorkspaceSummary }
	| { status: "failed" | "stale" | "unmounted" };

export interface BlockerFocusRequest {
	id: number;
	targetBlockerKey: PayrollBlockerIdentity | null;
}

export function payrollWorkspaceReducer(
	state: PayrollWorkspaceState,
	action: PayrollWorkspaceAction,
): PayrollWorkspaceState {
	switch (action.type) {
		case "summaryDataRefreshed":
			return { ...state, summary: action.summary };
		case "summaryRefreshed":
			return {
				...state,
				summary: action.summary,
				startDate: action.summary.period.start,
				endDate: action.summary.period.end,
			};
		case "dateModeChanged":
			return { ...state, dateMode: action.dateMode };
		case "startDateChanged":
			return { ...state, startDate: action.value };
		case "endDateChanged":
			return { ...state, endDate: action.value };
		case "employeeFilterChanged":
			return { ...state, selectedEmployeeIds: action.employeeIds };
		case "teamFilterChanged":
			return { ...state, selectedTeamNames: action.teamNames };
		case "formatChanged":
			return { ...state, formatId: action.formatId };
	}
}

export function basePeriodRequest(summary: PayrollWorkspaceSummary): PayrollPeriodRequest {
	return {
		startDate: summary.period.start,
		endDate: summary.period.end,
		label: summary.period.label,
	};
}

export function buildPeriodRequest(start: DateTime, mode: Exclude<PayrollDateRangeMode, "custom">) {
	const normalizedStart = start.startOf(mode);
	const end = normalizedStart.endOf(mode);

	return {
		startDate: normalizedStart.toISODate() ?? "",
		endDate: end.toISODate() ?? "",
		label: formatPeriodLabel(normalizedStart, end, mode),
	};
}

export function getTeamOptions(employees: PayrollWorkspaceSummary["employees"]): string[] {
	return Array.from(
		new Set(employees.flatMap((employee) => (employee.teamName ? [employee.teamName] : []))),
	).toSorted() as string[];
}

export function getFilteredEmployeeIds(
	employees: PayrollWorkspaceSummary["employees"],
	selectedEmployeeIds: string[],
	selectedTeamNames: string[],
): string[] | undefined {
	if (selectedEmployeeIds.length === 0 && selectedTeamNames.length === 0) return undefined;

	const selectedEmployeeIdSet = new Set(selectedEmployeeIds);
	const selectedTeamNameSet = new Set(selectedTeamNames);
	const employeeIds: string[] = [];

	for (const employee of employees) {
		const matchesEmployee =
			selectedEmployeeIds.length === 0 || selectedEmployeeIdSet.has(employee.id);
		const matchesTeam =
			selectedTeamNames.length === 0 ||
			(employee.teamName !== null && selectedTeamNameSet.has(employee.teamName));

		if (matchesEmployee && matchesTeam) {
			employeeIds.push(employee.id);
		}
	}

	return employeeIds;
}

export function formatPeriodLabel(start: DateTime, end: DateTime, mode: PayrollDateRangeMode) {
	if (mode === "month") return start.toFormat("LLLL yyyy");
	if (mode === "week") return `${start.toFormat("LLL d")} - ${end.toFormat("LLL d, yyyy")}`;

	return `${start.toISODate()} - ${end.toISODate()}`;
}

export function formatDisplayedPeriod(
	start: string,
	end: string,
	mode: PayrollDateRangeMode,
	locale: string,
) {
	const startDate = Temporal.PlainDate.from(start);
	const endDate = Temporal.PlainDate.from(end);
	if (mode === "month") return startDate.toLocaleString(locale, { month: "long", year: "numeric" });
	if (mode === "week")
		return `${startDate.toLocaleString(locale, { month: "short", day: "numeric" })} - ${endDate.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric" })}`;
	return `${startDate.toLocaleString(locale)} - ${endDate.toLocaleString(locale)}`;
}
