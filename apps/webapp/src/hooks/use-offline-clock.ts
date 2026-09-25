"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import type {
	ClientToSWMessage,
	ClockCommandCaptureReply,
	ClockCommandDispatchReply,
	OfflineQueueStatus,
	OfflineRecoveryContext,
	OfflineRecoveryRecord,
	QueuedClockEvent,
	SWToClientMessage,
} from "@/lib/offline/types";
import { queryKeys } from "@/lib/query/keys";
import {
	type BrowserClockActionResult,
	type BrowserClockCommandCapabilities,
	type ClockCommandCaptureRequest,
	toBrowserClockActionResult,
} from "@/lib/time-tracking/browser-clock-command";
import { useOnlineStatus } from "./use-online-status";

/** Reported by a worker that stores and sends frozen v2 clock commands (#279). */
const FROZEN_COMMAND_MODE = "frozen-v2";
/** Capture, then one attended send: long enough for a slow request, then "pending". */
const DISPATCH_REPLY_TIMEOUT_MS = 45_000;
const COMMANDS_API = "/api/time-entries/commands";

async function sendMessageToSW<T>(
	message: ClientToSWMessage,
	timeoutMs = 10000,
): Promise<T> {
	const controller =
		navigator.serviceWorker.controller ??
		(await navigator.serviceWorker.ready).active;
	if (!controller) throw new Error("No active service worker");
	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		const timeoutId = setTimeout(() => {
			channel.port1.close();
			reject(
				new Error(
					"Worker acknowledgment unavailable. A save may have completed; review saved records before trying again.",
				),
			);
		}, timeoutMs);
		channel.port1.onmessage = (event) => {
			clearTimeout(timeoutId);
			channel.port1.close();
			if (event.data.error) reject(new Error(event.data.error));
			else resolve(event.data);
		};
		try {
			controller.postMessage(message, [channel.port2]);
		} catch (error) {
			clearTimeout(timeoutId);
			channel.port1.close();
			reject(error);
		}
	});
}

const EMPTY_STATUS: OfflineQueueStatus = {
	pendingCount: 0,
	reviewCount: 0,
	waitingCount: 0,
	savedCount: 0,
	countVerified: false,
	isSyncing: false,
	lastSyncAt: null,
	lastError: null,
};

const offlineStatusKey = (contextKey: string) =>
	["offline-clock-status", contextKey] as const;

const CAPTURE_ERRORS: Record<string, string> = {
	clock_in_pending:
		"An earlier clock-in on this device is not confirmed yet. Review saved records first.",
	clock_out_pending:
		"A clock-out for this work period is already saved on this device.",
	no_target:
		"No active work period is known on this device. Connect to refresh your clock status.",
};

/** Server-derived capabilities; `null` when this session cannot use them. */
async function readCommandCapabilities(): Promise<BrowserClockCommandCapabilities | null> {
	const response = await fetch(COMMANDS_API, { cache: "no-store" });
	if (!response.ok) return null;
	return (await response.json()) as BrowserClockCommandCapabilities;
}

