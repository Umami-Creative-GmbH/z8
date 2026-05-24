import { describe, expect, it } from "vitest";
import { applyAbsenceVisibility, applyIdentityVisibility, suppressSmallGroups } from "./privacy";

describe("works council privacy helpers", () => {
	it("suppresses groups below the configured threshold", () => {
		expect(suppressSmallGroups({ count: 4, threshold: 5, value: 120 })).toEqual({
			state: "insufficient_data",
			count: 4,
			value: null,
		});
		expect(suppressSmallGroups({ count: 5, threshold: 5, value: 120 })).toEqual({
			state: "available",
			count: 5,
			value: 120,
		});
	});

	it("applies identity visibility modes", () => {
		const rows = [
			{ employeeId: "emp-1", employeeName: "Ada Lovelace" },
			{ employeeId: "emp-2", employeeName: "Grace Hopper" },
		];

		expect(applyIdentityVisibility(rows, "aggregated")).toEqual([
			{ employeeId: null, employeeName: null },
			{ employeeId: null, employeeName: null },
		]);
		expect(applyIdentityVisibility(rows, "pseudonymized")).toEqual([
			{ employeeId: "emp-1", employeeName: "Employee A" },
			{ employeeId: "emp-2", employeeName: "Employee B" },
		]);
		expect(applyIdentityVisibility(rows, "named")).toEqual(rows);
	});

	it("applies absence visibility modes", () => {
		const row = { absenceCategory: "Sick Leave", absenceGroup: "sick_leave" as const };
		expect(applyAbsenceVisibility(row, "hidden")).toEqual({ absenceCategory: null });
		expect(applyAbsenceVisibility(row, "grouped")).toEqual({ absenceCategory: "sick_leave" });
		expect(applyAbsenceVisibility(row, "category")).toEqual({ absenceCategory: "Sick Leave" });
	});
});
