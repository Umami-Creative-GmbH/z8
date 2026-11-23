"use client";

import { IconCheck, IconClock, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	approveComplianceException,
	getPendingExceptions,
	rejectComplianceException,
} from "@/app/[locale]/(app)/settings/compliance/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { ClientForm } from "@/components/ui/client-form";
import { PageHeader } from "@/components/ui/page-header";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { UserAvatar } from "@/components/user-avatar";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { formatDistance } from "@/lib/datetime/format";
import type { ExceptionWithDetails } from "@/lib/effect/services/compliance-guardrail.service";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";

type Translate = ReturnType<typeof useTranslate>["t"];

function formatExceptionEmployeeName(
	employeeRecord: ExceptionWithDetails["employee"],
	t: Translate,
) {
	return (
		buildAuthUserDisplayName(employeeRecord) || t("common.unknownEmployee", "Unknown Employee")
	);
}

interface ComplianceExceptionsManagerProps {
	organizationId: string;
	employeeId: string;
	isAdmin: boolean;
}

function exceptionTypeLabel(exceptionType: string, t: Translate) {
	switch (exceptionType) {
		case "rest_period":
			return t("compliance:compliance.exception.types.restPeriod", "Rest Period");
		case "overtime_daily":
			return t("compliance:compliance.exception.types.overtimeDaily", "Daily Overtime");
		case "overtime_weekly":
			return t("compliance:compliance.exception.types.overtimeWeekly", "Weekly Overtime");
		case "overtime_monthly":
			return t("compliance:compliance.exception.types.overtimeMonthly", "Monthly Overtime");
		default:
			return exceptionType;
	}
}

