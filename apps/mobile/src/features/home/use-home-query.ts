import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMobileSession, type MobileSession } from "@/src/features/session/use-mobile-session";
import { createMobileApiClient } from "@/src/lib/api/client";

export type WorkLocationType = "office" | "home" | "field" | "other";

export interface MobileHomeData {
  activeOrganizationId: string;
  clock: {
    isClockedIn: boolean;
    activeWorkPeriod: {
      id: string;
      startTime: string;
    } | null;
  };
  today: {
    minutesWorked: number;
    latestEventLabel: string | null;
    nextApprovedAbsence?: {
      id: string;
      startDate: string;
      endDate: string;
      startPeriod: string;
      endPeriod: string;
      category: {
        id: string;
        name: string;
        color: string;
      };
    } | null;
  };
}

export const MOBILE_HOME_QUERY_KEY = "mobile-home";

function getMobileHomeQueryKey(activeOrganizationId: string | null | undefined) {
  return [MOBILE_HOME_QUERY_KEY, activeOrganizationId] as const;
}

export function useHomeQuery(sessionOverride?: MobileSession | null) {
  const queryClient = useQueryClient();
  const sessionQuery = useMobileSession();
  const session = sessionOverride === undefined ? sessionQuery.data : sessionOverride;
  const activeOrganizationId = session?.activeOrganizationId;
  const token = session?.token;

  const homeQuery = useQuery({
    queryKey: getMobileHomeQueryKey(activeOrganizationId),
    enabled: !!token && !!activeOrganizationId,
    queryFn: async () => {
      if (!token) {
        throw new Error("No mobile session token");
      }

      return createMobileApiClient(token).get<MobileHomeData>("/api/mobile/home");
    },
  });

  const clockMutation = useMutation({
    mutationFn: async (
      action:
        | { action: "clock_in"; workLocationType: WorkLocationType }
        | { action: "clock_out" },
    ) => {
      if (!token) {
        throw new Error("No mobile session token");
      }

      return createMobileApiClient(token).post("/api/mobile/time-clock", action);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMobileHomeQueryKey(activeOrganizationId),
      });
    },
  });

  return {
    ...homeQuery,
    session,
    clockIn: (workLocationType: WorkLocationType) =>
      clockMutation.mutateAsync({ action: "clock_in", workLocationType }),
    clockOut: () => clockMutation.mutateAsync({ action: "clock_out" }),
    isClockSubmitting: clockMutation.isPending,
  };
}
