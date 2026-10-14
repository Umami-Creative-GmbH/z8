/** My data: where an employee requests and downloads their own personal data export (#811). */
export const MY_DATA_PATH = "/settings/my-data";

/** The employee pages, where org admins request and download admin exports (#1166). */
export const EMPLOYEE_PAGES_PATH = "/settings/employees/";

/** One employee's page. */
export function employeePagePath(employeeId: string): string {
	return `${EMPLOYEE_PAGES_PATH}${employeeId}`;
}
