import { describe, expect, it } from "vitest";
import type { ProratedAllowance } from "./prorated-allowance";
import { prorationNoticeRow } from "./proration-notice";
import type { VacationBalance } from "./types";

const joinedOctober: ProratedAllowance = {
	fullAllowance: 30,
	allowance: 8,
	reason: {
		kind: "prorated",
		employments: [
			{
				kind: "start",
				startDate: "2026-10-01",
				lastWorkingDay: null,
				employmentMonths: 3,
				days: 8,
				floorApplied: false,
			},
		],
		cappedAtFullAllowance: false,
	},
};

function balance(input: Partial<VacationBalance>): VacationBalance {
	return {
		year: 2026,
		totalDays: 8,
		usedDays: 0,
		pendingDays: 0,
		remainingDays: 8,
		overdrawnDays: 0,
		allowance: joinedOctober,
		...input,
	};
}

const employee = { employeeId: "employee-1", name: "Ada Lovelace" };

describe("prorationNoticeRow (#1112)", () => {
	it("lists an employee whose allowance is prorated below the full allowance", () => {
		expect(prorationNoticeRow({ ...employee, balance: balance({ usedDays: 3 }) })).toEqual({
			employeeId: "employee-1",
			name: "Ada Lovelace",
			fullAllowance: 30,
			proratedAllowance: 8,
			overdrawnDays: 0,
			allowance: joinedOctober,
		});
	});

	it("shows the balance's overdrawn vacation: approved days beyond the balance (#1111)", () => {
		expect(
			prorationNoticeRow({
				...employee,
				balance: balance({ usedDays: 10, pendingDays: 2.5, remainingDays: 0, overdrawnDays: 2 }),
			})?.overdrawnDays,
		).toBe(2);
	});

	it("leaves out an employee with a custom allowance", () => {
		expect(
			prorationNoticeRow({
				...employee,
				balance: balance({
					totalDays: 25,
					allowance: {
						fullAllowance: 25,
						allowance: 25,
						reason: { kind: "none", cause: "custom_allowance" },
					},
				}),
			}),
		).toBeNull();
	});

	it("leaves out an employee whose allowance was not reduced", () => {
		expect(
			prorationNoticeRow({
				...employee,
				balance: balance({
					totalDays: 30,
					allowance: { ...joinedOctober, allowance: 30 },
				}),
			}),
		).toBeNull();
		expect(
			prorationNoticeRow({
				...employee,
				balance: balance({
					totalDays: 0,
					allowance: { fullAllowance: 30, allowance: 0, reason: { kind: "not_employed" } },
				}),
			}),
		).toBeNull();
	});

	it("leaves out an employee without a balance or a resolved allowance", () => {
		expect(prorationNoticeRow({ ...employee, balance: null })).toBeNull();
		expect(
			prorationNoticeRow({ ...employee, balance: balance({ allowance: undefined }) }),
		).toBeNull();
	});
});
