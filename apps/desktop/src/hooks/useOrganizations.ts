import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "./useSettings";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  memberRole: string;
  hasEmployeeRecord: boolean;
}

interface OrganizationsResponse {
  organizations: Organization[];
  activeOrganizationId: string | null;
}

async function fetchOrganizations(webappUrl: string, token: string): Promise<OrganizationsResponse> {
  const response = await fetch(`${webappUrl}/api/desktop/organizations`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch organizations");
  }

  return response.json();
}

async function switchOrganization(webappUrl: string, token: string, organizationId: string): Promise<void> {
  const response = await fetch(`${webappUrl}/api/organizations/switch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organizationId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to switch organization");
  }
}

interface SessionResponse {
  is_authenticated: boolean;
  token: string | null;
}

export function useOrganizations() {
  const { settings } = useSettings();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const session = await invoke<SessionResponse>("get_session");
      if (!session.token || !settings?.webappUrl) {
        return { organizations: [], activeOrganizationId: null };
      }
      return fetchOrganizations(settings.webappUrl, session.token);
    },
    enabled: !!settings?.webappUrl,
    staleTime: 30000,
  });

  const switchMutation = useMutation<void, Error, string>({
    mutationFn: async (organizationId: string) => {
      const session = await invoke<SessionResponse>("get_session");
      if (!session.token || !settings?.webappUrl) {
        throw new Error("Not authenticated");
      }
      await switchOrganization(settings.webappUrl, session.token, organizationId);
    },
    onSuccess: async () => {
      // Force immediate refetch to get updated activeOrganizationId
      await queryClient.refetchQueries({ queryKey: ["organizations"] });
      await queryClient.refetchQueries({ queryKey: ["clock-status"] });
    },
  });

  return {
    organizations: data?.organizations ?? [],
    activeOrganizationId: data?.activeOrganizationId ?? null,
    isLoading,
    error: error?.message ?? null,
    switchOrganization: switchMutation.mutateAsync,
    isSwitching: switchMutation.isPending,
    refetch,
  };
}
