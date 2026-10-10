"use client";

import { IconUsersGroup } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getLocationAssignedEmployeesAction } from "@/app/[locale]/(app)/settings/locations/assigned-location-actions";
import { AssignmentListCard } from "./assignment-list-card";
import {
	ASSIGNED_LOCATIONS_QUERY_KEY,
	useAssignedLocationMutations,
} from "./use-assigned-location-mutations";

/**
 * The employees assigned to a location (#858), for organization owners and
 * admins on the location's settings. Not the location's supervisors. Render it
 * only for owners and admins; the actions refuse others.
 */
export function LocationAssignedEmployeesCard({ locationId }: { locationId: string }) {
	const { t } = useTranslate();
	const mutations = useAssignedLocationMutations();
	const { data, isLoading } = useQuery({
		queryKey: [...ASSIGNED_LOCATIONS_QUERY_KEY, "location", locationId],
		queryFn: async () => {
			const result = await getLocationAssignedEmployeesAction({ locationId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	return (
		<AssignmentListCard
			title={
				<>
					<IconUsersGroup className="size-5" aria-hidden="true" />
					{t("settings.assignedLocations.locationTitle", "Assigned employees")}
				</>
			}
			description={t(
				"settings.assignedLocations.locationDescription",
				"The employees who work at this location. Its kiosks accept only them.",
			)}
			emptyText={t("settings.assignedLocations.locationEmpty", "No assigned employees")}
			noOptionsText={t(
				"settings.assignedLocations.noEmployeesLeft",
				"All active employees are assigned to this location.",
			)}
			selectLabel={t("settings.assignedLocations.employeeLabel", "Employee")}
			selectPlaceholder={t("settings.assignedLocations.employeePlaceholder", "Select an employee")}
			rows={(data?.assigned ?? []).map((row) => ({
				id: row.employeeId,
				label: row.name,
				detail: row.email,
				inactive: !row.isActive,
			}))}
			options={(data?.available ?? []).map((option) => ({
				id: option.employeeId,
				label: option.name,
				detail: option.email,
			}))}
			isLoading={isLoading}
			isMutating={mutations.isMutating}
			onAdd={(employeeId) => mutations.add({ employeeId, locationId })}
			onRemove={(row) => mutations.remove({ employeeId: row.id, locationId })}
		/>
	);
}
