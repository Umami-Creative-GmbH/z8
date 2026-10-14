"use client";
import { useQuery } from "@tanstack/react-query";
import { getOwnAbsenceChangesAction } from "@/app/[locale]/(app)/absences/change-actions";
import { useOrganization } from "@/hooks/use-organization";

export function useOwnAbsenceChanges() {
	const { organizationId, employeeId } = useOrganization();
	return useQuery({
		queryKey: ["own-absence-changes", organizationId, employeeId],
		enabled: Boolean(organizationId && employeeId),
		queryFn: async () => {
			const result = await getOwnAbsenceChangesAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
}
