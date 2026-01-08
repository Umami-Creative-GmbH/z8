"use client";

import { IconCheck, IconX } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	approveAbsence,
	rejectAbsence,
} from "@/app/[locale]/(app)/approvals/actions";
import { queryKeys } from "@/lib/query";
import type { ApprovalWithAbsence } from "@/lib/validations/approvals";
import { CategoryBadge } from "@/components/absences/category-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { calculateBusinessDays, formatDateRange } from "@/lib/absences/date-utils";
import { ApprovalActionDialog } from "./approval-action-dialog";

interface AbsenceApprovalsTableProps {
	approvals: ApprovalWithAbsence[];
}

export function AbsenceApprovalsTable({ approvals: initialApprovals }: AbsenceApprovalsTableProps) {
	const queryClient = useQueryClient();
	const [approvals, setApprovals] = useState(initialApprovals);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogAction, setDialogAction] = useState<"approve" | "reject">("approve");
	const [selectedApproval, setSelectedApproval] = useState<ApprovalWithAbsence | null>(null);

	// Sync with props when they change
	if (initialApprovals !== approvals && initialApprovals.length !== approvals.length) {
		setApprovals(initialApprovals);
	}

	// Approve mutation with optimistic update
	const approveMutation = useMutation({
		mutationFn: (absenceId: string) => approveAbsence(absenceId),
		onMutate: async (absenceId) => {
			const previousApprovals = approvals;
			setApprovals((prev) => prev.filter((a) => a.absence.id !== absenceId));
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Absence request approved");
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.absences() });
			} else {
				toast.error(result.error || "Failed to approve absence request");
			}
		},
		onError: (_error, _absenceId, context) => {
			if (context?.previousApprovals) {
				setApprovals(context.previousApprovals);
			}
			toast.error("Failed to approve absence request");
		},
	});

	// Reject mutation with optimistic update
	const rejectMutation = useMutation({
		mutationFn: ({ absenceId, reason }: { absenceId: string; reason: string }) =>
			rejectAbsence(absenceId, reason),
		onMutate: async ({ absenceId }) => {
			const previousApprovals = approvals;
			setApprovals((prev) => prev.filter((a) => a.absence.id !== absenceId));
			return { previousApprovals };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success("Absence request rejected");
				queryClient.invalidateQueries({ queryKey: queryKeys.approvals.absences() });
			} else {
				toast.error(result.error || "Failed to reject absence request");
			}
		},
		onError: (_error, _variables, context) => {
			if (context?.previousApprovals) {
				setApprovals(context.previousApprovals);
			}
			toast.error("Failed to reject absence request");
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

	if (approvals.length === 0) {
		return (
			<div className="rounded-md border">
				<div className="p-8 text-center text-muted-foreground">
					No pending absence requests to review.
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
							<TableHead>Dates</TableHead>
							<TableHead>Type</TableHead>
							<TableHead className="text-right">Days</TableHead>
							<TableHead>Notes</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{approvals.map((approval) => {
							const days = calculateBusinessDays(
								approval.absence.startDate,
								approval.absence.endDate,
								[],
							);

							return (
								<TableRow key={approval.id}>
									<TableCell>
										<div className="flex items-center gap-3">
											<Avatar className="size-8">
												<AvatarImage src={approval.requester.user.image || undefined} />
												<AvatarFallback>
													{approval.requester.user.name
														.split(" ")
														.map((n) => n[0])
														.join("")
														.toUpperCase()}
												</AvatarFallback>
											</Avatar>
											<div>
												<div className="font-medium">{approval.requester.user.name}</div>
												<div className="text-xs text-muted-foreground">
													{approval.requester.user.email}
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell className="font-medium">
										{formatDateRange(approval.absence.startDate, approval.absence.endDate)}
									</TableCell>
									<TableCell>
										<CategoryBadge
											name={approval.absence.category.name}
											type={approval.absence.category.type}
											color={approval.absence.category.color}
										/>
									</TableCell>
									<TableCell className="text-right tabular-nums">{days}</TableCell>
									<TableCell className="max-w-[200px] truncate text-muted-foreground">
										{approval.absence.notes || "—"}
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
					title={dialogAction === "approve" ? "Approve Absence Request" : "Reject Absence Request"}
					description={`${selectedApproval.requester.user.name} is requesting ${calculateBusinessDays(selectedApproval.absence.startDate, selectedApproval.absence.endDate, [])} days off from ${formatDateRange(selectedApproval.absence.startDate, selectedApproval.absence.endDate)}.`}
					onConfirm={handleConfirm}
				/>
			)}
		</>
	);
}
