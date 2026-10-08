import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface Organization {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	memberRole: string;
	hasEmployeeRecord: boolean;
	ssoRequired?: boolean;
}
interface OrganizationsResponse {
  cached?: boolean;
	organizations: Organization[];
	activeOrganizationId: string | null;
}
export function useOrganizations({
	serverUrl,
	isAuthenticated,
	sessionVersion,
}: {
	serverUrl: string | undefined;
	isAuthenticated: boolean;
	sessionVersion: number;
}) {
	const queryClient = useQueryClient();
	const queryKey = ["organizations", serverUrl, sessionVersion];
	const query = useQuery({
		queryKey,
		queryFn: () => invoke<OrganizationsResponse>("get_organizations"),
		enabled: isAuthenticated && !!serverUrl,
		staleTime: 30000,
		refetchOnWindowFocus: true,
	});
	const mutation = useMutation({
		mutationFn: (organizationId: string) =>
			invoke<OrganizationsResponse>("switch_organization", { organizationId }),
		onSuccess: (data) => queryClient.setQueryData(queryKey, data),
		onSettled: async () => {
			await queryClient.invalidateQueries({ queryKey: ["organizations"] });
			queryClient.removeQueries({ queryKey: ["clock-status"] });
			queryClient.removeQueries({ queryKey: ["clock-journal"] });
			queryClient.removeQueries({ queryKey: ["desktop-context"] });
		},
	});
	return {
		organizations: query.data?.organizations ?? [],
		activeOrganizationId: query.data?.activeOrganizationId ?? null,
		isLoading: query.isLoading,
    isOffline: query.data?.cached === true,
		error: query.error ? String(query.error) : null,
		switchOrganization: async (id: string) => {
			await mutation.mutateAsync(id);
		},
		isSwitching: mutation.isPending,
		refetch: query.refetch,
	};
}
