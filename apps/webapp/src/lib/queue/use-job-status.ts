"use client";

/**
 * Job status polling with shared TanStack Query ownership.
 *
 * Provides real-time job status polling with automatic request deduplication.
 * Multiple components can watch the same job without duplicate API calls.
 *
 */

import { type QueryClient, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { useSession } from "@/lib/auth-client";

export interface JobStatus {
	state: "waiting" | "active" | "completed" | "failed" | "delayed" | "unknown";
	progress: number;
	result?: {
		success: boolean;
		message?: string;
		data?: unknown;
		error?: string;
	};
	error?: string;
}

interface UseJobStatusOptions {
	/**
	 * Polling interval in milliseconds
	 * Set to 0 to disable polling (one-time fetch)
	 * @default 2000
	 */
	refreshInterval?: number;
	/**
	 * Whether to poll the job status
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Callback when job completes successfully
	 */
	onSuccess?: (result: JobStatus["result"]) => void;
	/**
	 * Callback when job fails
	 */
	onError?: (error: string) => void;
}

const fetcher = async (jobId: string, signal: AbortSignal): Promise<JobStatus> => {
	const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`, {
		signal,
		cache: "no-store",
	});
	if (!res.ok) {
		if (res.status === 404) {
			return { state: "unknown", progress: 0 };
		}
		throw new Error("Failed to fetch job status");
	}
	return res.json();
};

function jobStatusKey(userId: string | null, organizationId: string | null, jobId: string) {
	return ["job-status", userId, organizationId, jobId] as const;
}

function subscribeToJobStatus(
	client: QueryClient,
	key: ReturnType<typeof jobStatusKey>,
	notify: (status: JobStatus | undefined) => void,
) {
	const cache = client.getQueryCache();
	const watchedQuery = cache.find({ queryKey: key, exact: true });
	notify(client.getQueryData<JobStatus>(key));
	return cache.subscribe((event) => {
		if (event.type === "updated" && event.query.queryHash === watchedQuery?.queryHash) {
			notify(client.getQueryData<JobStatus>(key));
		}
	});
}

function jobStatusQuery(
	userId: string | null,
	organizationId: string | null,
	jobId: string,
	enabled: boolean,
	refreshInterval: number,
) {
	return {
		queryKey: jobStatusKey(userId, organizationId, jobId),
		queryFn: ({ signal }: { signal: AbortSignal }) => fetcher(jobId, signal),
		enabled: enabled && Boolean(userId) && Boolean(jobId),
		staleTime: 1000,
		refetchOnWindowFocus: true,
		refetchInterval: (query: { state: { data: JobStatus | undefined } }) =>
			query.state.data?.state === "completed" || query.state.data?.state === "failed"
				? false
				: refreshInterval || false,
	};
}

/**
 * Hook to watch job status with automatic deduplication
 *
 * @example
 * ```tsx
 * function ExportProgress({ jobId }: { jobId: string }) {
 *   const { status, isLoading } = useJobStatus(jobId, {
 *     onSuccess: (result) => toast.success("Export complete!"),
 *     onError: (error) => toast.error(error),
 *   });
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <Progress value={status?.progress ?? 0} />
 *   );
 * }
 * ```
 */
export function useJobStatus(
	jobId: string | null | undefined,
	options: UseJobStatusOptions = {},
): {
	status: JobStatus | undefined;
	isLoading: boolean;
	isValidating: boolean;
	error: Error | undefined;
	mutate: () => Promise<JobStatus | undefined>;
} {
	const { refreshInterval = 2000, enabled = true, onSuccess, onError } = options;
	const { data: session, isPending } = useSession();
	const userId = session?.user.id ?? null;
	const organizationId = session?.session.activeOrganizationId ?? null;
	const identity = JSON.stringify([userId, organizationId, jobId]);

	const terminalNotificationsRef = useRef<{
		identity: string;
		outcomes: Set<"success" | "failure">;
	}>({ identity, outcomes: new Set() });

	const shouldFetch = enabled && Boolean(jobId) && Boolean(userId) && !isPending;
	const query = useQuery(
		jobStatusQuery(userId, organizationId, jobId ?? "", shouldFetch, refreshInterval),
	);
	const data = shouldFetch ? query.data : undefined;
	const client = useQueryClient();
	const notifyTerminal = useEffectEvent((sourceIdentity: string, status: JobStatus | undefined) => {
		if (!shouldFetch || sourceIdentity !== identity) return;
		const notifications = terminalNotificationsRef.current.outcomes;
		if (
			status?.state === "failed" ||
			(status?.state === "completed" && status.result?.success === false)
		) {
			if (notifications.has("failure")) return;
			notifications.add("failure");
			onError?.("Job failed");
		} else if (status?.state === "completed" && status.result && !notifications.has("success")) {
			notifications.add("success");
			onSuccess?.(status.result);
		}
	});
	useEffect(() => {
		if (terminalNotificationsRef.current.identity !== identity) {
			terminalNotificationsRef.current = { identity, outcomes: new Set() };
		}
		if (!shouldFetch || !jobId) return;

		return subscribeToJobStatus(client, jobStatusKey(userId, organizationId, jobId), (status) =>
			notifyTerminal(identity, status),
		);
	}, [client, identity, jobId, organizationId, shouldFetch, userId]);

	return {
		status: data,
		isLoading: shouldFetch && query.isPending,
		isValidating: shouldFetch && query.isFetching,
		error: query.error ?? undefined,
		mutate: async () =>
			shouldFetch ? (await query.refetch({ cancelRefetch: false })).data : undefined,
	};
}

/**
 * Hook to watch multiple jobs at once
 * Useful for batch operations or job queues
 */
export function useJobStatuses(
	jobIds: string[],
	options: Omit<UseJobStatusOptions, "onSuccess" | "onError"> = {},
): {
	statuses: Map<string, JobStatus>;
	isLoading: boolean;
	completedCount: number;
	failedCount: number;
	pendingCount: number;
} {
	const { refreshInterval = 2000, enabled = true } = options;
	const { data: session, isPending } = useSession();
	const userId = session?.user.id ?? null;
	const organizationId = session?.session.activeOrganizationId ?? null;
	const shouldFetch = enabled && Boolean(userId) && !isPending;
	// Share each job with single-job observers too; a failed sibling retains its own retry state.
	const queries = useQueries({
		queries: jobIds.map((jobId) =>
			jobStatusQuery(userId, organizationId, jobId, shouldFetch, refreshInterval),
		),
	});
	const results = queries.flatMap((query, index): Array<[string, JobStatus]> =>
		shouldFetch && query.data ? [[jobIds[index], query.data]] : [],
	);
	const isLoading = shouldFetch && queries.some((query) => query.isPending);

	const { statuses, completedCount, failedCount, pendingCount } = results.reduce(
		(accumulator, [jobId, status]) => {
			accumulator.statuses.set(jobId, status);
			if (status.state === "completed" && status.result?.success === false) {
				accumulator.failedCount += 1;
				accumulator.pendingCount -= 1;
				return accumulator;
			}
			if (status.state === "completed") {
				accumulator.completedCount += 1;
				accumulator.pendingCount -= 1;
				return accumulator;
			}
			if (status.state === "failed") {
				accumulator.failedCount += 1;
				accumulator.pendingCount -= 1;
				return accumulator;
			}
			return accumulator;
		},
		{
			statuses: new Map<string, JobStatus>(),
			completedCount: 0,
			failedCount: 0,
			pendingCount: jobIds.length,
		},
	);

	return {
		statuses,
		isLoading,
		completedCount,
		failedCount,
		pendingCount,
	};
}
