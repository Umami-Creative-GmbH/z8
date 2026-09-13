import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import type { ClockCommandOutcome, ClockStatus, RecoverySummary, WorkLocationType } from "../types";

type ClockAction =
  | { command: "clock_in"; workLocationType: WorkLocationType }
  | { command: "clock_out" }
  | { command: "clock_out_with_break"; breakStartTime: string; workLocationType: WorkLocationType };

interface ClockScope {
  enabled: boolean;
  sessionVersion: number;
  serverUrl: string | undefined;
  organizationId: string | null;
}

class ClockCommandFailure extends Error {
  constructor(message: string, readonly kind: "preSend" | "persistenceUncertain") {
    super(message);
  }
}

function commandFailure(error: unknown): ClockCommandFailure {
  if (error && typeof error === "object" && "kind" in error && "message" in error && typeof error.message === "string") {
    return new ClockCommandFailure(error.message, error.kind === "preSend" ? "preSend" : "persistenceUncertain");
  }
  // IPC failure may follow a remote commit: lack of a typed response is not absence.
  return new ClockCommandFailure("Clock outcome is unconfirmed. Check your time entries in Z8 before trying again.", "persistenceUncertain");
}

export function useClock({ enabled, sessionVersion, serverUrl, organizationId }: ClockScope) {
  const queryClient = useQueryClient();
  // Cache isolation only; these assertions do not grant server/recovery authority.
  const scopeKey = JSON.stringify([sessionVersion, serverUrl, organizationId]);
  const [refreshScope, setRefreshScope] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<ClockCommandFailure | null>(null);
  const inFlight = useRef(false);
  const uncertainPersistence = useRef(false);

  const statusQuery = useQuery({
    queryKey: ["clock-status", scopeKey],
    queryFn: async () => {
      const status = await invoke<ClockStatus>("get_clock_status");
      setRefreshScope((previous) => previous === scopeKey ? null : previous);
      return status;
    },
    enabled,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const recoveryQuery = useQuery({
    queryKey: ["clock-recovery", scopeKey],
    queryFn: () => invoke<RecoverySummary>("get_queue_recovery_summary"),
    enabled,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: async ({ action: { command, ...args } }: { action: ClockAction; scopeKey: string }) => {
      try {
        return await invoke<ClockCommandOutcome>(command, args);
      } catch (error) {
        throw commandFailure(error);
      }
    },
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey: ["clock-status"] }),
    onSuccess: (result, submitted) => {
      setActionFailure(null);
      if (result.outcome === "committed" && result.write.status && !result.write.contextChanged) {
        // A late result can update only its original scope's cache.
        queryClient.setQueryData(["clock-status", submitted.scopeKey], result.write.status);
      } else {
        if (result.outcome === "committed") setRefreshScope(submitted.scopeKey);
        void queryClient.invalidateQueries({ queryKey: ["clock-status"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["clock-recovery"] });
    },
    onError: (error: ClockCommandFailure) => {
      uncertainPersistence.current = error.kind === "persistenceUncertain";
      setActionFailure(error);
      void queryClient.invalidateQueries({ queryKey: ["clock-recovery"] });
    },
  });

  const refetch = useCallback(() => {
    setActionFailure((previous) => previous?.kind === "preSend" ? null : previous);
    void queryClient.invalidateQueries({ queryKey: ["clock-status"] });
    void queryClient.invalidateQueries({ queryKey: ["clock-recovery"] });
  }, [queryClient]);

  const submit = async (action: ClockAction) => {
    // Shared synchronous guard covers double clicks and idle/ordinary callers
    // before React can render the mutation's pending state.
    if (inFlight.current || uncertainPersistence.current) {
      throw new ClockCommandFailure("A clock request is pending or requires review. Check your time entries before another action.", "preSend");
    }
    inFlight.current = true;
    try {
      return await mutation.mutateAsync({ action, scopeKey });
    } finally {
      inFlight.current = false;
    }
  };

  const retained = mutation.data?.outcome === "retainedForReview";
  const needsStatusRefresh = refreshScope === scopeKey;
  const isStatusCurrent = !!statusQuery.data && !statusQuery.isError && !needsStatusRefresh;

  return {
    isClockedIn: statusQuery.data?.isClockedIn ?? false,
    activeWorkPeriod: statusQuery.data?.activeWorkPeriod ?? null,
    isError: statusQuery.isError,
    isStatusCurrent,
    needsStatusRefresh,
    actionError: actionFailure?.message ?? null,
    recovery: recoveryQuery.data,
    recoveryError: recoveryQuery.isError,
    canClock: enabled && !mutation.isPending && !statusQuery.isFetching && isStatusCurrent && statusQuery.data?.hasEmployee === true &&
      recoveryQuery.isSuccess && recoveryQuery.data.total === 0 && !retained && actionFailure?.kind !== "persistenceUncertain",
    clockIn: (workLocationType: WorkLocationType) => submit({ command: "clock_in", workLocationType }),
    clockOut: () => submit({ command: "clock_out" }),
    clockOutWithBreak: (args: { breakStartTime: string; workLocationType: WorkLocationType }) =>
      submit({ command: "clock_out_with_break", ...args }),
    isClockingIn: mutation.isPending && mutation.variables.action.command === "clock_in",
    isClockingOut: mutation.isPending && mutation.variables.action.command !== "clock_in",
    refetch,
  };
}
