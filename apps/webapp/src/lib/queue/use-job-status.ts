"use client";

/**
 * Job Status Hook with SWR Deduplication
 *
 * Provides real-time job status polling with automatic request deduplication.
 * Multiple components can watch the same job without duplicate API calls.
 *
 * Rule: client-swr-dedup
 */

import useSWR from "swr";

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

const fetcher = async (url: string): Promise<JobStatus> => {
	const res = await fetch(url);
	if (!res.ok) {
		if (res.status === 404) {
			return { state: "unknown", progress: 0 };
		}
		throw new Error("Failed to fetch job status");
	}
	return res.json();
};

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
	const {
		refreshInterval = 2000,
		enabled = true,
		onSuccess,
		onError,
	} = options;

	// Store callbacks in refs to avoid triggering effect reruns
	const onSuccessRef = { current: onSuccess };
	const onErrorRef = { current: onError };
	onSuccessRef.current = onSuccess;
	onErrorRef.current = onError;

	const shouldFetch = enabled && !!jobId;

	const { data, error, isLoading, isValidating, mutate } = useSWR<JobStatus>(
		shouldFetch ? `/api/jobs/${jobId}/status` : null,
		fetcher,
		{
			// SWR deduplication: multiple hooks watching same job share one request
			dedupingInterval: 1000,
			// Stop polling when job is in terminal state
			refreshInterval: (data) => {
				if (!data) return refreshInterval;
				if (data.state === "completed" || data.state === "failed") {
					return 0; // Stop polling
				}
				return refreshInterval;
			},
			// Revalidate on focus to catch updates user might have missed
			revalidateOnFocus: true,
			// Handle completion/failure callbacks
			onSuccess: (data) => {
				if (data.state === "completed" && data.result) {
					onSuccessRef.current?.(data.result);
				} else if (data.state === "failed" && data.error) {
					onErrorRef.current?.(data.error);
				}
			},
		},
	);

	return {
		status: data,
		isLoading,
		isValidating,
		error,
		mutate,
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

	// Use SWR for each job (SWR handles deduplication automatically)
	const results = jobIds.map((id) => {
		// eslint-disable-next-line react-hooks/rules-of-hooks
		return useSWR<JobStatus>(
			enabled ? `/api/jobs/${id}/status` : null,
			fetcher,
			{
				dedupingInterval: 1000,
				refreshInterval: (data) => {
					if (!data) return refreshInterval;
					if (data.state === "completed" || data.state === "failed") {
						return 0;
					}
					return refreshInterval;
				},
			},
		);
	});

	const statuses = new Map<string, JobStatus>();
	let completedCount = 0;
	let failedCount = 0;
	let pendingCount = 0;
	let isLoading = false;

	results.forEach((result, index) => {
		const jobId = jobIds[index];
		if (result.isLoading) {
			isLoading = true;
		}
		if (result.data) {
			statuses.set(jobId, result.data);
			if (result.data.state === "completed") completedCount++;
			else if (result.data.state === "failed") failedCount++;
			else pendingCount++;
		}
	});

	return {
		statuses,
		isLoading,
		completedCount,
		failedCount,
		pendingCount,
	};
}
