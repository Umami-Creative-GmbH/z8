import "server-only";

import {
	type CancelAbsenceEmployeeContext,
	cancelAbsenceRequestForEmployee,
} from "./mutations";

export async function cancelAbsenceRequestForExpectedEmployee(
	absenceId: string,
	expectedEmployee: CancelAbsenceEmployeeContext,
): Promise<{ success: boolean; error?: string }> {
	return cancelAbsenceRequestForEmployee(absenceId, expectedEmployee);
}
