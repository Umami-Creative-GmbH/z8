"use client";

import { useQuery } from "@tanstack/react-query";
import {
	type AssignedProject,
	getAssignedProjects,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { useSession } from "@/lib/auth-client";
import { CLOCK_READ_SCOPE_CHANGED } from "@/lib/time-tracking/clock-read-scope";
import { queryKeys } from "./keys";

const EMPTY_PROJECTS: AssignedProject[] = [];

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
	const { data: session, isPending } = useSession();
	const scope = {
		userId: session?.user.id ?? null,
		organizationId: session?.session.activeOrganizationId ?? null,
		isLoading: isPending,
	};

	const query = useQuery({
		queryKey: queryKeys.projects.assignable(scope.organizationId ?? "", scope.userId),
		queryFn: async () => {
			const { userId, organizationId } = scope;
			if (!userId || !organizationId) throw new Error(CLOCK_READ_SCOPE_CHANGED);
			const result = await getAssignedProjects({ userId, organizationId });
			if (!result.success) throw new Error(result.error);
			return result.data ?? [];
		},
		enabled: enabled && !!scope.userId && !!scope.organizationId && !scope.isLoading,
		retry: false,
		staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
	});

	return {
		projects: query.data ?? EMPTY_PROJECTS,
		isLoading: query.isLoading,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
}

export type { AssignedProject };
