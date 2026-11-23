/**
 * #1990: the Berufsmäßigkeit reviews carry EUR earnings, so their cache is scoped to the
 * organization like the sibling contract review queue. Without `includeResolved` the key is the
 * prefix that invalidates both views.
 */
export function shortTermReviewsQueryKey(organizationId: string, includeResolved?: boolean) {
	const prefix = ["contracts", "short-term-berufsmaessigkeit", organizationId] as const;
	return includeResolved === undefined ? prefix : ([...prefix, includeResolved] as const);
}
