"use client";

import { useQuery } from "@tanstack/react-query";
import {
	type AssignedProject,
	getAssignedProjects,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { queryKeys } from "./keys";

interface UseAssignedProjectsOptions {
	/**
	 * Whether to enable the query
	 * @default true
	 */
	enabled?: boolean;
}

/**
 * Hook to fetch projects the current employee can book time to
 */
export function useAssignedProjects(options: UseAssignedProjectsOptions = {}) {
	const { enabled = true } = options;

	const query = useQuery({
		queryKey: queryKeys.projects.assignable("current"),
		queryFn: async () => {
			const result = await getAssignedProjects();
			if (!result.success) throw new Error(result.error);
			return result.data ?? [];
		},
		enabled,
		staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
	});

	return {
		projects: query.data ?? [],
		isLoading: query.isLoading,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
}

export type { AssignedProject };
