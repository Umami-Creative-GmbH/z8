import { useState } from "react";
import { Redirect } from "expo-router";

import { HomeScreen } from "@/src/features/home/home-screen";
import { useHomeQuery, type WorkLocationType } from "@/src/features/home/use-home-query";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Clock action failed";
}

export default function HomeRoute() {
  const [selectedWorkLocation, setSelectedWorkLocation] = useState<WorkLocationType | null>(null);
  const [clockActionError, setClockActionError] = useState<string | null>(null);
  const sessionQuery = useMobileSession();
  const session = sessionQuery.data;
  const routeState = getMobileSessionRouteState({
    session,
    isError: sessionQuery.isError,
    isLoading: sessionQuery.isLoading,
  });
  const homeQuery = useHomeQuery(session);

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

  if (homeQuery.isLoading) {
    return null;
  }

  if (homeQuery.isError || !homeQuery.data) {
    return <MobileSessionErrorState onRetry={() => void homeQuery.refetch()} />;
  }

  const home = homeQuery.data;

  return (
    <HomeScreen
      clock={home.clock}
      errorMessage={clockActionError}
      isSubmitting={homeQuery.isClockSubmitting}
      onClockIn={() => {
        if (!selectedWorkLocation) {
          return;
        }

        setClockActionError(null);

        void homeQuery.clockIn(selectedWorkLocation)
          .then(() => {
            setSelectedWorkLocation(null);
            setClockActionError(null);
          })
          .catch((error) => {
            setClockActionError(getErrorMessage(error));
          });
      }}
      onClockOut={() => {
        setClockActionError(null);

        void homeQuery.clockOut().catch((error) => {
          setClockActionError(getErrorMessage(error));
        });
      }}
      onSelectWorkLocation={(location) => {
        setClockActionError(null);
        setSelectedWorkLocation(location);
      }}
      selectedWorkLocation={selectedWorkLocation}
      today={home.today}
    />
  );
}