function formatPlannedDuration(minutes: number) {
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ComplianceExceptionsManager({
	organizationId,
	employeeId: _employeeId,
	isAdmin: _isAdmin,
}: ComplianceExceptionsManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const [rejectingException, setRejectingException] = useState<ExceptionWithDetails | null>(null);

	// Query for pending exceptions
	const {
		data: exceptionsResult,
		isLoading,
		isError,
		refetch,
		isRefetching,
	} = useQuery({
		queryKey: queryKeys.compliance.pendingExceptions(organizationId),
		queryFn: async () => {
			const result = await getPendingExceptions();
			if (!result.success) {
				return Promise.reject(new Error(actionErrorMessage(t, result)));
			}
			return result.data;
		},
	});

	// Mutation for approving exceptions
	const approveMutation = useMutation({
		mutationFn: async (exceptionId: string) => {
			const result = await approveComplianceException({ exceptionId });
			if (!result.success) {
				return Promise.reject(new Error(actionErrorMessage(t, result)));
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.pendingExceptions(organizationId),
			});
			toast.success(t("compliance:compliance.exception.approved", "Exception Approved"), {
				description: t(
					"compliance:compliance.exception.approvedDescription",
					"The compliance exception has been approved.",
				),
			});
		},
		onError: (error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(t("compliance:compliance.exception.approveFailed", "Failed to Approve"), {
				description: message,
			});
		},
	});

	// Mutation for rejecting exceptions
	const rejectMutation = useMutation({
		mutationFn: async ({ exceptionId, reason }: { exceptionId: string; reason?: string }) => {
			const result = await rejectComplianceException({ exceptionId, reason });
			if (!result.success) {
				return Promise.reject(new Error(actionErrorMessage(t, result)));
			}
		},
	});

	const handleApprove = (exception: ExceptionWithDetails) => {
		approveMutation.mutate(exception.id);
	};

	const exceptions = exceptionsResult || [];

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.compliance.title", "ArbZG Compliance")}
					description={t(
						"settings.compliance.description",
						"Review and manage compliance exception requests from team members",
					)}
				/>

				{/* Pending Exceptions Section */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<IconClock className="size-5" aria-hidden="true" />
							<h2>{t("compliance:compliance.pendingExceptions", "Pending Exception Requests")}</h2>
						</CardTitle>
						<CardDescription>
							{t(
								"compliance:compliance.pendingExceptionsDescription",
								"Review exception requests that require your approval",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className="space-y-3">
								{[1, 2, 3].map((i) => (
									<div key={i} className="flex items-center gap-4 rounded-lg border p-4">
										<Skeleton className="size-10 rounded-full" />
										<div className="flex-1 space-y-2">
											<Skeleton className="h-4 w-1/3" />
											<Skeleton className="h-3 w-2/3" />
										</div>
										<Skeleton className="h-9 w-20" />
									</div>
								))}
							</div>
						) : isError ? (
							<div className="flex flex-col items-center gap-4 py-8 text-center">
								<p role="alert" className="text-sm text-destructive">
									{t(
										"compliance:compliance.exception.loadError",
										"Pending exception requests could not be loaded.",
									)}
								</p>
								<Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
									<IconRefresh className="mr-2 size-4" aria-hidden="true" />
									{t("common.retry", "Retry")}
								</Button>
							</div>
						) : exceptions.length === 0 ? (
							<div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
								<IconCheck className="size-6 text-muted-foreground" aria-hidden="true" />
								<p className="text-sm text-muted-foreground">
									{t("compliance:compliance.noExceptions", "No pending exception requests")}
								</p>
							</div>
						) : (
							<ul className="space-y-3">
								{exceptions.map((exception) => (
									<li key={exception.id}>
										<ExceptionCard
											exception={exception}
											onApprove={() => handleApprove(exception)}
											onReject={() => setRejectingException(exception)}
											isApproving={approveMutation.isPending}
											isApprovingThis={
												approveMutation.isPending && approveMutation.variables === exception.id
											}
										/>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>

				<RejectExceptionPanel
					key={rejectingException?.id ?? "closed"}
					exception={rejectingException}
					onClose={() => setRejectingException(null)}
					onReject={async (exceptionId, reason) => {
						await rejectMutation.mutateAsync({ exceptionId, reason });
						await queryClient.invalidateQueries({
							queryKey: queryKeys.compliance.pendingExceptions(organizationId),
						});
					}}
				/>
			</div>
		</div>
	);
}

function RejectExceptionPanel({
	exception,
	onClose,
	onReject,
}: {
	exception: ExceptionWithDetails | null;
	onClose: () => void;
	onReject: (exceptionId: string, reason?: string) => Promise<void>;
}) {
	const { t } = useTranslate();
	const submittingRef = useRef(false);

	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value, formApi }) => {
			if (!exception || submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				try {
					await onReject(exception.id, value.reason.trim() || undefined);
					toast.success(t("compliance:compliance.exception.rejected", "Exception Rejected"), {
						description: t(
							"compliance:compliance.exception.rejectedDescription",
							"The compliance exception has been rejected.",
						),
					});
					formApi.reset();
					onClose();
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					toast.error(t("compliance:compliance.exception.rejectFailed", "Failed to Reject"), {
						description: message,
					});
				}
			};

			// Promise#finally rather than try/finally: the React Compiler cannot
			// compile try statements without a catch clause.
			await run().finally(() => {
				submittingRef.current = false;
			});
		},
	});

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && !submittingRef.current) {
			onClose();
		}
	};

	return (
		<ActionPanel open={exception !== null} onOpenChange={handleOpenChange}>
			<ActionPanelContent
				onEscapeKeyDown={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
			>
				<ClientForm
					className="flex min-h-0 flex-1 flex-col"
					noValidate
					onSubmit={() => {
						if (submittingRef.current) return;
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("compliance:compliance.exception.rejectTitle", "Reject Exception Request")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"compliance:compliance.exception.rejectDescription",
								"Provide a reason for rejecting this exception request (optional)",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
						{exception && (
							<div className="rounded-lg border bg-muted/50 p-3">
								<p className="break-words text-sm font-medium">
									{formatExceptionEmployeeName(exception.employee, t)}
								</p>
								<p className="break-words text-sm text-muted-foreground">
									{exceptionTypeLabel(exception.exceptionType, t)}: {exception.reason}
								</p>
							</div>
						)}

						<form.Field
							name="reason"
							validators={{
								onChange: ({ value }) =>
									value.length > 500
										? t(
												"compliance:compliance.exception.rejectionReasonTooLong",
												"Reason must be 500 characters or fewer.",
											)
										: undefined,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("compliance:compliance.exception.rejectionReason", "Reason for rejection")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											name="reason"
											placeholder={t(
												"compliance:compliance.exception.rejectionPlaceholder",
												"Enter reason for rejecting this exception...",
											)}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											rows={3}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<>
									<Button
										type="button"
										variant="outline"
										onClick={() => handleOpenChange(false)}
										disabled={isSubmitting}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" variant="destructive" disabled={isSubmitting}>
										{isSubmitting ? (
											<>
												<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
												{t("common.rejecting", "Rejecting…")}
											</>
										) : (
											t("common.reject", "Reject")
										)}
									</Button>
								</>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</ClientForm>
			</ActionPanelContent>
		</ActionPanel>
	);
}

interface ExceptionCardProps {
	exception: ExceptionWithDetails;
	onApprove: () => void;
	onReject: () => void;
	isApproving: boolean;
	isApprovingThis: boolean;
}

function ExceptionCard({
	exception,
	onApprove,
	onReject,
	isApproving,
	isApprovingThis,
}: ExceptionCardProps) {
	const { t } = useTranslate();
	const employeeName = formatExceptionEmployeeName(exception.employee, t);
	const typeLabel = exceptionTypeLabel(exception.exceptionType, t);

	return (
		<div className="flex flex-wrap items-start gap-4 rounded-lg border p-4">
			<UserAvatar
				seed={exception.employee.userId}
				name={employeeName}
				size="md"
				showClockStatus={false}
			/>

			<div className="min-w-0 flex-[1_1_14rem] space-y-1">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="min-w-0 truncate font-medium" title={employeeName}>
						{employeeName}
					</span>
					<Badge variant="outline" className="text-xs">
						{typeLabel}
					</Badge>
				</div>

				<p className="break-words text-sm text-muted-foreground">{exception.reason}</p>

				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<span>
						{t("compliance:compliance.exception.requestedAt", "Requested")}{" "}
						{formatDistance(exception.createdAt)}
					</span>
					{exception.plannedDurationMinutes ? (
						<span className="tabular-nums">
							{t("compliance:compliance.exception.plannedDuration", "Planned")}:{" "}
							{formatPlannedDuration(exception.plannedDurationMinutes)}
						</span>
					) : null}
				</div>
			</div>

			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={onReject}
					disabled={isApproving}
					aria-label={t(
						"compliance:compliance.exception.rejectFor",
						"Reject {type} exception for {name}",
						{ type: typeLabel, name: employeeName },
					)}
				>
					<IconX className="mr-1 size-4" aria-hidden="true" />
					{t("common.reject", "Reject")}
				</Button>
				<Button
					size="sm"
					onClick={onApprove}
					disabled={isApproving}
					aria-label={t(
						"compliance:compliance.exception.approveFor",
						"Approve {type} exception for {name}",
						{ type: typeLabel, name: employeeName },
					)}
				>
					{isApprovingThis ? (
						<IconLoader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconCheck className="mr-1 size-4" aria-hidden="true" />
					)}
					{t("common.approve", "Approve")}
				</Button>
			</div>
		</div>
	);
}
