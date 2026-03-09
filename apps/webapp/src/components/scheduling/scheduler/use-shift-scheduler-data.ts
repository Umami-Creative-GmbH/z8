"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import {
	getScheduleComplianceSummary,
	getShifts,
	getShiftTemplates,
	upsertShift,
} from "@/app/[locale]/(app)/scheduling/actions";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import { queryKeys } from "@/lib/query/keys";
import { shiftToEvent } from "./shift-scheduler-utils";

interface UseShiftSchedulerDataOptions {
	organizationId: string;
	dateRange: DateRange;
	isManager: boolean;
}

export interface ShiftSchedulerUpdateInput {
	id: string;
	employeeId?: string | null;
	subareaId: string;
	date: Date;
	startTime: string;
	endTime: string;
}

export function useShiftSchedulerData({
	organizationId,
	dateRange,
	isManager,
}: UseShiftSchedulerDataOptions) {
	const queryClient = useQueryClient();

	const { data: shiftsResult, isLoading: shiftsLoading } = useQuery({
		queryKey: queryKeys.shifts.list(organizationId, dateRange),
		queryFn: async () => {
			const result = await getShifts({
				startDate: dateRange.start,
				endDate: dateRange.end,
				includeOpenShifts: true,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const { data: templatesResult } = useQuery({
		queryKey: queryKeys.shiftTemplates.list(organizationId),
		queryFn: async () => {
			const result = await getShiftTemplates();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: isManager,
	});

	const { data: complianceSummaryResult } = useQuery({
		queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
		queryFn: async () => {
			const result = await getScheduleComplianceSummary(dateRange);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: isManager,
	});

	const updateShiftMutation = useMutation({
		mutationFn: async (data: ShiftSchedulerUpdateInput) => {
			const result = await upsertShift({
				id: data.id,
				employeeId: data.employeeId,
				subareaId: data.subareaId,
				date: data.date,
				startTime: data.startTime,
				endTime: data.endTime,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (result) => {
			if (result.metadata.hasOverlap) {
				toast.warning("Shift saved with overlap warning", {
					description: `This shift overlaps with ${result.metadata.overlappingShifts.length} other shift(s)`,
				});
			} else {
				toast.success("Shift updated");
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
			});
		},
		onError: (error) => {
			toast.error("Failed to update shift", { description: error.message });
		},
	});

	const shifts = shiftsResult || [];
	const templates = templatesResult || [];
	const complianceSummary = complianceSummaryResult?.summary;
	const draftCount = shifts.filter((shift) => shift.status === "draft").length;
	const complianceFindingsCount = complianceSummary?.totalFindings ?? 0;
	const hasComplianceWarnings = complianceFindingsCount > 0;

	const events = useMemo(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		() => shifts.map(shiftToEvent) as any[],
		[shifts],
	);

	return {
		shifts,
		templates,
		events,
		shiftsLoading,
		complianceSummary,
		draftCount,
		complianceFindingsCount,
		hasComplianceWarnings,
		updateShift: updateShiftMutation.mutate,
	};
}
