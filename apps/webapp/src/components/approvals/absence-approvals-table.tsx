"use client";

import { IconCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	approveAbsence,
	getPendingApprovals,
	rejectAbsence,
	type ApprovalWithAbsence,
} from "@/app/[locale]/(app)/approvals/actions";
import { CategoryBadge } from "@/components/absences/category-badge";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { calculateBusinessDaysWithHalfDays, formatDateRange } from "@/lib/absences/date-utils";
import { queryKeys } from "@/lib/query";
import { ApprovalActionDialog } from "./approval-action-dialog";

// Format days display (handle half days)
function formatDays(days: number): string {
	if (days === 1) return "1 day";
	if (days === 0.5) return "0.5 day";
	if (Number.isInteger(days)) return `${days} days`;
	return `${days} days`;
}

export function AbsenceApprovalsTable() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
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

	// Approve mutation with optimistic update
	const approveMutation = useMutation({
		mutationFn: (absenceId: string) => approveAbsence(absenceId),
		onMutate: async (absenceId) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.approvals.absences() });
			const previousApprovals = queryClient.getQueryData<ApprovalWithAbsence[]>(
				queryKeys.approvals.absences(),
			);
			queryClient.setQueryData<ApprovalWithAbsence[]>(queryKeys.approvals.absences(), (old) =>
				old?.filter((a) => a.absence.id !== absenceId),
			);
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("approvals.absenceApproved", "Absence request approved"));
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.absences() });
			} else {
				toast.error(result.error || t("approvals.approveFailed", "Failed to approve absence request"));
			}
		},
		onError: (_error, _absenceId, context) => {
			if (context?.previousApprovals) {
				queryClient.setQueryData(queryKeys.approvals.absences(), context.previousApprovals);
			}
			toast.error(t("approvals.approveFailed", "Failed to approve absence request"));
		},
	});

	// Reject mutation with optimistic update
	const rejectMutation = useMutation({
		mutationFn: ({ absenceId, reason }: { absenceId: string; reason: string }) =>
			rejectAbsence(absenceId, reason),
		onMutate: async ({ absenceId }) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.approvals.absences() });
			const previousApprovals = queryClient.getQueryData<ApprovalWithAbsence[]>(
				queryKeys.approvals.absences(),
			);
			queryClient.setQueryData<ApprovalWithAbsence[]>(queryKeys.approvals.absences(), (old) =>
				old?.filter((a) => a.absence.id !== absenceId),
			);
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("approvals.absenceRejected", "Absence request rejected"));
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.absences() });
			} else {
				toast.error(result.error || t("approvals.rejectFailed", "Failed to reject absence request"));
			}
		},
		onError: (_error, _variables, context) => {
			if (context?.previousApprovals) {
				queryClient.setQueryData(queryKeys.approvals.absences(), context.previousApprovals);
			}
			toast.error(t("approvals.rejectFailed", "Failed to reject absence request"));
		},
	});

	const handleApprove = (approval: ApprovalWithAbsence) => {
		setSelectedApproval(approval);
		setDialogAction("approve");
		setDialogOpen(true);
	};

	const handleReject = (approval: ApprovalWithAbsence) => {
		setSelectedApproval(approval);
		setDialogAction("reject");
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

	// Filter approvals by search (client-side since typically small list)
	const filteredApprovals = useMemo(() => {
		if (!approvals) return [];
		if (!search) return approvals;

		const searchLower = search.toLowerCase();
		return approvals.filter(
			(approval) =>
				approval.requester.user.name.toLowerCase().includes(searchLower) ||
				approval.requester.user.email.toLowerCase().includes(searchLower) ||
				approval.absence.category.name.toLowerCase().includes(searchLower),
		);
	}, [approvals, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<ApprovalWithAbsence>[]>(
		() => [
			{
				accessorKey: "requester",
				header: t("approvals.employee", "Employee"),
				cell: ({ row }) => (
					<div className="flex items-center gap-3">
						<UserAvatar
							image={row.original.requester.user.image}
							seed={row.original.requester.user.id}
							name={row.original.requester.user.name}
							size="sm"
						/>
						<div>
							<div className="font-medium">{row.original.requester.user.name}</div>
							<div className="text-xs text-muted-foreground">
								{row.original.requester.user.email}
							</div>
						</div>
					</div>
				),
			},
			{
				accessorKey: "dates",
				header: t("approvals.dates", "Dates"),
				cell: ({ row }) => (
					<span className="font-medium">
						{formatDateRange(row.original.absence.startDate, row.original.absence.endDate)}
					</span>
				),
			},
			{
				accessorKey: "type",
				header: t("approvals.type", "Type"),
				cell: ({ row }) => (
					<CategoryBadge
						name={row.original.absence.category.name}
						type={row.original.absence.category.type}
						color={row.original.absence.category.color}
					/>
				),
			},
			{
				accessorKey: "days",
				header: () => <div className="text-right">{t("approvals.days", "Days")}</div>,
				cell: ({ row }) => {
					const days = calculateBusinessDaysWithHalfDays(
						row.original.absence.startDate,
						row.original.absence.startPeriod,
						row.original.absence.endDate,
						row.original.absence.endPeriod,
						[],
					);
					return <div className="text-right tabular-nums">{formatDays(days)}</div>;
				},
			},
			{
				accessorKey: "notes",
				header: t("approvals.notes", "Notes"),
				cell: ({ row }) => (
					<span className="max-w-[200px] truncate text-muted-foreground block">
						{row.original.absence.notes || "—"}
					</span>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleApprove(row.original)}
							disabled={approveMutation.isPending || rejectMutation.isPending}
						>
							<IconCheck className="mr-1 size-4" />
							{t("approvals.approve", "Approve")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleReject(row.original)}
							disabled={approveMutation.isPending || rejectMutation.isPending}
						>
							<IconX className="mr-1 size-4" />
							{t("approvals.reject", "Reject")}
						</Button>
					</div>
				),
			},
		],
		[t, approveMutation.isPending, rejectMutation.isPending],
	);

	if (isLoading) {
		return <DataTableSkeleton columnCount={6} rowCount={5} />;
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
				<p className="text-destructive">
					{t("approvals.loadError", "Failed to load approvals")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<>
			<div className="space-y-4">
				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchPlaceholder={t("approvals.searchPlaceholder", "Search by name, email, or type...")}
					actions={
						<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
							{isFetching ? (
								<IconLoader2 className="h-4 w-4 animate-spin" />
							) : (
								<IconRefresh className="h-4 w-4" />
							)}
							<span className="sr-only">{t("common.refresh", "Refresh")}</span>
						</Button>
					}
				/>

				<DataTable
					columns={columns}
					data={filteredApprovals}
					isFetching={isFetching}
					emptyMessage={
						search
							? t("approvals.noSearchResults", "No approvals match your search.")
							: t("approvals.noAbsenceApprovals", "No pending absence requests to review.")
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
							? t("approvals.approveTitle", "Approve Absence Request")
							: t("approvals.rejectTitle", "Reject Absence Request")
					}
					description={`${selectedApproval.requester.user.name} ${t("approvals.requestingOff", "is requesting")} ${formatDays(calculateBusinessDaysWithHalfDays(selectedApproval.absence.startDate, selectedApproval.absence.startPeriod, selectedApproval.absence.endDate, selectedApproval.absence.endPeriod, []))} ${t("approvals.offFrom", "off from")} ${formatDateRange(selectedApproval.absence.startDate, selectedApproval.absence.endDate)}.`}
					onConfirm={handleConfirm}
				/>
			)}
		</>
	);
}
