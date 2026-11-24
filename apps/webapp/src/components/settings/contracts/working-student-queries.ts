import type { QueryClient } from "@tanstack/react-query";
import { invalidateStatutoryReviewViews } from "./statutory-review-query-keys";

/** TanStack Query keys for working-student data (#1991), always scoped to the organization. */
export const workingStudentQueryKeys = {
	monitor: (organizationId: string, employeeId: string) =>
		["working-student-monitor", organizationId, employeeId] as const,
	reviews: (organizationId: string) =>
		["contracts", "working-student-reviews", organizationId] as const,
};

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

/**
 * After a change to the organization's statutory preferences (warning tiers, the daytime band,
 * #2017): every employee's monitor card and the organization's review lists judge anew.
 */
export function invalidateOrganizationWorkingStudentFindings(
	queryClient: QueryClient,
	organizationId: string,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: ["working-student-monitor", organizationId] }),
		queryClient.invalidateQueries({ queryKey: workingStudentQueryKeys.reviews(organizationId) }),
		invalidateStatutoryReviewViews(queryClient, organizationId),
	]);
}
