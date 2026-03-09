"use client";

import { useQuery } from "@tanstack/react-query";
import {
	getLocationsWithSubareas,
	type LocationWithSubareas,
} from "@/app/[locale]/(app)/scheduling/actions";
import {
	listEmployeesForSelect,
	type SelectableEmployee,
} from "@/app/[locale]/(app)/settings/employees/actions";
import { queryKeys } from "@/lib/query/keys";
import { useSkillValidation } from "@/lib/query/use-skills";

interface UseShiftDialogDataOptions {
	open: boolean;
	isManager: boolean;
	organizationId: string;
	employeeId: string | null;
	subareaId: string;
	templateId: string | null;
}

export function useShiftDialogData({
	open,
	isManager,
	organizationId,
	employeeId,
	subareaId,
	templateId,
}: UseShiftDialogDataOptions) {
	const { data: employeesResult } = useQuery({
		queryKey: queryKeys.employees.list(organizationId),
		queryFn: async () => {
			const result = await listEmployeesForSelect({ limit: 1000 });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && isManager,
	});

	const { data: locationsResult } = useQuery({
		queryKey: queryKeys.locations.withSubareas(organizationId),
		queryFn: async () => {
			const result = await getLocationsWithSubareas();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && isManager,
	});

	const { data: skillValidation, isLoading: isValidatingSkills } = useSkillValidation({
		employeeId: employeeId || "",
		subareaId,
		templateId,
		enabled: open && !!employeeId && !!subareaId,
	});

	return {
		employees: employeesResult?.employees || [],
		locations: locationsResult || [],
		skillValidation,
		isValidatingSkills,
	};
}

export type ShiftDialogEmployee = SelectableEmployee;
export type ShiftDialogLocation = LocationWithSubareas;
