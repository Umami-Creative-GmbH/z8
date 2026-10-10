"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import {
	addBreakToActiveSession,
	getTimeClockStatus,
	updateTimeEntryNotes,
} from "@/app/[locale]/(app)/time-tracking/actions";
import type { PositionConsentQuestion } from "@/components/position-capture/position-consent-prompt";
import { useOfflineClock } from "@/hooks/use-offline-clock";
import { useSession } from "@/lib/auth-client";
import { type Instant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import type { BookedProjectTask } from "@/lib/projects/project-task-model";
import {
	clockConnectionRequired,
	frozenClockCommandsAvailable,
	offlineClockCaptureAllowed,
	prepareBrowserClockCommand,
} from "@/lib/time-tracking/browser-clock-command";
import type { ClockCommandPosition } from "@/lib/time-tracking/clock-command";
import { useClockPosition } from "@/lib/time-tracking/position-capture/use-clock-position";
import { namedTaskId } from "@/lib/time-tracking/task-attribution";
import { postClockIn, postClockOut } from "@/lib/time-tracking/time-clock-client";
import { getBrowserTimezone } from "@/lib/time-tracking/timezone-capture";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import { queryKeys } from "./keys";

export interface TimeClockState {
	hasEmployee: boolean;
	employeeId: string | null;
	isClockedIn: boolean;
	/** `currentTask`: the running work's task (#874), absent from older status sources. */
	activeWorkPeriod: {
		id: string;
		startTime: Date;
		currentTask?: BookedProjectTask | null;
	} | null;
}

function subscribeToSecondTick(onStoreChange: () => void) {
	const interval = window.setInterval(onStoreChange, 1000);
	return () => window.clearInterval(interval);
}

function getCurrentEpochSecond() {
	return Math.floor(systemClock.nowInstant().epochMilliseconds / 1000);
}

function getServerEpochSecond() {
	return 0;
}

function subscribeToNothing() {
	return () => {};
}

function getBrowserOrigin(): string | null {
	return window.location.origin;
}

function getServerOrigin(): string | null {
	return null;
}

function resolveBrowserTimezone(params?: { browserTimezone?: string | null }) {
	return params && "browserTimezone" in params ? params.browserTimezone : getBrowserTimezone();
}

/**
 * Separate hook for elapsed time counter (rerender-derived-state)
 * Only components that need the real-time counter should use this hook.
 * This prevents unnecessary re-renders in components that only need
 * clock status without the per-second timer updates.
 *
 * @param startTime - The start time to calculate elapsed seconds from, or null if not clocked in
 * @returns The elapsed seconds since startTime, updating every second
 */
export function useElapsedTimer(startTime: Date | null): number {
	const currentEpochSecond = useSyncExternalStore(
		subscribeToSecondTick,
		getCurrentEpochSecond,
		getServerEpochSecond,
	);
	if (!startTime || currentEpochSecond === 0) return 0;

	const startEpochSecond = Math.floor(instantFromDate(startTime).epochMilliseconds / 1000);
	return Math.max(0, currentEpochSecond - startEpochSecond);
}

type FrozenCommandParams = {
	workLocationType?: WorkLocationType;
	browserTimezone?: string | null;
	projectId?: string;
	taskId?: string | null;
	workCategoryId?: string;
	billable?: boolean;
};

interface UseTimeClockOptions {
	/**
	 * Initial data from server-side rendering
	 * If provided, the query will use this as initial data
	 */
	initialData?: TimeClockState | null;
	/**
	 * Whether to enable the query
	 * @default true
	 */
	enabled?: boolean;
}

/**
 * Hook for time clock status and mutations
 *
 * Provides:
 * - Time clock status query with caching
 * - Clock in/out mutations with automatic cache invalidation
 * - Offline support with automatic queuing
 *
 * Note: For real-time elapsed seconds, use `useElapsedTimer` separately.
 * This prevents unnecessary re-renders in components that don't need the timer.
 */
export function useTimeClock(options: UseTimeClockOptions = {}) {
	const { initialData, enabled = true } = options;
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const activeOrganizationId = session?.session.activeOrganizationId;

	// Offline support
	const {
		isOnline,
		isOffline,
		pendingCount,
		isSyncing,
		queueClockEvent,
		commandCapabilities,
		submitClockCommand,
	} = useOfflineClock();
	// Null on the server and during hydration, so both render the same capture mode.
	const origin = useSyncExternalStore(subscribeToNothing, getBrowserOrigin, getServerOrigin);
	const pageSession =
		session?.user?.id && activeOrganizationId && origin
			? {
					userId: session.user.id,
					organizationId: activeOrganizationId,
					origin,
				}
			: null;
	const canFreeze =
		pageSession !== null && frozenClockCommandsAvailable(commandCapabilities, pageSession);
	// Offline, only an adopted organization may capture at all (#845, ADR 0002).
	const canCaptureOffline =
		pageSession !== null && offlineClockCaptureAllowed(commandCapabilities, pageSession);
	// The last clock action was refused for needing a connection; shown inline while offline.
	const [connectionRefused, setConnectionRefused] = useState(false);
	const clockPosition = useClockPosition(Boolean(session?.user?.id && activeOrganizationId));

	/**
	 * Refuses a clock action up front while offline in an organization that is not
	 * adopted, before any position or capture: nothing is stored. Null lets it run.
	 */
	function refuseWithoutConnection() {
		const refused = isOffline && !canCaptureOffline;
		setConnectionRefused(refused);
		return refused ? clockConnectionRequired() : null;
	}

	/**
	 * The employee's own clock event as it happens (#826): fixes the event
	 * instant, then takes the position when capture is on and consented, adding
	 * at most five seconds. A clock action that can carry no position (the legacy
	 * offline queue) takes none. An unanswered notice yields a consent question,
	 * which `afterClockEvent` asks once the event has been submitted.
	 */
	async function captureClockEvent(canCarryPosition: boolean) {
		const now = systemClock.nowInstant();
		const { position, consentQuestion } = canCarryPosition
			? await clockPosition.capture(isOnline)
			: { position: null, consentQuestion: null };
		return { now, position, consentQuestion };
	}

	/** Asks the consent question after an accepted event without holding up its result. */
	function afterClockEvent<T extends { success: boolean }>(
		result: T,
		event: { consentQuestion: PositionConsentQuestion | null },
	): T {
		if (result.success) clockPosition.askAfterEvent(event.consentQuestion);
		return result;
	}

	/**
	 * The frozen command for this action (#279), or null to keep the legacy path:
	 * version 2, or version 3 with the position taken at the event (#826).
	 * Identity, instant and zone are fixed here, before anything is sent.
	 */
	function prepareFrozenCommand(
		kind: "clock_in" | "clock_out",
		params: FrozenCommandParams | undefined,
		event: { now: Instant; position: ClockCommandPosition | null },
	) {
		if (!canFreeze || !pageSession) return null;
		const prepared = prepareBrowserClockCommand({
			kind,
			operationId: crypto.randomUUID(),
			capabilities: commandCapabilities,
			session: pageSession,
			now: event.now,
			position: event.position,
			timezone: resolveBrowserTimezone(params),
			workLocationType: params?.workLocationType,
			knownWorkPeriodId: statusQuery.data?.activeWorkPeriod?.id ?? null,
			projectId: params?.projectId,
			// Frozen only when named, so a clock-out without a task keeps its bytes (#875).
			...namedTaskId(params?.taskId),
			workCategoryId: params?.workCategoryId,
			billable: params?.billable,
		});
		return prepared.ok ? prepared.request : null;
	}

	// Query for time clock status
	const statusQuery = useQuery({
		queryKey: queryKeys.timeClock.status(),
		queryFn: getTimeClockStatus,
		initialData: initialData ?? undefined,
		enabled,
		staleTime: 30 * 1000, // Consider fresh for 30 seconds
		refetchOnWindowFocus: true, // Refetch when user comes back to tab
	});

	const status = statusQuery.data;

	// Clock in mutation with offline support
	const clockInMutation = useMutation({
		networkMode: "always", // Local IndexedDB capture must run while TanStack is offline.
		mutationFn: async (params?: {
			workLocationType?: WorkLocationType;
			browserTimezone?: string | null;
			submissionId?: string;
		}) => {
			const refused = refuseWithoutConnection();
			if (refused) return refused;
			const event = await captureClockEvent(canFreeze || !isOffline);
			const frozen = prepareFrozenCommand("clock_in", params, event);
			if (frozen) return afterClockEvent(await submitClockCommand(frozen), event);

			// When offline, queue the event for later sync
			if (isOffline) {
				if (!activeOrganizationId) {
					return { success: false as const, error: "No active organization" };
				}

				const browserTimezone = resolveBrowserTimezone(params);
				const result = await queueClockEvent({
					type: "clock_in",
					timestamp: systemClock.nowInstant().epochMilliseconds,
					organizationId: activeOrganizationId,
					workLocationType: params?.workLocationType,
					browserTimezone,
				});

				if (result.success) {
					// Local retention is not an active server work period.
					return { success: true as const, queued: true, reviewRequired: true };
				}
				return {
					success: false as const,
					error: result.error || "Failed to queue clock event",
				};
			}

			// Online - use the route handler; server action IDs change per deployment
			const result = await postClockIn({
				workLocationType: params?.workLocationType,
				browserTimezone: resolveBrowserTimezone(params),
				// Named here if the connection returned after the request was prepared.
				submissionId: params?.submissionId ?? crypto.randomUUID(),
				...(event.position ? { position: event.position } : {}),
			});
			return afterClockEvent(result, event);
		},
		onSuccess: (result) => {
			if (result.success && !("queued" in result)) {
				// Only invalidate for non-queued success (server confirmed)
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employeeClockStatuses.all,
				});
				// A live day total in the calendar must stop or start with this clocking.
				queryClient.invalidateQueries({
					queryKey: queryKeys.calendar.allEvents,
				});
				if (status?.employeeId) {
					void queryClient.invalidateQueries({
						queryKey: queryKeys.workPolicies.presence.status(status.employeeId),
					});
				}
			}
		},
	});

	// Clock out mutation with offline support
	const clockOutMutation = useMutation({
		networkMode: "always",
		mutationFn: async (params?: {
			projectId?: string;
			/**
			 * A task of the project (#874). Frozen commands and the route carry it; the
			 * legacy offline queue does not, so the page offers no task in that mode.
			 * Omitted, the task follows the project; null clears it.
			 */
			taskId?: string | null;
			workCategoryId?: string;
			billable?: boolean;
			browserTimezone?: string | null;
			submissionId?: string;
		}) => {
			const refused = refuseWithoutConnection();
			if (refused) return refused;
			const event = await captureClockEvent(canFreeze || !isOffline);
			const frozen = prepareFrozenCommand("clock_out", params, event);
			if (frozen) return afterClockEvent(await submitClockCommand(frozen), event);

			// When offline, queue the event for later sync
			if (isOffline) {
				if (!activeOrganizationId) {
					return { success: false as const, error: "No active organization" };
				}

				const browserTimezone = resolveBrowserTimezone(params);
				const result = await queueClockEvent({
					type: "clock_out",
					timestamp: systemClock.nowInstant().epochMilliseconds,
					organizationId: activeOrganizationId,
					projectId: params?.projectId,
					workCategoryId: params?.workCategoryId,
					browserTimezone,
				});

				if (result.success) {
					return { success: true as const, queued: true, reviewRequired: true };
				}
				return {
					success: false as const,
					error: result.error || "Failed to queue clock event",
				};
			}

			// Online - use the route handler; server action IDs change per deployment
			const result = await postClockOut({
				projectId: params?.projectId,
				...namedTaskId(params?.taskId),
				workCategoryId: params?.workCategoryId,
				...(params?.billable === undefined ? {} : { billable: params.billable }),
				browserTimezone: resolveBrowserTimezone(params),
				submissionId: params?.submissionId as string,
				...(event.position ? { position: event.position } : {}),
			});
			return afterClockEvent(result, event);
		},
		onSuccess: (result) => {
			if (result.success && !("queued" in result)) {
				// Only invalidate for non-queued success (server confirmed)
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employeeClockStatuses.all,
				});
				// A live day total in the calendar must stop or start with this clocking.
				queryClient.invalidateQueries({
					queryKey: queryKeys.calendar.allEvents,
				});
				if (status?.employeeId) {
					void queryClient.invalidateQueries({
						queryKey: queryKeys.workPolicies.presence.status(status.employeeId),
					});
				}
			}
		},
	});

	// Update notes mutation (online only - notes are secondary)
	const updateNotesMutation = useMutation({
		mutationFn: ({ entryId, notes }: { entryId: string; notes: string }) =>
			updateTimeEntryNotes(entryId, notes),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
			}
		},
	});

	// Add break mutation (online only - break changes must be confirmed immediately)
	const addBreakMutation = useMutation({
		mutationFn: async ({
			breakMinutes,
			submissionId,
		}: {
			breakMinutes: number;
			submissionId: string;
		}) => {
			const refused = refuseWithoutConnection();
			if (refused) return refused;
			if (isOffline) {
				return {
					success: false as const,
					error: "Adding a break requires an internet connection.",
				};
			}

			// The one fix is taken at the break's end and stamps the resumed work (#826).
			const event = await captureClockEvent(true);
			const result = await addBreakToActiveSession(breakMinutes, {
				submissionId,
				browserTimezone: getBrowserTimezone(),
				...(event.position ? { position: event.position } : {}),
			});
			return afterClockEvent(result, event);
		},
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.breakStatus(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employeeClockStatuses.all,
				});
				// A live day total in the calendar must stop or start with this clocking.
				queryClient.invalidateQueries({
					queryKey: queryKeys.calendar.allEvents,
				});
			}
		},
	});

	// Refetch status manually
	const refetchStatus = () => {
		return queryClient.invalidateQueries({
			queryKey: queryKeys.timeClock.status(),
		});
	};

	return {
		// Status
		status,
		isLoading: statusQuery.isLoading,
		isFetching: statusQuery.isFetching,
		isError: statusQuery.isError,

		...clockStatusView(status),
		// Offline state
		isOnline,
		isOffline,
		captureMode: clockCaptureMode(isOffline, canFreeze, canCaptureOffline),
		/** The last clock action needs a connection in this organization (#845); shown inline. */
		connectionRequired: isOffline && connectionRefused,
		pendingCount,
		isSyncing,

		// Mutations
		clockIn: (params?: { workLocationType?: WorkLocationType; browserTimezone?: string | null }) =>
			// One identity per request, as for clock-out; the server replays a committed identity.
			clockInMutation.mutateAsync({
				...(params ?? {}),
				...(!isOffline ? { submissionId: crypto.randomUUID() } : {}),
			}),
		clockOut: (params?: {
			projectId?: string;
			taskId?: string | null;
			workCategoryId?: string;
			billable?: boolean;
			browserTimezone?: string | null;
		}) =>
			clockOutMutation.mutateAsync({
				...(params ?? {}),
				...(!isOffline ? { submissionId: crypto.randomUUID() } : {}),
			}),
		// One identity per request, as for clock-out; the server replays a committed identity.
		addBreak: (params: { breakMinutes: number }) =>
			addBreakMutation.mutateAsync({ ...params, submissionId: crypto.randomUUID() }),
		updateNotes: updateNotesMutation.mutateAsync,
		isClockingIn: clockInMutation.isPending,
		isClockingOut: clockOutMutation.isPending,
		isAddingBreak: addBreakMutation.isPending,
		isUpdatingNotes: updateNotesMutation.isPending,
		isMutating:
			clockInMutation.isPending ||
			clockOutMutation.isPending ||
			addBreakMutation.isPending ||
			updateNotesMutation.isPending,

		// Utilities
		refetchStatus,
	};
}

function clockStatusView(status: TimeClockState | undefined) {
	return {
		hasEmployee: status?.hasEmployee ?? false,
		employeeId: status?.employeeId ?? null,
		isClockedIn: status?.isClockedIn ?? false,
		activeWorkPeriod: status?.activeWorkPeriod ?? null,
	};
}

/** Offline in an organization that is not adopted, the normal controls refuse each action (#845). */
function clockCaptureMode(isOffline: boolean, canFreeze: boolean, canCaptureOffline: boolean) {
	if (!isOffline || !canCaptureOffline) return "server" as const;
	return canFreeze ? ("local-queue" as const) : ("local-review" as const);
}
