import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, NetworkError, AuthError } from "@/lib/api";
import { storage, type LastAction } from "@/lib/storage";
import type { ClockStatus } from "@/types";

type OptimisticState = { isClockedIn: boolean; startTime: string | null };

function optimisticStateToStatus(optimisticState: OptimisticState): ClockStatus {
  return {
    hasEmployee: true,
    employeeId: null,
    isClockedIn: optimisticState.isClockedIn,
    activeWorkPeriod: optimisticState.startTime
      ? { id: "offline", startTime: optimisticState.startTime }
      : null,
  };
}

export function useClock() {
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [queueLength, setQueueLength] = useState(0);
  const [lastAction, setLastActionState] = useState<LastAction | null>(null);

  useEffect(() => {
    let isMounted = true;

    storage.getLastAction().then((storedLastAction) => {
      if (isMounted) {
        setLastActionState(storedLastAction);
      }
    });

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !("lastAction" in changes)) {
        return;
      }

      setLastActionState((changes.lastAction.newValue as LastAction | undefined) ?? null);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      isMounted = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Check queue length periodically - only update if changed
  useEffect(() => {
    let currentLength = 0;
    const checkQueue = async () => {
      const queue = await storage.getQueuedActions();
      if (queue.length !== currentLength) {
        currentLength = queue.length;
        setQueueLength(queue.length);
      }
    };
    checkQueue();
    const interval = setInterval(checkQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  const notifyBackgroundScript = (type: string = "CLOCK_STATUS_CHANGED") => {
    chrome.runtime.sendMessage({ type }, () => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to notify background script:", chrome.runtime.lastError.message);
      }
    });
  };

  const storeLastAction = async (action: LastAction) => {
    await storage.setLastAction(action);
    setLastActionState(action);
  };

  const queueClockIn = async (timestamp: string) => {
    const optimisticState = { isClockedIn: true, startTime: timestamp };
    await storage.addToQueue({ type: "clock_in", timestamp });
    await storage.setOptimisticState(optimisticState);
    await storeLastAction({ type: "clock_in", timestamp, syncState: "queued" });
    queryClient.setQueryData(["clock-status"], optimisticStateToStatus(optimisticState));
    return { entry: { id: "queued", type: "clock_in" as const, timestamp, employeeId: "" } };
  };

  const queueClockOut = async (projectId: string | undefined, timestamp: string) => {
    const optimisticState = { isClockedIn: false, startTime: null };
    await storage.addToQueue({ type: "clock_out", projectId, timestamp });
    await storage.setOptimisticState(optimisticState);
    await storeLastAction({ type: "clock_out", timestamp, syncState: "queued" });
    queryClient.setQueryData(["clock-status"], optimisticStateToStatus(optimisticState));
    return { entry: { id: "queued", type: "clock_out" as const, timestamp, employeeId: "" } };
  };

  const statusQuery = useQuery({
    queryKey: ["clock-status"],
    queryFn: async () => {
      // If offline, try to get optimistic state
      if (!navigator.onLine) {
        const optimisticState = await storage.getOptimisticState();
        if (optimisticState) {
          return optimisticStateToStatus(optimisticState);
        }
        throw new NetworkError("You are offline");
      }

      const [queue, optimisticState] = await Promise.all([
        storage.getQueuedActions(),
        storage.getOptimisticState(),
      ]);
      if (queue.length > 0 && optimisticState) {
        return optimisticStateToStatus(optimisticState);
      }

      try {
        return await api.getClockStatus();
      } catch (error) {
        if (error instanceof NetworkError) {
          const optimisticState = await storage.getOptimisticState();
          if (optimisticState) {
            return optimisticStateToStatus(optimisticState);
          }
        }
        throw error;
      }
    },
    refetchInterval: isOffline ? false : 30000,
    retry: (failureCount, error) => {
      if (error instanceof AuthError) return false;
      if (error instanceof NetworkError) return false;
      return failureCount < 2;
    },
  });

  const clockInMutation = useMutation({
    mutationFn: async () => {
      const timestamp = new Date().toISOString();

      if (!navigator.onLine) {
        return queueClockIn(timestamp);
      }

      const result = await api.clockIn();
      await storeLastAction({ type: "clock_in", timestamp, syncState: "synced" });

      // Show notification
      chrome.runtime.sendMessage({
        type: "SHOW_NOTIFICATION",
        notificationType: "clock_in",
      });

      return result;
    },
    onSuccess: (data) => {
      if (data.entry.id !== "queued") {
        queryClient.invalidateQueries({ queryKey: ["clock-status"] });
      }
      notifyBackgroundScript();
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (projectId?: string) => {
      const timestamp = new Date().toISOString();

      if (!navigator.onLine) {
        return queueClockOut(projectId, timestamp);
      }

      const result = await api.clockOut(projectId);
      await storeLastAction({ type: "clock_out", timestamp, syncState: "synced" });

      // Show notification
      chrome.runtime.sendMessage({
        type: "SHOW_NOTIFICATION",
        notificationType: "clock_out",
      });

      return result;
    },
    onSuccess: (data) => {
      if (data.entry.id !== "queued") {
        queryClient.invalidateQueries({ queryKey: ["clock-status"] });
      }
      notifyBackgroundScript();
    },
  });

  const isNotAuthenticated =
    statusQuery.isError && statusQuery.error instanceof AuthError;

  const isNetworkError =
    statusQuery.isError && statusQuery.error instanceof NetworkError;

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError && !isNotAuthenticated && !isNetworkError,
    isNotAuthenticated,
    isOffline,
    isNetworkError,
    queueLength,
    lastAction,
    error: statusQuery.error,
    isClockedIn: statusQuery.data?.isClockedIn ?? false,
    hasEmployee: statusQuery.data?.hasEmployee ?? false,
    activeWorkPeriod: statusQuery.data?.activeWorkPeriod,
    clockIn: clockInMutation.mutateAsync,
    clockOut: clockOutMutation.mutateAsync,
    isClockingIn: clockInMutation.isPending,
    isClockingOut: clockOutMutation.isPending,
    refetch: statusQuery.refetch,
  };
}
