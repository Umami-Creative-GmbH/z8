"use client";

import { IconMapPin } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getEmployeeAssignedLocationsAction } from "@/app/[locale]/(app)/settings/locations/assigned-location-actions";
import { AssignmentListCard } from "./assignment-list-card";
import {
	ASSIGNED_LOCATIONS_QUERY_KEY,
	useAssignedLocationMutations,
} from "./use-assigned-location-mutations";

/**
 * An employee's assigned locations (#858), for organization owners and admins
 * on the employee's settings. Render it only for them; the actions refuse others.
 */
export function EmployeeAssignedLocationsCard({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const mutations = useAssignedLocationMutations();
	const { data, isLoading } = useQuery({
		queryKey: [...ASSIGNED_LOCATIONS_QUERY_KEY, "employee", employeeId],
		queryFn: async () => {
			const result = await getEmployeeAssignedLocationsAction({ employeeId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	return (
		<AssignmentListCard
			title={
				<>
					<IconMapPin className="size-5" aria-hidden="true" />
					{t("settings.assignedLocations.employeeTitle", "Assigned locations")}
				</>
			}
			description={t(
				"settings.assignedLocations.employeeDescription",
				"The locations this employee works at. Kiosks accept only employees assigned to their location.",
			)}
			emptyText={t("settings.assignedLocations.employeeEmpty", "No assigned locations")}
			noOptionsText={t(
				"settings.assignedLocations.noLocationsLeft",
				"There are no further active locations to assign.",
			)}
			selectLabel={t("settings.assignedLocations.locationLabel", "Location")}
			selectPlaceholder={t("settings.assignedLocations.locationPlaceholder", "Select a location")}
			rows={(data?.assigned ?? []).map((row) => ({
				id: row.locationId,
				label: row.name,
				inactive: !row.isActive,
			}))}
			options={(data?.available ?? []).map((option) => ({
				id: option.locationId,
				label: option.name,
			}))}
			isLoading={isLoading}
			isMutating={mutations.isMutating}
			onAdd={(locationId) => mutations.add({ employeeId, locationId })}
			onRemove={(row) => mutations.remove({ employeeId, locationId: row.id })}
		/>
	);
}
