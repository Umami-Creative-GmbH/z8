"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { toast } from "sonner";
import {
	getScheduleComplianceSummary,
	getShifts,
	getShiftTemplates,
	upsertShift,
} from "@/app/[locale]/(app)/scheduling/actions";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query/keys";
import { SKILL_OVERRIDE_REASON_REQUIRED } from "@/lib/scheduling/skill-override-refusal";
import { STATUTORY_PUBLICATION_BLOCKED } from "@/lib/statutory/scheduling/publication-block";
import { schedulingActionErrorMessage } from "../scheduling-action-error";
import { SHIFT_UPDATE_REFUSALS } from "../shifts/use-shift-dialog-mutations";
import { filterShiftsForEmployee, shiftToEvent } from "./shift-scheduler-utils";

/** How a refused drag of a shift on the calendar is worded. */
const SCHEDULER_UPDATE_REFUSALS = {
	...SHIFT_UPDATE_REFUSALS,
	// Moving the shift needs a skill override reason, which only the shift dialog asks for (#893).
	[SKILL_OVERRIDE_REASON_REQUIRED]: [
		"scheduling.scheduler.shiftUpdate.skillOverrideReasonRequired",
		"The employee lacks a required skill on this day. Open the shift to give a reason.",
	],
} satisfies RefusalMessages<
	typeof STATUTORY_PUBLICATION_BLOCKED | typeof SKILL_OVERRIDE_REASON_REQUIRED
>;

interface UseShiftSchedulerDataOptions {
	organizationId: string;
	employeeId: string;
	organizationTimezone: string;
	dateRange: DateRange;
	isManager: boolean;
	/** Shows only this employee's shifts on the calendar; counts still cover all. */
	employeeFilter?: string | null;
}

export interface ShiftSchedulerUpdateInput {
	id: string;
	employeeId?: string | null;
	subareaId: string;
	date: string;
	startTime: string;
	endTime: string;
}

export function useShiftSchedulerData({
	organizationId,
	employeeId,
	organizationTimezone,
	dateRange,
	isManager,
	employeeFilter = null,
}: UseShiftSchedulerDataOptions) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const {
		data: shiftsResult,
		isLoading: shiftsLoading,
		isError: shiftsFailed,
		isFetching: shiftsFetching,
		refetch: retryShifts,
	} = useQuery({
		// A planner's drafts must never hydrate an employee's published-only view.
		queryKey: [
			...queryKeys.shifts.list(organizationId, dateRange),
			"scheduling-viewer",
			employeeId,
			isManager,
		],
		queryFn: async () => {
			const result = await getShifts({
				startDate: dateRange.startDate,
				endDateExclusive: dateRange.endDateExclusive,
				includeOpenShifts: true,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const {
		data: templatesResult,
		isError: templatesFailed,
		isFetching: templatesFetching,
		refetch: retryTemplates,
	} = useQuery({
		queryKey: queryKeys.shiftTemplates.list(organizationId),
		queryFn: async () => {
			const result = await getShiftTemplates();
			// Template settings may refuse an admitted planner. This supporting read
			// is unavailable; its legacy "Unauthorized" text is not a session verdict.
			if (!result.success)
				throw new Error(
					t(
						"scheduling:scheduling.scheduler.templatesUnavailable",
						"Shift templates could not be loaded.",
					),
				);
			return result.data;
		},
		enabled: isManager,
	});

	const {
		data: complianceSummaryResult,
		isError: complianceFailed,
		isFetching: complianceFetching,
		refetch: retryCompliance,
	} = useQuery({
		queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
		queryFn: async () => {
			const result = await getScheduleComplianceSummary(dateRange);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: isManager,
	});

	// An initial failed query loses its error status while refetching. Retain
	// the local Retry task until both supporting reads have settled.
	const [supportingDataRetryPending, startSupportingRetry] = useTransition();
	const retrySupportingData = () =>
		startSupportingRetry(async () => {
			await Promise.all([
				retryTemplates({ cancelRefetch: false }),
				retryCompliance({ cancelRefetch: false }),
			]);
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
			if (!result.success) {
				throw new Error(schedulingActionErrorMessage(t, result, SCHEDULER_UPDATE_REFUSALS));
			}
			return result.data;
		},
		onSuccess: (result) => {
			if (result.metadata.hasOverlap) {
				toast.warning(
					t("scheduling.scheduler.shiftUpdate.overlapWarning", "Shift saved with overlap warning"),
					{
						description: t(
							"scheduling.scheduler.shiftUpdate.overlapDescription",
							"This shift overlaps with {count} other shift(s)",
							{ count: result.metadata.overlappingShifts.length },
						),
					},
				);
			} else {
				toast.success(t("scheduling.scheduler.shiftUpdate.updated", "Shift updated"));
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
			});
		},
		onError: (error) => {
			toast.error(t("scheduling.scheduler.shiftUpdate.failed", "Failed to update shift"), {
				description: error.message,
			});
		},
	});

	const shifts = shiftsResult || [];
	const templates = templatesResult || [];
	const complianceSummary = complianceSummaryResult?.summary;
	const draftCount = shifts.filter((shift) => shift.status === "draft").length;
	const complianceFindingsCount = complianceSummary?.totalFindings ?? 0;
	const hasComplianceWarnings = complianceFindingsCount > 0;

	const events = filterShiftsForEmployee(shifts, employeeFilter).map((shift) =>
		shiftToEvent(shift, organizationTimezone),
	);

	return {
		shifts,
		templates,
		events,
		shiftsLoading,
		shiftsFailed,
		shiftsFetching,
		hasLoadedShifts: shiftsResult !== undefined,
		retryShifts,
		templatesFailed,
		complianceFailed,
		supportingDataFetching: templatesFetching || complianceFetching || supportingDataRetryPending,
		supportingDataRetryPending,
		retrySupportingData,
		complianceSummary,
		draftCount,
		complianceFindingsCount,
		hasComplianceWarnings,
		updateShift: updateShiftMutation.mutate,
	};
}
