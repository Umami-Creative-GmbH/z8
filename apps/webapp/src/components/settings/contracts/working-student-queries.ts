import type { QueryClient } from "@tanstack/react-query";
import {
	invalidateStatutoryReviewViews,
	workingStudentQueryKeys,
} from "./statutory-review-query-keys";

/**
 * After a change to an employee's working-student findings (lecture-free period, prior-employer
 * weeks, acknowledgement): refetch every view that shows them, the employee's monitor card and the
 * organization's Reviews & Conflicts list.
 */
export function invalidateWorkingStudentFindings(
	queryClient: QueryClient,
	organizationId: string,
	employeeId: string,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: workingStudentQueryKeys.monitor(organizationId, employeeId),
		}),
		queryClient.invalidateQueries({ queryKey: workingStudentQueryKeys.reviews(organizationId) }),
		invalidateStatutoryReviewViews(queryClient, organizationId),
	]);
}
