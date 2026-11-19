"use client";

import {
	type QueryClient,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type ApprovalWithAbsence,
	approveAbsence,
	rejectAbsence,
} from "@/app/[locale]/(app)/approvals/actions";
import { queryKeys } from "@/lib/query";

/** Drops the decided absence from the cached list and returns the snapshot for rollback. */
async function removeApprovalOptimistically(
	queryClient: QueryClient,
	absenceId: string,
	scope?: { userId: string; organizationId: string },
) {
	const key = queryKeys.approvals.absences(scope);
	await queryClient.cancelQueries({ queryKey: key });
	const previousApprovals =
		queryClient.getQueryData<ApprovalWithAbsence[]>(key);
	queryClient.setQueryData<ApprovalWithAbsence[]>(key, (old) =>
		old?.filter((a) => a.absence.id !== absenceId),
	);
	return { previousApprovals, key };
}

function restoreApprovals(
	queryClient: QueryClient,
	context:
		| { previousApprovals?: ApprovalWithAbsence[]; key: readonly unknown[] }
		| undefined,
) {
	if (context?.previousApprovals) {
		queryClient.setQueryData(context.key, context.previousApprovals);
	}
}

export function useAbsenceApprovalMutations(scope?: {
	userId: string;
	organizationId: string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Approve mutation with optimistic update
	const approveMutation = useMutation({
		mutationFn: async (absenceId: string) => {
			const result = await approveAbsence(absenceId);
			if (!result.success)
				throw new Error(
					result.error ||
						t(
							"approvals:approvals.approveFailed",
							"Failed to approve absence request",
						),
				);
			return result;
		},
		onMutate: (absenceId) =>
			removeApprovalOptimistically(queryClient, absenceId, scope),
		onSuccess: () => {
			toast.success(
				t("approvals:approvals.absenceApproved", "Absence request approved"),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
		},
		onError: (_error, _absenceId, context) => {
			restoreApprovals(queryClient, context);
			toast.error(
				t(
					"approvals:approvals.approveFailed",
					"Failed to approve absence request",
				),
			);
		},
	});

	// Reject mutation with optimistic update
	const rejectMutation = useMutation({
		mutationFn: async ({
			absenceId,
			reason,
		}: {
			absenceId: string;
			reason: string;
		}) => {
			const result = await rejectAbsence(absenceId, reason);
			if (!result.success)
				throw new Error(
					result.error ||
						t(
							"approvals:approvals.rejectFailed",
							"Failed to reject absence request",
						),
				);
			return result;
		},
		onMutate: ({ absenceId }) =>
			removeApprovalOptimistically(queryClient, absenceId, scope),
		onSuccess: () => {
			toast.success(
				t("approvals:approvals.absenceRejected", "Absence request rejected"),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
		},
		onError: (_error, _variables, context) => {
			restoreApprovals(queryClient, context);
			toast.error(
				t(
					"approvals:approvals.rejectFailed",
					"Failed to reject absence request",
				),
			);
		},
	});

	return { approveMutation, rejectMutation };
}
