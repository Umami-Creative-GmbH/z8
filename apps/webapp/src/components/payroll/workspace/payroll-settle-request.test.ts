import { describe, expect, it } from "vitest";
import {
	defaultSettleFormValues,
	settleFormErrors,
	settleFormRequest,
} from "./payroll-settle-request";

const workspace = {
	startDate: "2026-11-01",
	endDate: "2026-11-30",
	label: "November 2026",
	employeeIds: ["anna", "ben"],
};

describe("the Settlement tab's settle form", () => {
	it("defaults to the whole period and every employee, leaving out pending absences", () => {
		expect(defaultSettleFormValues(workspace)).toEqual({
			startDate: "2026-11-01",
			endDate: "2026-11-30",
			allEmployees: true,
			employeeIds: [],
			skipUnclosedMonths: false,
			skipPendingAbsences: true,
		});
		expect(settleFormErrors(defaultSettleFormValues(workspace), workspace)).toEqual([]);
	});

	it("keeps the dates inside the period and in order", () => {
		const values = defaultSettleFormValues(workspace);

		expect(settleFormErrors({ ...values, startDate: "2026-10-31" }, workspace)).toEqual([
			{ field: "startDate", error: "outside_period" },
		]);
		expect(settleFormErrors({ ...values, endDate: "" }, workspace)).toEqual([
			{ field: "endDate", error: "outside_period" },
		]);
		expect(
			settleFormErrors({ ...values, startDate: "2026-11-20", endDate: "2026-11-10" }, workspace),
		).toEqual([{ field: "endDate", error: "before_start" }]);
	});

	it("needs an employee when not settling everyone", () => {
		const values = { ...defaultSettleFormValues(workspace), allEmployees: false };

		expect(settleFormErrors(values, workspace)).toEqual([
			{ field: "employeeIds", error: "no_employees" },
		]);
		expect(settleFormErrors({ ...values, employeeIds: ["anna"] }, workspace)).toEqual([]);
	});

	it("requests the chosen days and options, keeping the workspace's scope for everyone", () => {
		const values = {
			...defaultSettleFormValues(workspace),
			startDate: "2026-11-09",
			endDate: "2026-11-15",
			skipUnclosedMonths: true,
		};

		expect(settleFormRequest(values, workspace)).toEqual({
			startDate: "2026-11-09",
			endDate: "2026-11-15",
			label: "November 2026",
			employeeIds: ["anna", "ben"],
			skipUnclosedMonths: true,
			skipPendingAbsences: true,
		});
		expect(
			settleFormRequest({ ...values, allEmployees: false, employeeIds: ["ben"] }, workspace)
				.employeeIds,
		).toEqual(["ben"]);
		expect(
			settleFormRequest(values, { ...workspace, employeeIds: undefined }).employeeIds,
		).toBeUndefined();
	});
});
