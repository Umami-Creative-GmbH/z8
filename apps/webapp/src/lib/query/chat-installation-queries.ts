import type { QueryFilters } from "@tanstack/react-query";
import { queryKeys } from "./keys";

/** Provider changes affect candidate enrollment, member links and channel availability. */
export function chatInstallationQueries(organizationId: string): QueryFilters {
	const [notifications, chatLinks] = queryKeys.notifications.chatLinks();
	const [, preferences] = queryKeys.notifications.preferences();
	return {
		queryKey: [notifications],
		predicate: ({ queryKey }) =>
			(queryKey[1] === chatLinks && queryKey[3] === organizationId) ||
			(queryKey[1] === preferences && queryKey[2] === organizationId),
	};
}
