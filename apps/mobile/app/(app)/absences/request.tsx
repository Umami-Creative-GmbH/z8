import { useState } from "react";
import { Redirect, useRouter } from "expo-router";

import { RequestAbsenceScreen } from "@/src/features/absences/request-absence-screen";
import { useAbsencesQuery } from "@/src/features/absences/use-absences-query";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Absence request failed";
}

export default function RequestAbsenceRoute() {
  const [requestError, setRequestError] = useState<string | null>(null);
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

  if (absencesQuery.isError) {
    return <MobileSessionErrorState onRetry={() => void absencesQuery.refetch()} />;
  }

  if (absencesQuery.isLoading || !absencesQuery.data) {
    return null;
  }

  return (
    <RequestAbsenceScreen
      categories={absencesQuery.data.categories}
      isSubmitting={absencesQuery.isRequestingAbsence}
      onBack={() => router.back()}
      onSubmit={async (values) => {
        setRequestError(null);

        try {
          await absencesQuery.requestAbsence(values);
          router.back();
        } catch (error) {
          setRequestError(getErrorMessage(error));
          throw error;
        }
      }}
      submitErrorMessage={requestError}
      vacationBalance={absencesQuery.data.vacationBalance}
    />
  );
}
