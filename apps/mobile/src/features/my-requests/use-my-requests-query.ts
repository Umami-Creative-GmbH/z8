import { useQuery } from "@tanstack/react-query";

import { useMobileSession, type MobileSession } from "@/src/features/session/use-mobile-session";
import { createMobileApiClient } from "@/src/lib/api/client";

export type MobileRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type MobileRequestSourceType = "absence" | "time_correction" | "travel_expense";
export type MobileRequestAction = "view" | "fix";

export interface MobileRequestItem {
  id: string;
  sourceType: MobileRequestSourceType;
  sourceId: string;
  organizationId: string;
  employeeId: string;
  status: MobileRequestStatus;
  submittedAt: string;
  resolvedAt: string | null;
  title: string;
  subtitle: string | null;
  decisionReason: string | null;
  availableActions: MobileRequestAction[];
  sourceHref: string | null;
}

export interface MobileMyRequestsData {
  items: MobileRequestItem[];
  counts: {
    pending: number;
    requiredFixes: number;
    recentDecisions: number;
    total: number;
  };
  sourceErrors: Array<{
    sourceType: MobileRequestSourceType;
    message: string;
  }>;
}

export const MOBILE_MY_REQUESTS_QUERY_KEY = "mobile-my-requests";

export function getMobileMyRequestsQueryKey(activeOrganizationId: string | null | undefined) {
  return [MOBILE_MY_REQUESTS_QUERY_KEY, activeOrganizationId] as const;
}

export function useMyRequestsQuery(sessionOverride?: MobileSession | null) {
  const sessionQuery = useMobileSession();
  const session = sessionOverride === undefined ? sessionQuery.data : sessionOverride;
  const activeOrganizationId = session?.activeOrganizationId;
  const token = session?.token;

  const myRequestsQuery = useQuery({
    queryKey: getMobileMyRequestsQueryKey(activeOrganizationId),
    enabled: !!token && !!activeOrganizationId,
    queryFn: async () => {
      if (!token) {
        throw new Error("No mobile session token");
      }

      return createMobileApiClient(token).get<MobileMyRequestsData>("/api/mobile/my-requests");
    },
  });

  return {
    ...myRequestsQuery,
    session,
  };
}
