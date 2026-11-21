import { dayHasEntries } from "@/lib/payroll-period/day-entries";
import type { PayrollPeriodDay, PayrollPeriodEmployee } from "@/lib/payroll-period/types";

/**
 * Picking employee-days to settle in the Days tab: which days can be picked, and the
 * selection as a pure reducer. Only unsettled days with entries can be picked; a
 * selection keeps its keys across refetches and shows only the days still pickable.
 */

export interface PayrollSelectedDay {
	employeeId: string;
	date: string;
}

export interface PayrollDaySelectionState {
	/** `payrollDayKey`s of the picked days. */
	keys: ReadonlySet<string>;
	/** The last day clicked without Shift, where a Shift-click range starts. */
	anchor: PayrollSelectedDay | null;
}

export type PayrollDaySelectionAction =
	/** A click on a day; `extend` (Shift) picks the row's days from the anchor to it. */
	| { type: "toggleDay"; employee: PayrollPeriodEmployee; date: string; extend: boolean }
	/** All the employee's pickable days, or none when all are picked. */
	| { type: "toggleEmployee"; employee: PayrollPeriodEmployee }
	/** The date's pickable days of all employees, or none when all are picked. */
	| { type: "toggleDate"; date: string; employees: readonly PayrollPeriodEmployee[] }
	| { type: "clear" };

export const EMPTY_DAY_SELECTION: PayrollDaySelectionState = { keys: new Set(), anchor: null };

export function payrollDayKey(employeeId: string, date: string): string {
	return `${employeeId}|${date}`;
}

/** Why a day cannot be picked, or null when it can: unsettled with entries. */
export function unsettleableReason(
	day: Pick<PayrollPeriodDay, "settlement" | "hasEntries" | "creditedMinutes" | "absences">,
): "settled" | "no_entries" | null {
	if ((day.settlement?.state ?? "unsettled") !== "unsettled") return "settled";
	if (!dayHasEntries(day)) return "no_entries";
	return null;
}

export function isSettleableDay(
	day: Pick<PayrollPeriodDay, "settlement" | "hasEntries" | "creditedMinutes" | "absences">,
): boolean {
	return unsettleableReason(day) === null;
}

export function payrollDaySelectionReducer(
	state: PayrollDaySelectionState,
	action: PayrollDaySelectionAction,
): PayrollDaySelectionState {
	switch (action.type) {
		case "clear":
			return EMPTY_DAY_SELECTION;
		case "toggleEmployee":
			return { ...toggleGroup(state, settleableKeys([action.employee])), anchor: null };
		case "toggleDate":
			return {
				...toggleGroup(state, settleableKeys(action.employees, action.date)),
				anchor: null,
			};
		case "toggleDay":
			return toggleDay(state, action.employee, action.date, action.extend);
	}
}

function toggleDay(
	state: PayrollDaySelectionState,
	employee: PayrollPeriodEmployee,
	date: string,
	extend: boolean,
): PayrollDaySelectionState {
	const day = employee.days.find((candidate) => candidate.date === date);
	if (!day || !isSettleableDay(day)) return state;
	const { anchor } = state;
	if (extend && anchor?.employeeId === employee.id) {
		const [from, to] = anchor.date <= date ? [anchor.date, date] : [date, anchor.date];
		const keys = new Set(state.keys);
		for (const candidate of employee.days) {
			if (candidate.date >= from && candidate.date <= to && isSettleableDay(candidate)) {
				keys.add(payrollDayKey(employee.id, candidate.date));
			}
		}
		return { keys, anchor };
	}
	const keys = new Set(state.keys);
	const key = payrollDayKey(employee.id, date);
	if (keys.has(key)) keys.delete(key);
	else keys.add(key);
	return { keys, anchor: { employeeId: employee.id, date } };
}

/** Picks every key of the group, or drops them all when every one is picked already. */
function toggleGroup(
	state: PayrollDaySelectionState,
	group: readonly string[],
): PayrollDaySelectionState {
	if (group.length === 0) return state;
	const keys = new Set(state.keys);
	const allPicked = group.every((key) => keys.has(key));
	for (const key of group) {
		if (allPicked) keys.delete(key);
		else keys.add(key);
	}
	return { ...state, keys };
}

function settleableKeys(employees: readonly PayrollPeriodEmployee[], date?: string): string[] {
	return employees.flatMap((employee) =>
		employee.days
			.filter((day) => (date === undefined || day.date === date) && isSettleableDay(day))
			.map((day) => payrollDayKey(employee.id, day.date)),
	);
}

/** Whether none, some or all of a group's pickable days are picked. */
export type PayrollSelectionGroupState = "none" | "some" | "all";

/**
 * The picked days still pickable in the loaded employees, in row and date order: a
 * day settled since, or gone from the read, drops out of the selection.
 */
export function currentDaySelection(
	state: PayrollDaySelectionState,
	employees: readonly PayrollPeriodEmployee[],
): PayrollSelectedDay[] {
	if (state.keys.size === 0) return [];
	return employees.flatMap((employee) =>
		employee.days
			.filter((day) => state.keys.has(payrollDayKey(employee.id, day.date)) && isSettleableDay(day))
			.map((day) => ({ employeeId: employee.id, date: day.date })),
	);
}

/** How much of the employee's row, or of the date's column, is picked. */
export function selectionGroupState(
	selected: ReadonlySet<string>,
	employees: readonly PayrollPeriodEmployee[],
	date?: string,
): PayrollSelectionGroupState {
	return groupSelectionState(selected, settleableKeys(employees, date));
}

/** How much of a group of pickable day keys is picked. */
export function groupSelectionState(
	selected: ReadonlySet<string>,
	group: readonly string[],
): PayrollSelectionGroupState {
	let picked = 0;
	for (const key of group) if (selected.has(key)) picked++;
	if (picked === 0) return "none";
	return picked === group.length ? "all" : "some";
}

/** The pickable day keys of each employee's row and each date's column. */
export interface PayrollSettleableGroups {
	byEmployee: ReadonlyMap<string, readonly string[]>;
	byDate: ReadonlyMap<string, readonly string[]>;
}

const NO_KEYS: readonly string[] = [];

/**
 * Every row's and column's pickable day keys in one pass over the loaded days, so the
 * headers need not rescan all employees for each date on every toggle.
 */
export function settleableGroups(
	employees: readonly PayrollPeriodEmployee[],
): PayrollSettleableGroups {
	const byEmployee = new Map<string, string[]>();
	const byDate = new Map<string, string[]>();
	for (const employee of employees) {
		const row: string[] = [];
		for (const day of employee.days) {
			if (!isSettleableDay(day)) continue;
			const key = payrollDayKey(employee.id, day.date);
			row.push(key);
			const column = byDate.get(day.date);
			if (column) column.push(key);
			else byDate.set(day.date, [key]);
		}
		byEmployee.set(employee.id, row);
	}
	return { byEmployee, byDate };
}

/** The pickable keys of an employee's row or a date's column; empty when there are none. */
export function settleableGroup(
	groups: ReadonlyMap<string, readonly string[]>,
	id: string,
): readonly string[] {
	return groups.get(id) ?? NO_KEYS;
}
