/**
 * #1990: the Berufsmäßigkeit reviews carry EUR earnings, so their cache is scoped to the
 * organization like the sibling contract review queue. Without `includeResolved` the key is the
 * prefix that invalidates both views.
 */
/**
 * The Employee Detail monitor, scoped to the organization: org admins' monitors carry EUR
 * earnings. `year` null is the organization's current year; without `year` the key is the prefix
 * that invalidates every year of the employee.
 */
export function shortTermMonitorQueryKey(
	organizationId: string,
	employeeId: string,
	year?: number | null,
) {
	const prefix = ["contracts", "short-term", organizationId, employeeId] as const;
	return year === undefined ? prefix : ([...prefix, year] as const);
}

export function shortTermReviewsQueryKey(organizationId: string, includeResolved?: boolean) {
	const prefix = ["contracts", "short-term-berufsmaessigkeit", organizationId] as const;
	return includeResolved === undefined ? prefix : ([...prefix, includeResolved] as const);
}
