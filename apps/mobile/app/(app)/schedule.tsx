import { Redirect, useRouter } from "expo-router";

import { ScheduleScreen } from "@/src/features/schedule/schedule-screen";
import { useScheduleQuery } from "@/src/features/schedule/use-schedule-query";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export default function ScheduleRoute() {
	const { push } = useRouter();
  const sessionQuery = useMobileSession();
  const session = sessionQuery.data;
  const routeState = getMobileSessionRouteState({
    session,
    isError: sessionQuery.isError,
    isLoading: sessionQuery.isLoading,
  });
  const scheduleQuery = useScheduleQuery(session);

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

  if (scheduleQuery.isLoading) {
    return null;
  }

  if (scheduleQuery.isError || !scheduleQuery.data) {
    return <MobileSessionErrorState onRetry={() => void scheduleQuery.refetch()} />;
  }

	return (
		<ScheduleScreen
			onRequestAbsence={() => push("/(app)/absences/request")}
			onViewRequests={() => push("/(app)/my-requests")}
			schedule={scheduleQuery.data}
		/>
	);
}
