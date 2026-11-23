import type { EmployeeTime } from "../engagement-stints";

/**
 * `EmployeeTime` for unit tests that mock the database: everyone is an employee all the time,
 * as before External Contractors existed (#1997). Free of database imports, so a suite that
 * mocks `drizzle-orm` or `@/db` can stand it in for `loadEmployeeTime`:
 *
 *   vi.mock("@/lib/engagement/engagement-stints", async () => ({
 *     loadEmployeeTime: async () =>
 *       (await import("@/lib/engagement/testing/all-employee-time")).allEmployeeTime(),
 *   }));
 */
export function allEmployeeTime(): EmployeeTime {
	return {
		stintsOf: () => ({ periods: [], employeeEngagementKind: "employee" }),
		within: (_employeeId, window) => [window],
		hasEmployeeTimeOn: () => true,
		isEmployeeDay: () => true,
		employeeDaysOf: (_employeeId, dates) => ({
			startDate: dates.startDate,
			endDate: dates.endDate,
		}),
		withEmployeeTimeOn: (employeeIds) => [...employeeIds],
	};
}
