import { useQuery } from "@tanstack/react-query";

import { useMobileSession, type MobileSession } from "@/src/features/session/use-mobile-session";
import { createMobileApiClient } from "@/src/lib/api/client";

export interface MobileScheduleShift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "published";
  notes: string | null;
  color: string | null;
}

export interface MobileEffectiveScheduleDay {
  dayOfWeek: string;
  hoursPerDay: string;
  isWorkDay: boolean;
  cycleWeek: number | null;
}

export interface MobileScheduleData {
  activeOrganizationId: string;
  shifts: MobileScheduleShift[];
  effectiveSchedule: {
    policyName: string;
    assignedVia: string;
    scheduleCycle: string;
    scheduleType: string;
    hoursPerCycle: string | null;
    homeOfficeDaysPerCycle: number | null;
    days: MobileEffectiveScheduleDay[];
  } | null;
}

export const MOBILE_SCHEDULE_QUERY_KEY = "mobile-schedule";

export function getMobileScheduleQueryKey(activeOrganizationId: string | null | undefined) {
  return [MOBILE_SCHEDULE_QUERY_KEY, activeOrganizationId] as const;
}

export function useScheduleQuery(sessionOverride?: MobileSession | null) {
  const sessionQuery = useMobileSession();
  const session = sessionOverride === undefined ? sessionQuery.data : sessionOverride;
  const activeOrganizationId = session?.activeOrganizationId;
  const token = session?.token;

  const scheduleQuery = useQuery({
    queryKey: getMobileScheduleQueryKey(activeOrganizationId),
    enabled: !!token && !!activeOrganizationId,
    queryFn: async () => {
      if (!token) {
        throw new Error("No mobile session token");
      }

      return createMobileApiClient(token).get<MobileScheduleData>("/api/mobile/schedule");
    },
  });

  return {
    ...scheduleQuery,
    session,
  };
}
