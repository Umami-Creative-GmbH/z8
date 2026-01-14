"use client";

import { IconArrowRight, IconCheck, IconX } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	approveTimeCorrection,
	rejectTimeCorrection,
} from "@/app/[locale]/(app)/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { queryKeys } from "@/lib/query";
import type { ApprovalWithTimeCorrection } from "@/lib/validations/approvals";
import { ApprovalActionDialog } from "./approval-action-dialog";

interface TimeCorrectionApprovalsTableProps {
	approvals: ApprovalWithTimeCorrection[];
}

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

export function TimeCorrectionApprovalsTable({
	approvals: initialApprovals,
}: TimeCorrectionApprovalsTableProps) {
	const queryClient = useQueryClient();
	const [approvals, setApprovals] = useState(initialApprovals);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogAction, setDialogAction] = useState<"approve" | "reject">("approve");
	const [selectedApproval, setSelectedApproval] = useState<ApprovalWithTimeCorrection | null>(null);

	// Sync with props when they change (e.g., after navigation)
	if (initialApprovals !== approvals && initialApprovals.length !== approvals.length) {
		setApprovals(initialApprovals);
	}

	// Approve mutation with optimistic update
	const approveMutation = useMutation({
		mutationFn: (workPeriodId: string) => approveTimeCorrection(workPeriodId),
		onMutate: async (workPeriodId) => {
			// Optimistically remove the approval from the list
			const previousApprovals = approvals;
			setApprovals((prev) => prev.filter((a) => a.workPeriod.id !== workPeriodId));
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Time correction approved");
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.timeCorrections() });
			} else {
				toast.error(result.error || "Failed to approve time correction");
			}
		},
		onError: (_error, _workPeriodId, context) => {
			// Rollback on error
			if (context?.previousApprovals) {
				setApprovals(context.previousApprovals);
			}
			toast.error("Failed to approve time correction");
		},
	});

	// Reject mutation with optimistic update
	const rejectMutation = useMutation({
		mutationFn: ({ workPeriodId, reason }: { workPeriodId: string; reason: string }) =>
			rejectTimeCorrection(workPeriodId, reason),
		onMutate: async ({ workPeriodId }) => {
			const previousApprovals = approvals;
			setApprovals((prev) => prev.filter((a) => a.workPeriod.id !== workPeriodId));
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Time correction rejected");
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.timeCorrections() });
			} else {
				toast.error(result.error || "Failed to reject time correction");
			}
		},
		onError: (_error, _variables, context) => {
			if (context?.previousApprovals) {
				setApprovals(context.previousApprovals);
			}
			toast.error("Failed to reject time correction");
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

	if (approvals.length === 0) {
		return (
			<div className="rounded-md border">
				<div className="p-8 text-center text-muted-foreground">
					No pending time correction requests to review.
				</div>
			</div>
		);
	}

	return (
		<>
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Employee</TableHead>
							<TableHead>Date</TableHead>
							<TableHead>Original Times</TableHead>
							<TableHead>Corrected Times</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{approvals.map((approval) => {
							const originalClockIn = formatTime(approval.workPeriod.clockInEntry.timestamp);
							const originalClockOut = approval.workPeriod.clockOutEntry
								? formatTime(approval.workPeriod.clockOutEntry.timestamp)
								: "—";

							const correctedClockIn = formatTime(approval.workPeriod.startTime);
							const correctedClockOut = approval.workPeriod.endTime
								? formatTime(approval.workPeriod.endTime)
								: "—";

							const hasChanges =
								originalClockIn !== correctedClockIn || originalClockOut !== correctedClockOut;

							return (
								<TableRow key={approval.id}>
									<TableCell>
										<div className="flex items-center gap-3">
											<UserAvatar
												image={approval.requester.user.image}
												seed={approval.requester.user.id}
												name={approval.requester.user.name}
												size="sm"
											/>
											<div>
												<div className="font-medium">{approval.requester.user.name}</div>
												<div className="text-xs text-muted-foreground">
													{approval.requester.user.email}
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell className="font-medium">
										{formatDate(approval.workPeriod.startTime)}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2 font-mono text-sm">
											<span>{originalClockIn}</span>
											<IconArrowRight className="size-3 text-muted-foreground" />
											<span>{originalClockOut}</span>
										</div>
									</TableCell>
									<TableCell>
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
													Changed
												</Badge>
											)}
										</div>
									</TableCell>
									<TableCell className="max-w-[200px] truncate text-muted-foreground">
										{(approval as any).reason || "—"}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-2">
											<Button variant="outline" size="sm" onClick={() => handleApprove(approval)}>
												<IconCheck className="mr-1 size-4" />
												Approve
											</Button>
											<Button variant="outline" size="sm" onClick={() => handleReject(approval)}>
												<IconX className="mr-1 size-4" />
												Reject
											</Button>
										</div>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

			{selectedApproval && (
				<ApprovalActionDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					action={dialogAction}
					title={dialogAction === "approve" ? "Approve Time Correction" : "Reject Time Correction"}
					description={`${selectedApproval.requester.user.name} is requesting a time correction for ${formatDate(selectedApproval.workPeriod.startTime)}.`}
					onConfirm={handleConfirm}
				/>
			)}
		</>
	);
}
