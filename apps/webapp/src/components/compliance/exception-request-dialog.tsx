"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { AlertTriangle, Clock, Shield } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { requestComplianceException } from "@/app/[locale]/(app)/settings/compliance/actions";
import { queryKeys } from "@/lib/query/keys";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Textarea } from "../ui/textarea";

interface ExceptionRequestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultExceptionType?: string;
	employeeId?: string;
	organizationId?: string;
	onSuccess?: () => void;
}

const exceptionTypes = [
	{
		value: "rest_period",
		label: "Rest Period Exception",
		description: "Request to clock in before completing the 11-hour rest period",
		icon: Clock,
	},
	{
		value: "overtime_daily",
		label: "Daily Overtime",
		description: "Request to work beyond the daily overtime threshold",
		icon: AlertTriangle,
	},
	{
		value: "overtime_weekly",
		label: "Weekly Overtime",
		description: "Request to work beyond the weekly overtime threshold",
		icon: AlertTriangle,
	},
	{
		value: "overtime_monthly",
		label: "Monthly Overtime",
		description: "Request to work beyond the monthly overtime threshold",
		icon: AlertTriangle,
	},
] as const;

export function ExceptionRequestDialog({
	open,
	onOpenChange,
	defaultExceptionType,
	employeeId = "current",
	organizationId,
	onSuccess,
}: ExceptionRequestDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const [exceptionType, setExceptionType] = useState<string>(defaultExceptionType || "rest_period");
	const [reason, setReason] = useState("");
	const [plannedHours, setPlannedHours] = useState("");
	const [plannedMinutes, setPlannedMinutes] = useState("");

	const requestMutation = useMutation({
		mutationFn: async () => {
			const plannedDurationMinutes =
				(parseInt(plannedHours, 10) || 0) * 60 + (parseInt(plannedMinutes, 10) || 0);

			const result = await requestComplianceException({
				exceptionType: exceptionType as
					| "rest_period"
					| "overtime_daily"
					| "overtime_weekly"
					| "overtime_monthly",
				reason,
				plannedDurationMinutes: plannedDurationMinutes > 0 ? plannedDurationMinutes : undefined,
			});

			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("compliance.exception.requestSubmitted", "Exception Request Submitted"), {
				description: t(
					"compliance.exception.requestSubmittedDescription",
					"Your manager will be notified and can approve or reject your request.",
				),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.exceptions.my(employeeId, false),
			});
			if (organizationId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.compliance.pendingExceptions(organizationId),
				});
			}
			onOpenChange(false);
			resetForm();
			onSuccess?.();
		},
		onError: (error: Error) => {
			toast.error(t("compliance.exception.requestFailed", "Request Failed"), {
				description: error.message,
			});
		},
	});

	const resetForm = () => {
		setExceptionType(defaultExceptionType || "rest_period");
		setReason("");
		setPlannedHours("");
		setPlannedMinutes("");
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!reason.trim()) {
			toast.error(t("compliance.exception.reasonRequired", "Reason Required"), {
				description: t(
					"compliance.exception.reasonRequiredDescription",
					"Please provide a reason for your exception request.",
				),
			});
			return;
		}
		requestMutation.mutate();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Shield className="h-5 w-5" aria-hidden="true" />
							{t("compliance.exception.requestTitle", "Request Compliance Exception")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"compliance.exception.requestDescription",
								"Request pre-approval from your manager to proceed despite compliance restrictions. Approved exceptions are valid for 24 hours.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-4">
						{/* Exception Type Selection */}
						<div className="space-y-2">
							<Label>{t("compliance.exception.type", "Exception Type")}</Label>
							<RadioGroup
								value={exceptionType}
								onValueChange={setExceptionType}
								className="space-y-2"
							>
								{exceptionTypes.map((type) => {
									const Icon = type.icon;
									return (
										<label
											key={type.value}
											className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
										>
											<RadioGroupItem value={type.value} className="mt-0.5" />
											<div className="flex-1 space-y-0.5">
												<div className="flex items-center gap-1.5 font-medium">
													<Icon className="h-4 w-4" aria-hidden="true" />
													{type.label}
												</div>
												<p className="text-xs text-muted-foreground">{type.description}</p>
											</div>
										</label>
									);
								})}
							</RadioGroup>
						</div>

						{/* Reason */}
						<div className="space-y-2">
							<Label htmlFor="reason">
								{t("compliance.exception.reason", "Reason for Exception")}
								<span className="text-destructive">*</span>
							</Label>
							<Textarea
								id="reason"
								placeholder={t(
									"compliance.exception.reasonPlaceholder",
									"Explain why you need this exception (e.g., urgent project deadline, critical client meeting)...",
								)}
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								rows={3}
								required
							/>
						</div>

						{/* Planned Duration (optional) */}
						{exceptionType !== "rest_period" && (
							<div className="space-y-2">
								<Label>
									{t("compliance.exception.plannedDuration", "Planned Additional Duration")}{" "}
									<span className="text-muted-foreground">({t("common.optional", "optional")})</span>
								</Label>
								<div className="flex items-center gap-2">
									<div className="flex items-center gap-1">
										<Input
											type="number"
											name="plannedHours"
											autoComplete="off"
											min="0"
											max="12"
											value={plannedHours}
											onChange={(e) => setPlannedHours(e.target.value)}
											className="w-16"
											placeholder="0"
										/>
										<span className="text-sm text-muted-foreground">h</span>
									</div>
									<div className="flex items-center gap-1">
										<Input
											type="number"
											name="plannedMinutes"
											autoComplete="off"
											min="0"
											max="59"
											value={plannedMinutes}
											onChange={(e) => setPlannedMinutes(e.target.value)}
											className="w-16"
											placeholder="0"
										/>
										<span className="text-sm text-muted-foreground">m</span>
									</div>
								</div>
								<p className="text-xs text-muted-foreground">
									{t(
										"compliance.exception.plannedDurationHelp",
										"Estimate how much additional time you expect to need beyond the limit.",
									)}
								</p>
							</div>
						)}
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={requestMutation.isPending || !reason.trim()}>
							{requestMutation.isPending
								? t("common.submitting", "Submitting…")
								: t("compliance.exception.submit", "Submit Request")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
