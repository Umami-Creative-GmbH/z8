import { useState } from "react";
import { Redirect, useRouter } from "expo-router";

import { AbsencesScreen } from "@/src/features/absences/absences-screen";
import { useAbsencesQuery } from "@/src/features/absences/use-absences-query";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Absence action failed";
}

export default function AbsencesRoute() {
  const [absenceActionError, setAbsenceActionError] = useState<string | null>(null);
  const router = useRouter();
  const sessionQuery = useMobileSession();
  const session = sessionQuery.data;
  const routeState = getMobileSessionRouteState({
    session,
    isError: sessionQuery.isError,
    isLoading: sessionQuery.isLoading,
  });
  const absencesQuery = useAbsencesQuery(session);

  if (routeState === "loading") {
    return null;
  }

  if (routeState === "error") {
    return <MobileSessionErrorState onRetry={() => void sessionQuery.refetch()} />;
  }

  if (routeState === "signed-out") {
    return <Redirect href="/sign-in" />;
  }

  if (!session) {
    return null;
  }

  if (!session.activeOrganizationId) {
    return <Redirect href="/(app)/profile" />;
  }

  if (absencesQuery.isLoading) {
    return null;
  }

  if (absencesQuery.isError || !absencesQuery.data) {
    return <MobileSessionErrorState onRetry={() => void absencesQuery.refetch()} />;
  }

  return (
    <AbsencesScreen
      absences={absencesQuery.data.absences}
      cancellingAbsenceId={absencesQuery.cancellingAbsenceId}
      errorMessage={absenceActionError}
      isCancellingAbsence={absencesQuery.isCancellingAbsence}
      isLoading={absencesQuery.isLoading}
      onCancelAbsence={(absenceId) => {
        setAbsenceActionError(null);

        void absencesQuery.cancelAbsence(absenceId).catch((error) => {
          setAbsenceActionError(getErrorMessage(error));
        });
      }}
      onRequestAbsence={() => {
        setAbsenceActionError(null);
        router.push("/(app)/absences/request");
      }}
    />
  );
}
