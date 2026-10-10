"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { suggestStaffingForShift } from "@/app/[locale]/(app)/scheduling/actions";
import { queryKeys } from "@/lib/query/keys";
import type { StaffingShiftInput } from "@/lib/scheduling/staffing/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/** The open shift to staff, or null while the subarea, date or times are not set. */
export function getStaffingShiftInput(values: {
	employeeId: string | null;
	subareaId: string;
	templateId: string | null;
	date: string;
	startTime: string;
	endTime: string;
	shiftId: string | null;
}): StaffingShiftInput | null {
	if (
		values.employeeId ||
		!values.subareaId ||
		!DATE_PATTERN.test(values.date) ||
		!TIME_PATTERN.test(values.startTime) ||
		!TIME_PATTERN.test(values.endTime)
	) {
		return null;
	}
	return {
		subareaId: values.subareaId,
		templateId: values.templateId,
		date: values.date,
		startTime: values.startTime,
		endTime: values.endTime,
		shiftId: values.shiftId,
	};
}

/** Staffing suggestions for the open shift a planner is editing; idle without one. */
export function useStaffingSuggestions(options: {
	enabled: boolean;
	organizationId: string;
	input: StaffingShiftInput | null;
}) {
	const { enabled, organizationId, input } = options;
	return useQuery({
		queryKey: queryKeys.shifts.staffingSuggestions(organizationId, input as StaffingShiftInput),
		queryFn: async () => {
			if (!input) return [];
			const result = await suggestStaffingForShift(input);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && input !== null,
		placeholderData: keepPreviousData,
	});
}
