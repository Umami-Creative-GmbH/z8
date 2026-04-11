import { Redirect } from "expo-router";

import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export default function Index() {
  const { data: session, isError, isLoading, refetch } = useMobileSession();
  const routeState = getMobileSessionRouteState({ session, isError, isLoading });

  if (routeState === "loading") {
    return null;
  }

  if (routeState === "error") {
    return <MobileSessionErrorState onRetry={() => void refetch()} />;
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

  return <Redirect href="/(app)/home" />;
}
