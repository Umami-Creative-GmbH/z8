import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "expo-router";

import { ProfileScreen } from "@/src/features/profile/profile-screen";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import {
  MOBILE_SESSION_QUERY_KEY,
  useMobileSession,
  useMobileSessionController,
} from "@/src/features/session/use-mobile-session";
import { MOBILE_APP_TYPE_HEADER } from "@/src/lib/auth/app-auth";
import { getWebappUrl } from "@/src/lib/config";

export default function ProfileRoute() {
  const { data: session, isError, isLoading, refetch } = useMobileSession();
  const controller = useMobileSessionController();
  const queryClient = useQueryClient();
  const routeState = getMobileSessionRouteState({ session, isError, isLoading });

  const switchOrganization = useMutation({
    mutationFn: async (organizationId: string) => {
      if (!session?.token) {
        throw new Error("No mobile session token");
      }

      const response = await fetch(`${getWebappUrl()}/api/organizations/switch`, {
        method: "POST",
        headers: {
          ...MOBILE_APP_TYPE_HEADER,
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ organizationId }),
      });

      if (!response.ok) {
        throw new Error("Failed to switch organization");
      }

      await queryClient.invalidateQueries({ queryKey: MOBILE_SESSION_QUERY_KEY });
    },
  });

  const signOut = useMutation({
    mutationFn: () => controller.signOut(),
  });

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

  return (
    <ProfileScreen
      activeOrganizationId={session.activeOrganizationId}
      isSigningOut={signOut.isPending}
      isSwitchingOrganization={switchOrganization.isPending}
      onSignOut={() => {
        void signOut.mutateAsync();
      }}
      onSwitchOrganization={(organizationId) => {
        void switchOrganization.mutateAsync(organizationId);
      }}
      organizations={session.organizations}
    />
  );
}
