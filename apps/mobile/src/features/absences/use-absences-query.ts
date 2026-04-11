import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMobileSession, type MobileSession } from "@/src/features/session/use-mobile-session";
import { createMobileApiClient } from "@/src/lib/api/client";

export type MobileAbsenceDayPeriod = "full_day" | "am" | "pm";
export type MobileAbsenceStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface MobileAbsenceCategory {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  color: string | null;
  requiresApproval?: boolean;
  countsAgainstVacation: boolean;
}

export interface MobileAbsenceRecord {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  startPeriod: MobileAbsenceDayPeriod;
  endPeriod: MobileAbsenceDayPeriod;
  status: MobileAbsenceStatus;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  category: MobileAbsenceCategory;
}

export interface MobileVacationBalance {
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  carryoverDays: number;
}

export interface MobileAbsencesData {
  categories: MobileAbsenceCategory[];
  absences: MobileAbsenceRecord[];
  vacationBalance: MobileVacationBalance;
}

export interface CreateMobileAbsenceRequestInput {
  categoryId: string;
  startDate: string;
  startPeriod: MobileAbsenceDayPeriod;
  endDate: string;
  endPeriod: MobileAbsenceDayPeriod;
  notes?: string;
}

export const MOBILE_ABSENCES_QUERY_KEY = "mobile-absences";

export function getMobileAbsencesQueryKey(activeOrganizationId: string | null | undefined) {
  return [MOBILE_ABSENCES_QUERY_KEY, activeOrganizationId] as const;
}

export function useAbsencesQuery(sessionOverride?: MobileSession | null) {
  const queryClient = useQueryClient();
  const sessionQuery = useMobileSession();
  const session = sessionOverride === undefined ? sessionQuery.data : sessionOverride;
  const activeOrganizationId = session?.activeOrganizationId;
  const token = session?.token;

  const absencesQuery = useQuery({
    queryKey: getMobileAbsencesQueryKey(activeOrganizationId),
    enabled: !!token && !!activeOrganizationId,
    queryFn: async () => {
      if (!token) {
        throw new Error("No mobile session token");
      }

      return createMobileApiClient(token).get<MobileAbsencesData>("/api/mobile/absences");
    },
  });

  const createAbsenceMutation = useMutation({
    mutationFn: async (values: CreateMobileAbsenceRequestInput) => {
      if (!token) {
        throw new Error("No mobile session token");
      }

      return createMobileApiClient(token).post("/api/mobile/absences", values);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMobileAbsencesQueryKey(activeOrganizationId),
      });
    },
  });

  const cancelAbsenceMutation = useMutation({
    mutationFn: async (absenceId: string) => {
      if (!token) {
        throw new Error("No mobile session token");
      }

      return createMobileApiClient(token).post(`/api/mobile/absences/${absenceId}/cancel`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMobileAbsencesQueryKey(activeOrganizationId),
      });
    },
  });

  return {
    ...absencesQuery,
    session,
    requestAbsence: (values: CreateMobileAbsenceRequestInput) =>
      createAbsenceMutation.mutateAsync(values),
    cancelAbsence: (absenceId: string) => cancelAbsenceMutation.mutateAsync(absenceId),
    isRequestingAbsence: createAbsenceMutation.isPending,
    isCancellingAbsence: cancelAbsenceMutation.isPending,
    cancellingAbsenceId: cancelAbsenceMutation.variables ?? null,
  };
}
