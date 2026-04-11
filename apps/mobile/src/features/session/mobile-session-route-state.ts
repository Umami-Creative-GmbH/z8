export interface MobileSessionRouteSession {
  activeOrganizationId: string | null;
}

export type MobileSessionRouteState =
  | "loading"
  | "error"
  | "signed-out"
  | "signed-in";

interface MobileSessionRouteStateInput {
  session: MobileSessionRouteSession | null | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function getMobileSessionRouteState({
  session,
  isLoading,
  isError,
}: MobileSessionRouteStateInput): MobileSessionRouteState {
  if (isLoading) {
    return "loading";
  }

  if (isError) {
    return "error";
  }

  if (!session) {
    return "signed-out";
  }

  return "signed-in";
}
