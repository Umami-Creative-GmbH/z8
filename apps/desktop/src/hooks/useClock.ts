import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { isUnsent, needsReview } from "../lib/saved-commands";
import type { ClockCommandOutcome, ClockJournal, ClockStatus, WorkLocationType } from "../types";

type ClockAction =
  | { command: "clock_in"; workLocationType: WorkLocationType }
  | { command: "clock_out" }
  | { command: "clock_out_with_break"; breakId: string; workLocationType: WorkLocationType };

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

  // Each poll also sends saved commands of the current context.
  const journalQuery = useQuery({
    queryKey: ["clock-journal", scopeKey],
    queryFn: () => invoke<ClockJournal>("sync_clock_commands", { force: false }),
    enabled,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const refreshAfterCommands = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["clock-status"] });
    void queryClient.invalidateQueries({ queryKey: ["clock-journal"] });
  }, [queryClient]);

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
      void queryClient.invalidateQueries({ queryKey: ["clock-journal"] });
    },
    onError: (error: ClockCommandFailure) => {
      uncertainPersistence.current = error.kind === "persistenceUncertain";
      setActionFailure(error);
      void queryClient.invalidateQueries({ queryKey: ["clock-journal"] });
    },
  });

  // Its errors concern a saved command, not a new clock action; see savedCommandError.
  const savedCommandMutation = useMutation({
    mutationFn: ({ command, operationId }: { command: "retry_clock_command" | "archive_clock_command"; operationId: string }) =>
      invoke<ClockJournal>(command, { operationId }),
    onSuccess: (journal) => {
      queryClient.setQueryData(["clock-journal", scopeKey], journal);
      void queryClient.invalidateQueries({ queryKey: ["clock-status"] });
    },
  });

  const refetch = useCallback(() => {
    setActionFailure((previous) => previous?.kind === "preSend" ? null : previous);
    refreshAfterCommands();
  }, [refreshAfterCommands]);

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

  const journal = journalQuery.data;
  const retained = mutation.data?.outcome === "retainedForReview";
  const needsStatusRefresh = refreshScope === scopeKey;
  const isStatusCurrent = !!statusQuery.data && !statusQuery.isError && !needsStatusRefresh;
  const savedNeedReview = journal?.commands.some(needsReview) ?? false;
  const hasUnsentCommands = journal?.commands.some(isUnsent) ?? false;
  const serverReady = isStatusCurrent && statusQuery.data?.hasEmployee === true;
  // Without the server, only a context this session negotiated can be asserted.
  const offlineCapture = !!journal && journal.commandsEnabled && !journal.serverReachable;
  const projection = journal?.projection ?? null;
  const canClock = enabled && !mutation.isPending && !savedCommandMutation.isPending && !statusQuery.isFetching &&
    journalQuery.isSuccess && journal?.legacy.total === 0 && !savedNeedReview && !retained &&
    actionFailure?.kind !== "persistenceUncertain" && (serverReady || offlineCapture);

  return {
    // Saved commands that may still commit describe the state the user is in.
    isClockedIn: projection?.isClockedIn ?? statusQuery.data?.isClockedIn ?? false,
    startTime: projection ? projection.since : statusQuery.data?.activeWorkPeriod?.startTime ?? null,
    isError: statusQuery.isError,
    isStatusCurrent,
    needsStatusRefresh,
    actionError: actionFailure?.message ?? null,
    journal,
    journalError: journalQuery.isError,
    canClock,
    // An atomic break is saved like any other action (#281); the legacy
    // two-request break needs the server and nothing unsent before it.
    canRecordBreak: canClock && (journal?.breaksEnabled === true || (serverReady && !hasUnsentCommands)),
    clockIn: (workLocationType: WorkLocationType) => submit({ command: "clock_in", workLocationType }),
    clockOut: () => submit({ command: "clock_out" }),
    clockOutWithBreak: (args: { breakId: string; workLocationType: WorkLocationType }) =>
      submit({ command: "clock_out_with_break", ...args }),
    retrySavedCommand: (operationId: string) => savedCommandMutation.mutate({ command: "retry_clock_command", operationId }),
    archiveSavedCommand: (operationId: string) => savedCommandMutation.mutate({ command: "archive_clock_command", operationId }),
    isUpdatingSavedCommand: savedCommandMutation.isPending,
    savedCommandError: savedCommandMutation.error ? String(savedCommandMutation.error) : null,
    isClockingIn: mutation.isPending && mutation.variables.action.command === "clock_in",
    isClockingOut: mutation.isPending && mutation.variables.action.command !== "clock_in",
    refetch,
  };
}
