import { describe, expect, it } from "vitest";
import type { PayrollPeriodDay, PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import {
	currentDaySelection,
	EMPTY_DAY_SELECTION,
	isSettleableDay,
	type PayrollDaySelectionAction,
	type PayrollDaySelectionState,
	payrollDaySelectionReducer,
	groupSelectionState,
	selectionGroupState,
	settleableGroup,
	settleableGroups,
	unsettleableReason,
} from "./payroll-day-selection";

type DayKind = "work" | "empty" | "settled";

function day(date: string, kind: DayKind): PayrollPeriodDay {
	return {
		date,
		creditedMinutes: kind === "empty" ? 0 : 480,
		requiredMinutes: 480,
		differenceMinutes: kind === "empty" ? -480 : 0,
		absences: [],
		holiday: null,
		hasEntries: kind !== "empty",
		settlement:
			kind === "settled"
				? {
						state: "settled",
						settledDayId: `settled-${date}`,
						method: "manual",
						payrollExportJobId: null,
						settledAt: "2026-11-20T10:00:00.000Z",
						paid: { creditedMinutes: 480, absences: [] },
					}
				: { state: "unsettled" },
	};
}

function employee(id: string, kinds: DayKind[]): PayrollPeriodEmployee {
	return {
		id,
		name: id,
		employeeNumber: null,
		teamName: null,
		contractType: "fixed",
		timezone: "Europe/Berlin",
		days: kinds.map((kind, index) => day(`2026-11-0${index + 1}`, kind)),
		totals: { creditedMinutes: 0, requiredMinutes: null, differenceMinutes: null, absenceDays: 0 },
	} as PayrollPeriodEmployee;
}

const anna = employee("anna", ["work", "empty", "work", "settled", "work"]);
const ben = employee("ben", ["work", "work", "empty", "work", "work"]);
const employees = [anna, ben];

function run(...actions: PayrollDaySelectionAction[]): PayrollDaySelectionState {
	return actions.reduce(payrollDaySelectionReducer, EMPTY_DAY_SELECTION);
}

function picked(state: PayrollDaySelectionState) {
	return currentDaySelection(state, employees).map((key) => `${key.employeeId} ${key.date}`);
}

describe("which days can be settled", () => {
	it("allows only unsettled days with entries", () => {
		expect(anna.days.map(isSettleableDay)).toEqual([true, false, true, false, true]);
		expect(anna.days.map(unsettleableReason)).toEqual([null, "no_entries", null, "settled", null]);
	});
});

describe("payrollDaySelectionReducer", () => {
	it("toggles a day on and off, ignoring days that cannot be settled", () => {
		const toggle = (date: string): PayrollDaySelectionAction => ({
			type: "toggleDay",
			employee: anna,
			date,
			extend: false,
		});

		expect(picked(run(toggle("2026-11-01")))).toEqual(["anna 2026-11-01"]);
		expect(picked(run(toggle("2026-11-01"), toggle("2026-11-01")))).toEqual([]);
		expect(run(toggle("2026-11-02"))).toBe(EMPTY_DAY_SELECTION);
		expect(run(toggle("2026-11-04"))).toBe(EMPTY_DAY_SELECTION);
	});

	it("picks a range of the row with Shift, skipping days that cannot be settled", () => {
		const state = run(
			{ type: "toggleDay", employee: anna, date: "2026-11-05", extend: false },
			{ type: "toggleDay", employee: anna, date: "2026-11-01", extend: true },
		);

		expect(picked(state)).toEqual(["anna 2026-11-01", "anna 2026-11-03", "anna 2026-11-05"]);
	});

	it("toggles a single day when Shift-clicking another employee's row", () => {
		const state = run(
			{ type: "toggleDay", employee: anna, date: "2026-11-01", extend: false },
			{ type: "toggleDay", employee: ben, date: "2026-11-05", extend: true },
		);

		expect(picked(state)).toEqual(["anna 2026-11-01", "ben 2026-11-05"]);
	});

	it("toggles all of an employee's settleable days", () => {
		const once = run({ type: "toggleEmployee", employee: ben });
		expect(picked(once)).toEqual([
			"ben 2026-11-01",
			"ben 2026-11-02",
			"ben 2026-11-04",
			"ben 2026-11-05",
		]);
		expect(selectionGroupState(once.keys, [ben])).toBe("all");
		expect(
			picked(payrollDaySelectionReducer(once, { type: "toggleEmployee", employee: ben })),
		).toEqual([]);
	});

	it("completes a partly picked row before clearing it", () => {
		const partly = run({ type: "toggleDay", employee: ben, date: "2026-11-01", extend: false });
		expect(selectionGroupState(partly.keys, [ben])).toBe("some");

		expect(
			picked(payrollDaySelectionReducer(partly, { type: "toggleEmployee", employee: ben })),
		).toHaveLength(4);
	});

	it("toggles a date for every loaded employee", () => {
		const state = run({ type: "toggleDate", date: "2026-11-03", employees });

		// Ben recorded nothing on the 3rd.
		expect(picked(state)).toEqual(["anna 2026-11-03"]);
		expect(selectionGroupState(state.keys, employees, "2026-11-03")).toBe("all");
		expect(selectionGroupState(state.keys, employees, "2026-11-01")).toBe("none");
	});

	it("clears the selection", () => {
		expect(run({ type: "toggleEmployee", employee: anna }, { type: "clear" })).toBe(
			EMPTY_DAY_SELECTION,
		);
	});
});

describe("settleableGroups", () => {
	const groups = settleableGroups(employees);

	it("lists each row's and each column's settleable days in one pass", () => {
		expect(groups.byEmployee.get("anna")).toEqual([
			"anna|2026-11-01",
			"anna|2026-11-03",
			"anna|2026-11-05",
		]);
		expect(groups.byDate.get("2026-11-03")).toEqual(["anna|2026-11-03"]);
		expect(groups.byDate.get("2026-11-01")).toEqual(["anna|2026-11-01", "ben|2026-11-01"]);
	});

	it("gives an empty group to a row or column with nothing to settle", () => {
		const done = employee("done", ["settled", "empty"]);
		const onlyDone = settleableGroups([done]);

		expect(settleableGroup(onlyDone.byEmployee, "done")).toEqual([]);
		expect(settleableGroup(onlyDone.byDate, "2026-11-01")).toEqual([]);
		expect(settleableGroup(groups.byEmployee, "unknown")).toEqual([]);
	});

	it("agrees with selectionGroupState for every row and column", () => {
		const state = run(
			{ type: "toggleDate", date: "2026-11-01", employees },
			{ type: "toggleDay", employee: ben, date: "2026-11-02", extend: false },
		);
		for (const row of employees) {
			expect(groupSelectionState(state.keys, settleableGroup(groups.byEmployee, row.id))).toBe(
				selectionGroupState(state.keys, [row]),
			);
		}
		for (const date of anna.days.map((candidate) => candidate.date)) {
			expect(groupSelectionState(state.keys, settleableGroup(groups.byDate, date))).toBe(
				selectionGroupState(state.keys, employees, date),
			);
		}
	});
});

describe("currentDaySelection", () => {
	it("keeps picked days across a refetch while they can still be settled", () => {
		const state = run({ type: "toggleEmployee", employee: anna });
		const refetched = [
			{
				...anna,
				days: anna.days.map((candidate) =>
					candidate.date === "2026-11-01" ? day(candidate.date, "settled") : candidate,
				),
			},
			ben,
		];

		expect(currentDaySelection(state, refetched)).toEqual([
			{ employeeId: "anna", date: "2026-11-03" },
			{ employeeId: "anna", date: "2026-11-05" },
		]);
	});
});
