"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import type {
	ClientToSWMessage,
	OfflineQueueStatus,
	OfflineRecoveryContext,
	OfflineRecoveryRecord,
	QueuedClockEvent,
	SWToClientMessage,
} from "@/lib/offline/types";
import { queryKeys } from "@/lib/query/keys";
import { useOnlineStatus } from "./use-online-status";

async function sendMessageToSW<T>(message: ClientToSWMessage): Promise<T> {
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
		}, 10000);
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
	savedCount: 0,
	countVerified: false,
	isSyncing: false,
	lastSyncAt: null,
	lastError: null,
};

const offlineStatusKey = (contextKey: string) =>
	["offline-clock-status", contextKey] as const;

export function useOfflineClock() {
	const isOnline = useOnlineStatus();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const userId = session?.user.id;
	const organizationId = session?.session.activeOrganizationId;
	const contextKey = JSON.stringify([userId, organizationId]);
	const [swReady, setSwReady] = useState(false);
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
					savedCount: number;
				}>({
					type: "GET_QUEUE_COUNT",
					context: { userId, organizationId },
				});
				update({
					pendingCount: response.count,
					reviewCount: response.reviewCount,
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
		const connect = async () => {
			try {
				await navigator.serviceWorker.register("/sw.js", {
					scope: "/",
					updateViaCache: "none",
				});
				const version = await sendMessageToSW<{ clockQueueMode?: string }>({
					type: "GET_VERSION",
				});
				const ready = version.clockQueueMode === "preservation-only-v1";
				if (mounted) setSwReady(ready);
				if (!ready) {
					update({
						lastError:
							"Update Z8 before saving offline clock records. The current worker does not support recovery preservation.",
					});
					return;
				}
				await refresh();
			} catch (error) {
				update({
					lastError:
						error instanceof Error
							? error.message
							: "Clock recovery unavailable",
				});
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

	const triggerSync = async () => {
		if (!swReady || !isOnline) return;
		try {
			updateStatus({ lastError: null });
			// Classification retries do not submit retained work or reset attempts.
			await sendMessageToSW({ type: "TRIGGER_SYNC" });
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
		isOnline,
		isOffline: !isOnline,
		queueClockEvent,
		triggerSync,
		readRecoveryRecords,
		archiveRecoveryRecord,
	};
}
