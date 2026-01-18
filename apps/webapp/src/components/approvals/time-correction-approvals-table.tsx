"use client";

import { IconArrowRight, IconCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	approveTimeCorrection,
	getPendingApprovals,
	rejectTimeCorrection,
	type ApprovalWithTimeCorrection,
} from "@/app/[locale]/(app)/approvals/actions";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { queryKeys } from "@/lib/query";
import { ApprovalActionDialog } from "./approval-action-dialog";

function formatTime(date: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(date);
}

function formatDate(date: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

export function TimeCorrectionApprovalsTable() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogAction, setDialogAction] = useState<"approve" | "reject">("approve");
	const [selectedApproval, setSelectedApproval] = useState<ApprovalWithTimeCorrection | null>(null);

	// Fetch approvals with React Query
	const {
		data: approvals,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: queryKeys.approvals.timeCorrections(),
		queryFn: async () => {
			const result = await getPendingApprovals();
			return result.timeCorrectionApprovals;
		},
	});

	// Approve mutation with optimistic update
	const approveMutation = useMutation({
		mutationFn: (workPeriodId: string) => approveTimeCorrection(workPeriodId),
		onMutate: async (workPeriodId) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.approvals.timeCorrections() });
			const previousApprovals = queryClient.getQueryData<ApprovalWithTimeCorrection[]>(
				queryKeys.approvals.timeCorrections(),
			);
			queryClient.setQueryData<ApprovalWithTimeCorrection[]>(
				queryKeys.approvals.timeCorrections(),
				(old) => old?.filter((a) => a.workPeriod.id !== workPeriodId),
			);
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("approvals.timeCorrectionApproved", "Time correction approved"));
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.timeCorrections() });
			} else {
				toast.error(
					result.error || t("approvals.approveFailed", "Failed to approve time correction"),
				);
			}
		},
		onError: (_error, _workPeriodId, context) => {
			if (context?.previousApprovals) {
				queryClient.setQueryData(queryKeys.approvals.timeCorrections(), context.previousApprovals);
			}
			toast.error(t("approvals.approveFailed", "Failed to approve time correction"));
		},
	});

	// Reject mutation with optimistic update
	const rejectMutation = useMutation({
		mutationFn: ({ workPeriodId, reason }: { workPeriodId: string; reason: string }) =>
			rejectTimeCorrection(workPeriodId, reason),
		onMutate: async ({ workPeriodId }) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.approvals.timeCorrections() });
			const previousApprovals = queryClient.getQueryData<ApprovalWithTimeCorrection[]>(
				queryKeys.approvals.timeCorrections(),
			);
			queryClient.setQueryData<ApprovalWithTimeCorrection[]>(
				queryKeys.approvals.timeCorrections(),
				(old) => old?.filter((a) => a.workPeriod.id !== workPeriodId),
			);
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("approvals.timeCorrectionRejected", "Time correction rejected"));
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.timeCorrections() });
			} else {
				toast.error(
					result.error || t("approvals.rejectFailed", "Failed to reject time correction"),
				);
			}
		},
		onError: (_error, _variables, context) => {
			if (context?.previousApprovals) {
				queryClient.setQueryData(queryKeys.approvals.timeCorrections(), context.previousApprovals);
			}
			toast.error(t("approvals.rejectFailed", "Failed to reject time correction"));
		},
	});

	const handleApprove = (approval: ApprovalWithTimeCorrection) => {
		setSelectedApproval(approval);
		setDialogAction("approve");
		setDialogOpen(true);
	};

	const handleReject = (approval: ApprovalWithTimeCorrection) => {
		setSelectedApproval(approval);
		setDialogAction("reject");
		setDialogOpen(true);
	};

	const handleConfirm = async (reason?: string) => {
		if (!selectedApproval) return;

		setDialogOpen(false);

		if (dialogAction === "approve") {
			approveMutation.mutate(selectedApproval.workPeriod.id);
		} else {
			rejectMutation.mutate({ workPeriodId: selectedApproval.workPeriod.id, reason: reason! });
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
				approval.requester.user.email.toLowerCase().includes(searchLower),
		);
	}, [approvals, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<ApprovalWithTimeCorrection>[]>(
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
				accessorKey: "date",
				header: t("approvals.date", "Date"),
				cell: ({ row }) => (
					<span className="font-medium">{formatDate(row.original.workPeriod.startTime)}</span>
				),
			},
			{
				accessorKey: "originalTimes",
				header: t("approvals.originalTimes", "Original Times"),
				cell: ({ row }) => {
					const originalClockIn = formatTime(row.original.workPeriod.clockInEntry.timestamp);
					const originalClockOut = row.original.workPeriod.clockOutEntry
						? formatTime(row.original.workPeriod.clockOutEntry.timestamp)
						: "—";
					return (
						<div className="flex items-center gap-2 font-mono text-sm">
							<span>{originalClockIn}</span>
							<IconArrowRight className="size-3 text-muted-foreground" />
							<span>{originalClockOut}</span>
						</div>
					);
				},
			},
			{
				accessorKey: "correctedTimes",
				header: t("approvals.correctedTimes", "Corrected Times"),
				cell: ({ row }) => {
					const originalClockIn = formatTime(row.original.workPeriod.clockInEntry.timestamp);
					const originalClockOut = row.original.workPeriod.clockOutEntry
						? formatTime(row.original.workPeriod.clockOutEntry.timestamp)
						: "—";
					const correctedClockIn = formatTime(row.original.workPeriod.startTime);
					const correctedClockOut = row.original.workPeriod.endTime
						? formatTime(row.original.workPeriod.endTime)
						: "—";
					const hasChanges =
						originalClockIn !== correctedClockIn || originalClockOut !== correctedClockOut;

					return (
						<div className="flex items-center gap-2">
							<div className="flex items-center gap-2 font-mono text-sm">
								<span className={hasChanges ? "text-orange-600 font-medium" : ""}>
									{correctedClockIn}
								</span>
								<IconArrowRight className="size-3 text-muted-foreground" />
								<span className={hasChanges ? "text-orange-600 font-medium" : ""}>
									{correctedClockOut}
								</span>
							</div>
							{hasChanges && (
								<Badge variant="outline" className="text-xs">
									{t("approvals.changed", "Changed")}
								</Badge>
							)}
						</div>
					);
				},
			},
			{
				accessorKey: "reason",
				header: t("approvals.reason", "Reason"),
				cell: ({ row }) => (
					<span className="max-w-[200px] truncate text-muted-foreground block">
						{(row.original as any).reason || "—"}
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
					searchPlaceholder={t("approvals.searchPlaceholder", "Search by name or email...")}
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
							: t(
									"approvals.noTimeCorrectionApprovals",
									"No pending time correction requests to review.",
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
							? t("approvals.approveTimeCorrectionTitle", "Approve Time Correction")
							: t("approvals.rejectTimeCorrectionTitle", "Reject Time Correction")
					}
					description={`${selectedApproval.requester.user.name} ${t("approvals.requestingCorrection", "is requesting a time correction for")} ${formatDate(selectedApproval.workPeriod.startTime)}.`}
					onConfirm={handleConfirm}
				/>
			)}
		</>
	);
}