export function useOfflineClock() {
	const isOnline = useOnlineStatus();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const userId = session?.user.id;
	const organizationId = session?.session.activeOrganizationId;
	const contextKey = JSON.stringify([userId, organizationId]);
	const [swReady, setSwReady] = useState(false);
	const [commandsReady, setCommandsReady] = useState(false);
	// One scoped UI snapshot for the banner and every clock caller. IndexedDB
	// remains the evidence owner; online recovery reads refresh this cache.
	const { data: status } = useQuery({
		queryKey: offlineStatusKey(contextKey),
		queryFn: async () => EMPTY_STATUS,
		initialData: EMPTY_STATUS,
		// Without an explicit timestamp react-query stamps initialData with
		// Date.now(), which Next.js rejects while prerendering static routes.
		initialDataUpdatedAt: 0,
		enabled: false,
	});
	const context: OfflineRecoveryContext | null =
		userId && organizationId ? { userId, organizationId } : null;
	// Kept after going offline, so an offline action can still be frozen for the
	// session it was read for. The page checks it against the session each time.
	const { data: commandCapabilities } = useQuery({
		queryKey: ["clock-command-capabilities", contextKey] as const,
		queryFn: readCommandCapabilities,
		enabled: isOnline && commandsReady && Boolean(userId && organizationId),
		staleTime: 60_000,
		retry: false,
	});

	function updateStatus(patch: Partial<OfflineQueueStatus>) {
		queryClient.setQueryData<OfflineQueueStatus>(
			offlineStatusKey(contextKey),
			(old) => ({ ...(old ?? EMPTY_STATUS), ...patch }),
		);
	}

	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;
		let mounted = true;
		const update = (patch: Partial<OfflineQueueStatus>) => {
			if (mounted)
				queryClient.setQueryData<OfflineQueueStatus>(
					offlineStatusKey(contextKey),
					(old) => ({ ...(old ?? EMPTY_STATUS), ...patch }),
				);
		};
		const refresh = async () => {
			if (!isOnline || !userId || !organizationId) return;
			try {
				const response = await sendMessageToSW<{
					count: number;
					reviewCount: number;
					waitingCount?: number;
					savedCount: number;
				}>({
					type: "GET_QUEUE_COUNT",
					context: { userId, organizationId },
				});
				update({
					pendingCount: response.count,
					reviewCount: response.reviewCount,
					waitingCount: response.waitingCount ?? 0,
					savedCount: response.savedCount,
					countVerified: true,
				});
			} catch (error) {
				update({
					lastError:
						error instanceof Error
							? error.message
							: "Clock recovery status unavailable",
				});
			}
		};
		// Worker availability is account recovery status. Signed-out pages (login)
		// have no evidence to protect, so a failure there must not block the UI.
		const reportWorkerFailure = (lastError: string) => {
			if (userId && organizationId) update({ lastError });
			else console.warn("[OfflineClock]", lastError);
		};
		const connect = async () => {
			try {
				await navigator.serviceWorker.register("/sw.js", {
					scope: "/",
					updateViaCache: "none",
				});
				const version = await sendMessageToSW<{
					clockQueueMode?: string;
					clockCommandMode?: string;
				}>({
					type: "GET_VERSION",
				});
				const ready = version.clockQueueMode === "preservation-only-v1";
				const frozen = ready && version.clockCommandMode === FROZEN_COMMAND_MODE;
				if (mounted) {
					setSwReady(ready);
					setCommandsReady(frozen);
				}
				if (!ready) {
					reportWorkerFailure(
						"Update Z8 before saving offline clock records. The current worker does not support recovery preservation.",
					);
					return;
				}
				await refresh();
				// Reconnect or reload: let the worker send what it holds. The run is
				// serialized in the worker and reads nothing remote when nothing waits.
				if (frozen && isOnline && userId && organizationId) {
					await sendMessageToSW({ type: "TRIGGER_SYNC" });
				}
			} catch (error) {
				reportWorkerFailure(
					error instanceof Error ? error.message : "Clock recovery unavailable",
				);
			}
		};
		const handleMessage = (event: MessageEvent<SWToClientMessage>) => {
			if (!mounted || event.source !== navigator.serviceWorker.controller)
				return;
			switch (event.data.type) {
				case "QUEUE_UPDATED":
					void refresh();
					break;
				case "SYNC_STARTED":
					update({ isSyncing: true });
					break;
				case "SYNC_COMPLETED":
					update({ isSyncing: false });
					void refresh();
					break;
				case "SYNC_SUCCESS":
					// Scoped commitment is separate from the subsequent current-state read.
					if (
						event.data.userId !== userId ||
						event.data.organizationId !== organizationId
					)
						break;
					update({ lastSyncAt: Date.now() });
					void Promise.all([
						queryClient.invalidateQueries(
							{ queryKey: queryKeys.timeClock.status() },
							{ throwOnError: true },
						),
						queryClient.invalidateQueries(
							{ queryKey: queryKeys.timeClock.breakStatus() },
							{ throwOnError: true },
						),
						queryClient.invalidateQueries(
							{ queryKey: queryKeys.employeeClockStatuses.all },
							{ throwOnError: true },
						),
					]).catch(() =>
						update({
							lastError:
								"Clock event committed. Current clock status could not be refreshed; refresh status before another action.",
						}),
					);
					break;
				case "SYNC_ERROR":
					update({ lastError: event.data.error });
					break;
			}
		};
		void connect();
		navigator.serviceWorker.addEventListener("message", handleMessage);
		navigator.serviceWorker.addEventListener("controllerchange", connect);
		return () => {
			mounted = false;
			navigator.serviceWorker.removeEventListener("message", handleMessage);
			navigator.serviceWorker.removeEventListener("controllerchange", connect);
		};
	}, [contextKey, isOnline, organizationId, queryClient, userId]);

	const queueClockEvent = async (
		event: Omit<QueuedClockEvent, "id" | "retryCount" | "createdAt">,
	) => {
		if (!swReady || !context)
			return {
				success: false,
				error: "Clock recovery is not ready for this account",
			};
		try {
			// Confirm the *controlling* worker before each capture, including upgrades.
			const version = await sendMessageToSW<{ clockQueueMode?: string }>({
				type: "GET_VERSION",
			});
			if (version.clockQueueMode !== "preservation-only-v1") {
				const error = "Update Z8 before saving offline clock records";
				updateStatus({ lastError: error });
				return { success: false, error };
			}
			const response = await sendMessageToSW<{
				success: boolean;
				eventId?: string;
				reviewRequired?: boolean;
				error?: string;
			}>({
				type: "QUEUE_CLOCK_EVENT",
				payload: {
					...event,
					userId: context.userId,
					serverOrigin: window.location.origin,
				},
			});
			if (response.success)
				queryClient.setQueryData<OfflineQueueStatus>(
					offlineStatusKey(contextKey),
					(old) => ({
						...(old ?? EMPTY_STATUS),
						pendingCount: (old?.pendingCount ?? 0) + 1,
						reviewCount: (old?.reviewCount ?? 0) + 1,
						savedCount: (old?.savedCount ?? 0) + 1,
					}),
				);
			return response;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Could not save clock recovery evidence";
			updateStatus({ lastError: message });
			return { success: false, error: message };
		}
	};

	/**
	 * Freeze one clock command in the worker's store, then ask the worker to send
	 * it now. A failed save is a failure; everything after a save is at worst
	 * "saved, not confirmed", never a failed clock action.
	 */
	const submitClockCommand = async (
		request: ClockCommandCaptureRequest,
	): Promise<BrowserClockActionResult> => {
		let capture: ClockCommandCaptureReply;
		try {
			capture = await sendMessageToSW<ClockCommandCaptureReply>({
				type: "CAPTURE_CLOCK_COMMAND",
				payload: request,
			});
		} catch {
			const error =
				"Could not confirm that the clock action was saved on this device. Review saved records before trying again.";
			updateStatus({ lastError: error });
			return { success: false, code: "capture_unconfirmed", error };
		}
		if (!capture.success) {
			return {
				success: false,
				code: capture.code,
				error:
					CAPTURE_ERRORS[capture.code] ??
					"Could not save the clock action on this device. Nothing was sent.",
			};
		}
		queryClient.setQueryData<OfflineQueueStatus>(
			offlineStatusKey(contextKey),
			(old) => ({
				...(old ?? EMPTY_STATUS),
				pendingCount: (old?.pendingCount ?? 0) + 1,
				waitingCount: (old?.waitingCount ?? 0) + 1,
			}),
		);
		const dispatch = await sendMessageToSW<ClockCommandDispatchReply>(
			{ type: "DISPATCH_CLOCK_COMMANDS", operationId: request.operationId },
			DISPATCH_REPLY_TIMEOUT_MS,
		).catch(() => null);
		return toBrowserClockActionResult(dispatch?.success ? dispatch.record : null);
	};

	const triggerSync = async () => {
		if (!swReady || !isOnline) return;
		try {
			updateStatus({ lastError: null });
			// An explicit request also resumes commands whose automatic retries stopped.
			await sendMessageToSW({ type: "TRIGGER_SYNC", retryExhausted: true });
		} catch (error) {
			updateStatus({
				isSyncing: false,
				lastError:
					error instanceof Error ? error.message : "Recovery refresh failed",
			});
		}
	};

	const readRecoveryRecords = async () => {
		if (!context || !isOnline || !swReady)
			throw new Error("Connect and sign in to review saved clock records");
		const response = await sendMessageToSW<{
			records: OfflineRecoveryRecord[];
		}>({ type: "GET_QUEUE_RECORDS", context });
		return response.records;
	};
	const archiveRecoveryRecord = async (eventId: string) => {
		if (!context || !isOnline || !swReady)
			throw new Error("Connect and sign in to archive saved clock records");
		const response = await sendMessageToSW<{
			records: OfflineRecoveryRecord[];
		}>({ type: "ARCHIVE_QUEUE_RECORD", eventId, context });
		return response.records;
	};

	return {
		...status,
		status,
		contextKey,
		swReady,
		commandsReady,
		commandCapabilities: commandsReady ? (commandCapabilities ?? null) : null,
		isOnline,
		isOffline: !isOnline,
		queueClockEvent,
		submitClockCommand,
		triggerSync,
		readRecoveryRecords,
		archiveRecoveryRecord,
	};
}
