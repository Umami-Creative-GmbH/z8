"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	type ApprovalWithAbsence,
	getPendingApprovals,
} from "@/app/[locale]/(app)/approvals/actions";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
import { Button } from "@/components/ui/button";
import { formatDateRange } from "@/lib/absences/date-utils";
import { queryKeys } from "@/lib/query";
import { buildAbsenceApprovalColumns, formatAbsenceDays } from "./absence-approval-columns";
import { ApprovalActionDialog } from "./approval-action-dialog";
import { useAbsenceApprovalMutations } from "./use-absence-approval-mutations";

// Filter approvals by search (client-side since typically small list)
function filterApprovals(approvals: ApprovalWithAbsence[] | undefined, search: string) {
	if (!approvals) return [];
	if (!search) return approvals;

	const searchLower = search.toLowerCase();
	return approvals.filter(
		(approval) =>
			approval.requester.user.name.toLowerCase().includes(searchLower) ||
			approval.requester.user.email.toLowerCase().includes(searchLower) ||
			approval.absence.category.name.toLowerCase().includes(searchLower),
	);
}

function AbsenceApprovalsLoadError({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslate();

	return (
		<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
			<p className="text-destructive">
				{t("approvals:approvals.loadError", "Failed to load approvals")}
			</p>
			<Button className="mt-4" variant="outline" onClick={onRetry}>
				<IconRefresh className="mr-2 size-4" />
				{t("common.retry", "Retry")}
			</Button>
		</div>
	);
}

export function AbsenceApprovalsTable() {
	const { t } = useTranslate();
	const [search, setSearch] = useState("");
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogAction, setDialogAction] = useState<"approve" | "reject">("approve");
	const [selectedApproval, setSelectedApproval] = useState<ApprovalWithAbsence | null>(null);

	// Fetch approvals with React Query
	const {
		data: approvals,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: queryKeys.approvals.absences(),
		queryFn: async () => {
			const result = await getPendingApprovals();
			return result.absenceApprovals;
		},
	});

	const { approveMutation, rejectMutation } = useAbsenceApprovalMutations();

	const openDialog = (approval: ApprovalWithAbsence, action: "approve" | "reject") => {
		setSelectedApproval(approval);
		setDialogAction(action);
		setDialogOpen(true);
	};

	const handleConfirm = async (reason?: string) => {
		if (!selectedApproval) return;

		setDialogOpen(false);

		if (dialogAction === "approve") {
			approveMutation.mutate(selectedApproval.absence.id);
		} else {
			rejectMutation.mutate({ absenceId: selectedApproval.absence.id, reason: reason! });
		}
	};

	const filteredApprovals = filterApprovals(approvals, search);

	const columns = buildAbsenceApprovalColumns({
		t,
		actionsDisabled: approveMutation.isPending || rejectMutation.isPending,
		onApprove: (approval) => openDialog(approval, "approve"),
		onReject: (approval) => openDialog(approval, "reject"),
	});

	if (isLoading) {
		return <DataTableSkeleton columnCount={6} rowCount={5} />;
	}

	if (isError) {
		return <AbsenceApprovalsLoadError onRetry={() => refetch()} />;
	}

	return (
		<>
			<div className="space-y-4">
				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchPlaceholder={t(
						"approvals:approvals.searchPlaceholder",
						"Search by name, email, or type...",
					)}
					actions={
						<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
							{isFetching ? (
								<IconLoader2 className="size-4 animate-spin" />
							) : (
								<IconRefresh className="size-4" />
							)}
							<span className="sr-only">{t("common.refresh", "Refresh")}</span>
						</Button>
					}
				/>

				<DataTable mobileLayout="stacked"
					columns={columns}
					data={filteredApprovals}
					isFetching={isFetching}
					emptyMessage={
						search
							? t("approvals:approvals.noSearchResults", "No approvals match your search.")
							: t(
									"approvals:approvals.noAbsenceApprovals",
									"No pending absence requests to review.",
								)
					}
				/>
			</div>

			{selectedApproval && (
				<ApprovalActionDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					action={dialogAction}
					title={
						dialogAction === "approve"
							? t("approvals:approvals.approveTitle", "Approve Absence Request")
							: t("approvals:approvals.rejectTitle", "Reject Absence Request")
					}
					description={`${selectedApproval.requester.user.name} ${t("approvals:approvals.requestingOff", "is requesting")} ${formatAbsenceDays(selectedApproval.absence.absenceDays)} ${t("approvals:approvals.offFrom", "off from")} ${formatDateRange(selectedApproval.absence.startDate, selectedApproval.absence.endDate)}.`}
					onConfirm={handleConfirm}
				/>
			)}
		</>
	);
}
