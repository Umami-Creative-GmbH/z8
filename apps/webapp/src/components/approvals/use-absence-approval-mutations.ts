"use client";

import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type ApprovalWithAbsence,
	approveAbsence,
	rejectAbsence,
} from "@/app/[locale]/(app)/approvals/actions";
import { queryKeys } from "@/lib/query";

/** Drops the decided absence from the cached list and returns the snapshot for rollback. */
async function removeApprovalOptimistically(queryClient: QueryClient, absenceId: string) {
	await queryClient.cancelQueries({ queryKey: queryKeys.approvals.absences() });
	const previousApprovals = queryClient.getQueryData<ApprovalWithAbsence[]>(
		queryKeys.approvals.absences(),
	);
	queryClient.setQueryData<ApprovalWithAbsence[]>(queryKeys.approvals.absences(), (old) =>
		old?.filter((a) => a.absence.id !== absenceId),
	);
	return { previousApprovals };
}

function restoreApprovals(
	queryClient: QueryClient,
	context: { previousApprovals?: ApprovalWithAbsence[] } | undefined,
) {
	if (context?.previousApprovals) {
		queryClient.setQueryData(queryKeys.approvals.absences(), context.previousApprovals);
	}
}

export function useAbsenceApprovalMutations() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Approve mutation with optimistic update
	const approveMutation = useMutation({
		mutationFn: (absenceId: string) => approveAbsence(absenceId),
		onMutate: (absenceId) => removeApprovalOptimistically(queryClient, absenceId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("approvals:approvals.absenceApproved", "Absence request approved"));
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.absences() });
			} else {
				toast.error(
					result.error ||
						t("approvals:approvals.approveFailed", "Failed to approve absence request"),
				);
			}
		},
		onError: (_error, _absenceId, context) => {
			restoreApprovals(queryClient, context);
			toast.error(t("approvals:approvals.approveFailed", "Failed to approve absence request"));
		},
	});

	// Reject mutation with optimistic update
	const rejectMutation = useMutation({
		mutationFn: ({ absenceId, reason }: { absenceId: string; reason: string }) =>
			rejectAbsence(absenceId, reason),
		onMutate: ({ absenceId }) => removeApprovalOptimistically(queryClient, absenceId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("approvals:approvals.absenceRejected", "Absence request rejected"));
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.absences() });
			} else {
				toast.error(
					result.error || t("approvals:approvals.rejectFailed", "Failed to reject absence request"),
				);
			}
		},
		onError: (_error, _variables, context) => {
			restoreApprovals(queryClient, context);
			toast.error(t("approvals:approvals.rejectFailed", "Failed to reject absence request"));
		},
	});

	return { approveMutation, rejectMutation };
}
