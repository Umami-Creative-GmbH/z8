import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, NetworkError, AuthError } from "@/lib/api";
import { storage } from "@/lib/storage";

export function useClock() {
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [queueLength, setQueueLength] = useState(0);

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

  const statusQuery = useQuery({
    queryKey: ["clock-status"],
    queryFn: async () => {
      // If offline, try to get optimistic state
      if (!navigator.onLine) {
        const optimisticState = await storage.getOptimisticState();
        if (optimisticState) {
          return {
            hasEmployee: true,
            employeeId: null,
            isClockedIn: optimisticState.isClockedIn,
            activeWorkPeriod: optimisticState.startTime
              ? { id: "offline", startTime: optimisticState.startTime }
              : null,
          };
        }
        throw new NetworkError("You are offline");
      }
      return api.getClockStatus();
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
        // Queue for later
        await storage.addToQueue({ type: "clock_in", timestamp });
        // Set optimistic state
        await storage.setOptimisticState({ isClockedIn: true, startTime: timestamp });
        return { entry: { id: "queued", type: "clock_in" as const, timestamp, employeeId: "" } };
      }

      const result = await api.clockIn();

      // Show notification
      chrome.runtime.sendMessage({
        type: "SHOW_NOTIFICATION",
        notificationType: "clock_in",
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clock-status"] });
      notifyBackgroundScript();
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (projectId?: string) => {
      const timestamp = new Date().toISOString();

      if (!navigator.onLine) {
        // Queue for later
        await storage.addToQueue({ type: "clock_out", projectId, timestamp });
        // Set optimistic state
        await storage.setOptimisticState({ isClockedIn: false, startTime: null });
        return { entry: { id: "queued", type: "clock_out" as const, timestamp, employeeId: "" } };
      }

      const result = await api.clockOut(projectId);

      // Show notification
      chrome.runtime.sendMessage({
        type: "SHOW_NOTIFICATION",
        notificationType: "clock_out",
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clock-status"] });
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
