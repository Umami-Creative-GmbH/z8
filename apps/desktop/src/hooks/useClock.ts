import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import type { ClockStatus } from "../types";

export function useClock() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["clock-status"],
    queryFn: () => invoke<ClockStatus>("get_clock_status"),
    refetchInterval: 30000, // Refresh every 30 seconds
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const clockInMutation = useMutation({
    mutationFn: () => invoke<ClockStatus>("clock_in"),
    onSuccess: (data) => {
      queryClient.setQueryData(["clock-status"], data);
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: () => invoke<ClockStatus>("clock_out"),
    onSuccess: (data) => {
      queryClient.setQueryData(["clock-status"], data);
    },
  });

  const clockOutWithBreakMutation = useMutation({
    mutationFn: (breakStartTime: string) =>
      invoke<ClockStatus>("clock_out_with_break", { breakStartTime }),
    onSuccess: (data) => {
      queryClient.setQueryData(["clock-status"], data);
    },
  });

  const refetch = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ["clock-status"] });
  }, [queryClient]);

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isFetching: statusQuery.isFetching,
    isError: statusQuery.isError,
    error: statusQuery.error,

    isClockedIn: statusQuery.data?.isClockedIn ?? false,
    activeWorkPeriod: statusQuery.data?.activeWorkPeriod ?? null,

    clockIn: clockInMutation.mutateAsync,
    clockOut: clockOutMutation.mutateAsync,
    clockOutWithBreak: clockOutWithBreakMutation.mutateAsync,

    isClockingIn: clockInMutation.isPending,
    isClockingOut: clockOutMutation.isPending || clockOutWithBreakMutation.isPending,
    isMutating:
      clockInMutation.isPending ||
      clockOutMutation.isPending ||
      clockOutWithBreakMutation.isPending,

    refetch,
  };
}
