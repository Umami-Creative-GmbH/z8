"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import {
	addBreakToActiveSession,
	getTimeClockStatus,
	resumeBreakInProgress,
	startBreakInProgress,
	updateTimeEntryNotes,
} from "@/app/[locale]/(app)/time-tracking/actions";
import type { PositionConsentQuestion } from "@/components/position-capture/position-consent-prompt";
import { useOfflineClock } from "@/hooks/use-offline-clock";
import { useSession } from "@/lib/auth-client";
import { type Instant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { serializeInstant } from "@/lib/datetime/temporal-wire";
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
import type {
	BreakVehicleUse,
	ClockVehicleUse,
} from "@/lib/time-tracking/vehicle-use/clock-vehicle-use";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import { queryKeys } from "./keys";
import { invalidatePeriodSubmissionReadiness } from "./period-submission-readiness";

export interface TimeClockState {
	hasEmployee: boolean;
	employeeId: string | null;
	isClockedIn: boolean;
	/** `currentTask`: the running work's task (#874), absent from older status sources. */
	activeWorkPeriod: {
		id: string;
		startTime: Date;
		currentTask?: BookedProjectTask | null;
		/** An open break in progress (#861), read-only on the web. */
		breakStartedAt?: Date | null;
		breakStartedZone?: string | null;
	} | null;
}

/**
 * A Start Break or Resume (#888). `uncertain`: the answer was lost or unconfirmed,
 * so the break may be recorded; the clock refreshes and a retry replays. Codes the
 * clock itself answers: `connection_required`, `pending_clock_actions`,
 * `not_clocked_in`, `already_on_break`, `no_break_in_progress`.
 */
export type BreakInProgressClientResult =
	| { success: true; data: { workPeriodId: string; at: string } }
	| { success: false; code: string; error?: string; uncertain?: true };

/** Codes after which the same attempt may be sent again under its identity. */
const RETRYABLE_BREAK_CODES = new Set(["unconfirmed", "failed"]);

type BreakCommandState = {
	attempt: { target: string; id: string } | null;
	inFlight: Promise<BreakInProgressClientResult> | null;
};

/** One break attempt per page, shared by the full clock and the compact one (#888). */
const breakCommandStates = new WeakMap<QueryClient, BreakCommandState>();

function breakCommandState(client: QueryClient): BreakCommandState {
	let state = breakCommandStates.get(client);
	if (!state) {
		state = { attempt: null, inFlight: null };
		breakCommandStates.set(client, state);
	}
	return state;
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
	/** Vehicle use at this event (#1122). */
	vehicleUse?: ClockVehicleUse;
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
		waitingCount,
		isSyncing,
		queueClockEvent,
		commandCapabilities,
		workerCommandVersions,
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
	// The last clock command was refused for needing a connection; shown inline while offline.
	const [connectionRefused, setConnectionRefused] = useState(false);
	const clockPosition = useClockPosition(Boolean(session?.user?.id && activeOrganizationId));

	/**
	 * Refuses a clock command up front while offline in an organization that is not
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
		const session = pageSession;
		const operationId = crypto.randomUUID();
		const prepare = (vehicleUse: ClockVehicleUse | undefined) =>
			prepareBrowserClockCommand({
				kind,
				operationId,
				capabilities: commandCapabilities,
				session,
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
				vehicleUse,
				workerCommandVersions,
			});
		let prepared = prepare(params?.vehicleUse);
		let vehicleUseLeftOut = false;
		if (!prepared.ok && prepared.reason === "vehicle_use_unsupported") {
			// Online, the route carries vehicle use, so the request keeps it (#1122).
			if (!isOffline) return null;
			// Offline the event never waits: it is frozen without vehicle use, which the
			// employee can still add to the work period later; the clock says so.
			prepared = prepare(undefined);
			vehicleUseLeftOut = true;
		}
		return prepared.ok ? { request: prepared.request, vehicleUseLeftOut } : null;
	}

	/** An accepted event that could not carry the entered vehicle use says so (#1122). */
	function withVehicleUseLeftOut<T extends { success: boolean }>(
		result: T,
		leftOut: boolean,
	): T & { vehicleUseLeftOut?: true } {
		return leftOut && result.success ? { ...result, vehicleUseLeftOut: true as const } : result;
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
			/** Vehicle and start reading (#1122); never held for or refused over. */
			vehicleUse?: ClockVehicleUse;
		}) => {
			const refused = refuseWithoutConnection();
			if (refused) return refused;
			const event = await captureClockEvent(canFreeze || !isOffline);
			const frozen = prepareFrozenCommand("clock_in", params, event);
			if (frozen) {
				const submitted = await submitClockCommand(frozen.request);
				return afterClockEvent(withVehicleUseLeftOut(submitted, frozen.vehicleUseLeftOut), event);
			}

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
				...(params?.vehicleUse ? { vehicleUse: params.vehicleUse } : {}),
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
				// Live work keeps its submission period open (#1350).
				void invalidatePeriodSubmissionReadiness(queryClient);
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
			/** End reading or distance (#1122); never held for or refused over. */
			vehicleUse?: ClockVehicleUse;
		}) => {
			const refused = refuseWithoutConnection();
			if (refused) return refused;
			const event = await captureClockEvent(canFreeze || !isOffline);
			const frozen = prepareFrozenCommand("clock_out", params, event);
			if (frozen) {
				const submitted = await submitClockCommand(frozen.request);
				return afterClockEvent(withVehicleUseLeftOut(submitted, frozen.vehicleUseLeftOut), event);
			}

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
				...(params?.vehicleUse ? { vehicleUse: params.vehicleUse } : {}),
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
				// Live work keeps its submission period open (#1350).
				void invalidatePeriodSubmissionReadiness(queryClient);
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
			vehicleUse,
		}: {
			breakMinutes: number;
			submissionId: string;
			/** The break's one odometer reading (#1122). */
			vehicleUse?: BreakVehicleUse;
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
				...(vehicleUse ? { vehicleUse } : {}),
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
				// Live work keeps its submission period open (#1350).
				void invalidatePeriodSubmissionReadiness(queryClient);
			}
		},
	});

	/**
	 * A break in progress started or resumed from this clock (#888, Time Tracking
	 * ADR 0007): online only, on the confirmed server state shown, one request at a
	 * time across the page's clock surfaces. An attempt keeps its identity until its
	 * outcome is known, so a retry after an uncertain answer replays instead of
	 * acting twice. Every answer refreshes the clock, which is how a refusal or a
	 * lost answer reconciles.
	 */
	const breakCommands = breakCommandState(queryClient);
	const liveWork = status?.isClockedIn ? status.activeWorkPeriod : null;

	function refreshAfterBreakCommand(confirmed: boolean) {
		void queryClient.invalidateQueries({ queryKey: queryKeys.timeClock.status() });
		if (!confirmed) return;
		void queryClient.invalidateQueries({ queryKey: queryKeys.timeClock.breakStatus() });
		void queryClient.invalidateQueries({ queryKey: queryKeys.employeeClockStatuses.all });
		// The interrupted work keeps counting until the break ends (ADR 0007).
		void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.allEvents });
		void invalidatePeriodSubmissionReadiness(queryClient);
	}

	/** `target` names what the attempt acts on; another target is another attempt. */
	async function sendBreakCommand(
		target: string,
		send: (submissionId: string) => Promise<BreakInProgressClientResult>,
	): Promise<BreakInProgressClientResult> {
		if (breakCommands.attempt?.target !== target) {
			breakCommands.attempt = { target, id: crypto.randomUUID() };
		}
		const attempt = breakCommands.attempt;
		let result: BreakInProgressClientResult;
		try {
			result = await send(attempt.id);
		} catch {
			// The answer was lost: the break may or may not be recorded.
			result = { success: false, code: "unconfirmed" };
		}
		const settled = result.success || !RETRYABLE_BREAK_CODES.has(result.code);
		if (settled && breakCommands.attempt === attempt) breakCommands.attempt = null;
		refreshAfterBreakCommand(result.success);
		if (!result.success && result.code === "unconfirmed") return { ...result, uncertain: true };
		return result;
	}

	function breakCommandRefusal(): BreakInProgressClientResult | null {
		if (isOffline) return { success: false, code: "connection_required" };
		// A frozen clock action still being sent may change the work this command
		// acts on. Records held for review change nothing on their own.
		if (waitingCount > 0 || isSyncing) {
			return { success: false, code: "pending_clock_actions" };
		}
		return null;
	}

	async function startBreakInProgressCommand(): Promise<BreakInProgressClientResult> {
		const refused = breakCommandRefusal();
		if (refused) return refused;
		const live = liveWork;
		if (!live) return { success: false, code: "not_clocked_in" };
		if (live.breakStartedAt) return { success: false, code: "already_on_break" };
		return sendBreakCommand(`start:${live.id}`, (submissionId) =>
			startBreakInProgress({
				submissionId,
				workPeriodId: live.id,
				browserTimezone: getBrowserTimezone(),
			}),
		);
	}

	async function resumeBreakInProgressCommand(): Promise<BreakInProgressClientResult> {
		const refused = breakCommandRefusal();
		if (refused) return refused;
		const live = liveWork;
		if (!live?.breakStartedAt) return { success: false, code: "no_break_in_progress" };
		const breakStart = serializeInstant(instantFromDate(new Date(live.breakStartedAt)));
		return sendBreakCommand(`resume:${live.id}:${breakStart}`, async (submissionId) => {
			// The one fix is taken where the work resumes and stamps the resumed work (#826).
			const event = await captureClockEvent(true);
			const result = await resumeBreakInProgress({
				submissionId,
				workPeriodId: live.id,
				breakStart,
				browserTimezone: getBrowserTimezone(),
				...(event.position ? { position: event.position } : {}),
			});
			return afterClockEvent(result, event);
		});
	}

	/** Clicks sent together, from either clock surface, share the one request in flight. */
	function serializedBreakCommand(run: () => Promise<BreakInProgressClientResult>) {
		if (breakCommands.inFlight) return breakCommands.inFlight;
		const pending = run().finally(() => {
			breakCommands.inFlight = null;
		});
		breakCommands.inFlight = pending;
		return pending;
	}

	const startBreakMutation = useMutation({
		networkMode: "always",
		mutationFn: startBreakInProgressCommand,
	});
	const resumeBreakMutation = useMutation({
		networkMode: "always",
		mutationFn: resumeBreakInProgressCommand,
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
		/** The last clock command needs a connection in this organization (#845); shown inline. */
		connectionRequired: isOffline && connectionRefused,
		pendingCount,
		isSyncing,

		// Mutations
		clockIn: (params?: {
			workLocationType?: WorkLocationType;
			browserTimezone?: string | null;
			vehicleUse?: ClockVehicleUse;
		}) =>
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
			vehicleUse?: ClockVehicleUse;
		}) =>
			clockOutMutation.mutateAsync({
				...(params ?? {}),
				...(!isOffline ? { submissionId: crypto.randomUUID() } : {}),
			}),
		// One identity per request, as for clock-out; the server replays a committed identity.
		addBreak: (params: { breakMinutes: number; vehicleUse?: BreakVehicleUse }) =>
			addBreakMutation.mutateAsync({ ...params, submissionId: crypto.randomUUID() }),
		/** Starts a break in progress on the work shown (#888); online only. */
		startBreak: () => serializedBreakCommand(() => startBreakMutation.mutateAsync()),
		/** Resumes the break in progress shown at its recorded start (#888); online only. */
		resumeBreak: () => serializedBreakCommand(() => resumeBreakMutation.mutateAsync()),
		updateNotes: updateNotesMutation.mutateAsync,
		isClockingIn: clockInMutation.isPending,
		isClockingOut: clockOutMutation.isPending,
		isAddingBreak: addBreakMutation.isPending,
		isStartingBreak: startBreakMutation.isPending,
		isResumingBreak: resumeBreakMutation.isPending,
		isUpdatingNotes: updateNotesMutation.isPending,
		isMutating:
			clockInMutation.isPending ||
			clockOutMutation.isPending ||
			addBreakMutation.isPending ||
			startBreakMutation.isPending ||
			resumeBreakMutation.isPending ||
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
