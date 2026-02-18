"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { AlertTriangle, Check, Clock, Shield, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	approveComplianceException,
	getPendingExceptions,
	rejectComplianceException,
} from "@/app/[locale]/(app)/settings/compliance/actions";
import type { ExceptionWithDetails } from "@/lib/effect/services/compliance-guardrail.service";
import { formatDistance } from "@/lib/datetime/format";
import { queryKeys } from "@/lib/query";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";

interface ComplianceExceptionsManagerProps {
	organizationId: string;
	employeeId: string;
	isAdmin: boolean;
}

const exceptionTypeLabels: Record<string, string> = {
	rest_period: "Rest Period",
	overtime_daily: "Daily Overtime",
	overtime_weekly: "Weekly Overtime",
	overtime_monthly: "Monthly Overtime",
};

const exceptionTypeColors: Record<string, string> = {
	rest_period: "bg-blue-500",
	overtime_daily: "bg-orange-500",
	overtime_weekly: "bg-amber-500",
	overtime_monthly: "bg-red-500",
};

export function ComplianceExceptionsManager({
	organizationId,
	employeeId,
	isAdmin,
}: ComplianceExceptionsManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Rejection dialog state
	const [rejectionDialogOpen, setRejectionDialogOpen] = useState(false);
	const [rejectingException, setRejectingException] = useState<ExceptionWithDetails | null>(null);
	const [rejectionReason, setRejectionReason] = useState("");

	// Query for pending exceptions
	const { data: exceptionsResult, isLoading } = useQuery({
		queryKey: queryKeys.compliance.pendingExceptions(organizationId),
		queryFn: async () => {
			const result = await getPendingExceptions();
			if (!result.success) {
				return Promise.reject(result.error || "Failed to load exceptions");
			}
			return result.data;
		},
	});

	// Mutation for approving exceptions
	const approveMutation = useMutation({
		mutationFn: async (exceptionId: string) => {
			const result = await approveComplianceException(exceptionId);
			if (!result.success) {
				return Promise.reject(result.error || "Failed to approve exception");
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.pendingExceptions(organizationId),
			});
			toast.success(t("compliance.exception.approved", "Exception Approved"), {
				description: t(
					"compliance.exception.approvedDescription",
					"The compliance exception has been approved.",
				),
			});
		},
		onError: (error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(t("compliance.exception.approveFailed", "Failed to Approve"), {
				description: message,
			});
		},
	});

	// Mutation for rejecting exceptions
	const rejectMutation = useMutation({
		mutationFn: async ({ exceptionId, reason }: { exceptionId: string; reason?: string }) => {
			const result = await rejectComplianceException(exceptionId, reason);
			if (!result.success) {
				return Promise.reject(result.error || "Failed to reject exception");
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.pendingExceptions(organizationId),
			});
			setRejectionDialogOpen(false);
			setRejectingException(null);
			setRejectionReason("");
			toast.success(t("compliance.exception.rejected", "Exception Rejected"), {
				description: t(
					"compliance.exception.rejectedDescription",
					"The compliance exception has been rejected.",
				),
			});
		},
		onError: (error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(t("compliance.exception.rejectFailed", "Failed to Reject"), {
				description: message,
			});
		},
	});

	const handleApprove = (exception: ExceptionWithDetails) => {
		approveMutation.mutate(exception.id);
	};

	const handleRejectClick = (exception: ExceptionWithDetails) => {
		setRejectingException(exception);
		setRejectionDialogOpen(true);
	};

	const handleRejectConfirm = () => {
		if (rejectingException) {
			rejectMutation.mutate({
				exceptionId: rejectingException.id,
				reason: rejectionReason || undefined,
			});
		}
	};

	const exceptions = exceptionsResult || [];

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
					<Shield className="h-6 w-6" aria-hidden="true" />
					{t("settings.compliance.title", "ArbZG Compliance")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.compliance.description",
						"Review and manage compliance exception requests from team members",
					)}
				</p>
			</div>

			{/* Pending Exceptions Section */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<Clock className="h-5 w-5" aria-hidden="true" />
						{t("compliance.pendingExceptions", "Pending Exception Requests")}
					</CardTitle>
					<CardDescription>
						{t(
							"compliance.pendingExceptionsDescription",
							"Review exception requests that require your approval",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-3">
							{[1, 2, 3].map((i) => (
								<div key={i} className="flex items-center gap-4 rounded-lg border p-4">
									<Skeleton className="h-10 w-10 rounded-full" />
									<div className="flex-1 space-y-2">
										<Skeleton className="h-4 w-1/3" />
										<Skeleton className="h-3 w-2/3" />
									</div>
									<Skeleton className="h-9 w-20" />
								</div>
							))}
						</div>
					) : exceptions.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<Check className="mb-3 h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
							<p className="text-sm text-muted-foreground">
								{t("compliance.noExceptions", "No pending exception requests")}
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{exceptions.map((exception) => (
								<ExceptionCard
									key={exception.id}
									exception={exception}
									onApprove={() => handleApprove(exception)}
									onReject={() => handleRejectClick(exception)}
									isApproving={approveMutation.isPending}
								/>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Rejection Dialog */}
			<Dialog open={rejectionDialogOpen} onOpenChange={setRejectionDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t("compliance.exception.rejectTitle", "Reject Exception Request")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"compliance.exception.rejectDescription",
								"Provide a reason for rejecting this exception request (optional)",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4">
						{rejectingException && (
							<div className="rounded-lg border bg-muted/50 p-3">
								<p className="text-sm font-medium">
									{rejectingException.employee.firstName} {rejectingException.employee.lastName}
								</p>
								<p className="text-sm text-muted-foreground">
									{exceptionTypeLabels[rejectingException.exceptionType]}:{" "}
									{rejectingException.reason}
								</p>
							</div>
						)}

						<div className="space-y-2">
							<Label htmlFor="rejection-reason">
								{t("compliance.exception.rejectionReason", "Reason for rejection")}
							</Label>
							<Textarea
								id="rejection-reason"
								placeholder={t(
									"compliance.exception.rejectionPlaceholder",
									"Enter reason for rejecting this exception...",
								)}
								value={rejectionReason}
								onChange={(e) => setRejectionReason(e.target.value)}
								rows={3}
							/>
						</div>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setRejectionDialogOpen(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							variant="destructive"
							onClick={handleRejectConfirm}
							disabled={rejectMutation.isPending}
						>
							{rejectMutation.isPending
								? t("common.rejecting", "Rejecting…")
								: t("common.reject", "Reject")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

interface ExceptionCardProps {
	exception: ExceptionWithDetails;
	onApprove: () => void;
	onReject: () => void;
	isApproving: boolean;
}

function ExceptionCard({ exception, onApprove, onReject, isApproving }: ExceptionCardProps) {
	const { t } = useTranslate();
	const employeeName =
		`${exception.employee.firstName || ""} ${exception.employee.lastName || ""}`.trim() ||
		"Unknown";
	const initials = employeeName
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

	return (
		<div className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50">
			<Avatar className="h-10 w-10">
				<AvatarFallback>{initials}</AvatarFallback>
			</Avatar>

			<div className="flex-1 space-y-1">
				<div className="flex items-center gap-2">
					<span className="font-medium">{employeeName}</span>
					<Badge variant="outline" className="text-xs">
						<span
							className={`mr-1.5 inline-block h-2 w-2 rounded-full ${exceptionTypeColors[exception.exceptionType] || "bg-gray-500"}`}
						/>
						{exceptionTypeLabels[exception.exceptionType] || exception.exceptionType}
					</Badge>
				</div>

				<p className="text-sm text-muted-foreground">{exception.reason}</p>

				<div className="flex items-center gap-3 text-xs text-muted-foreground">
					<span>
						{t("compliance.exception.requestedAt", "Requested")}{" "}
						{formatDistance(exception.createdAt)}
					</span>
					{exception.plannedDurationMinutes && (
						<span>
							{t("compliance.exception.plannedDuration", "Planned")}:{" "}
							{Math.floor(exception.plannedDurationMinutes / 60)}h{" "}
							{exception.plannedDurationMinutes % 60}m
						</span>
					)}
				</div>
			</div>

			<div className="flex gap-2">
				<Button size="sm" variant="outline" onClick={onReject} disabled={isApproving}>
					<X className="mr-1 h-4 w-4" aria-hidden="true" />
					{t("common.reject", "Reject")}
				</Button>
				<Button size="sm" onClick={onApprove} disabled={isApproving}>
					<Check className="mr-1 h-4 w-4" aria-hidden="true" />
					{t("common.approve", "Approve")}
				</Button>
			</div>
		</div>
	);
}
