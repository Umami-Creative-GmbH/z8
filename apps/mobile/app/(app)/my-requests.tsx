import { Redirect } from "expo-router";

import { MyRequestsScreen } from "@/src/features/my-requests/my-requests-screen";
import { useMyRequestsQuery } from "@/src/features/my-requests/use-my-requests-query";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export default function MyRequestsRoute() {
  const sessionQuery = useMobileSession();
  const session = sessionQuery.data;
  const routeState = getMobileSessionRouteState({
    session,
    isError: sessionQuery.isError,
    isLoading: sessionQuery.isLoading,
  });
  const myRequestsQuery = useMyRequestsQuery(session);

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

  if (myRequestsQuery.isLoading) {
    return null;
  }

  if (myRequestsQuery.isError || !myRequestsQuery.data) {
    return <MobileSessionErrorState onRetry={() => void myRequestsQuery.refetch()} />;
  }

  return <MyRequestsScreen requests={myRequestsQuery.data} />;
}
