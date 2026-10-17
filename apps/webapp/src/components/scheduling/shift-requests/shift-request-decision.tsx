"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { approveShiftRequest, rejectShiftRequest } from "@/app/[locale]/(app)/scheduling/actions";
import type { ShiftRequestWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { SkillWarningAlert } from "@/components/scheduling/skill-warning-alert";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query/keys";
import { useSkillValidation } from "@/lib/query/use-skills";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { SKILL_OVERRIDE_REASON_REQUIRED } from "@/lib/scheduling/skill-override-refusal";

/** The server wants a skill override reason for this approval (#893). */
class SkillOverrideReasonRequired extends Error {
	constructor() {
		super("Skill override reason required");
	}
}

/** Who the shift goes to on approval: the requester of a pickup, the named colleague of a swap. */
export function assignedEmployeeIdOf(request: ShiftRequestWithRelations): string | null {
	return request.type === "pickup" ? request.requesterId : request.targetEmployeeId;
}

interface ShiftRequestDecisionProps {
	request: ShiftRequestWithRelations;
	organizationTimezone: string;
	onDone: () => void;
	onCancel: () => void;
}

function useRefreshAfterDecision() {
	const queryClient = useQueryClient();
	return () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.shiftRequests.all });
		// Approval assigns the shift, so the schedule changes too.
		queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
	};
}

export function ApproveShiftRequestForm({
	request,
	organizationTimezone,
	onDone,
	onCancel,
}: ShiftRequestDecisionProps) {
	const { t } = useTranslate();
	const refresh = useRefreshAfterDecision();
	// The server refused the approval for want of a skill override reason (#893).
	const [reasonRequested, setReasonRequested] = useState(false);

	const employeeId = assignedEmployeeIdOf(request) ?? "";
	const subareaId = request.shift.subareaId ?? "";
	const { data: skillValidation, isLoading: isValidatingSkills } = useSkillValidation({
		employeeId,
		subareaId,
		templateId: request.shift.templateId,
		date: shiftCalendarDate(request.shift.date, organizationTimezone).toString(),
		enabled: !!employeeId && !!subareaId,
	});

	const approveMutation = useMutation({
		mutationFn: async (skillOverrideReason: string) => {
			const result = await approveShiftRequest(request.id, {
				skillOverrideReason: skillOverrideReason.trim() || undefined,
			});
			if (!result.success) {
				if (result.refusal === SKILL_OVERRIDE_REASON_REQUIRED) {
					throw new SkillOverrideReasonRequired();
				}
				throw new Error(result.error);
			}
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("scheduling:scheduling.shiftRequests.approved", "Request approved"));
			refresh();
			onDone();
		},
		onError: (error) => {
			// Not a failure: the form asks for the reason next to the skill warning.
			if (error instanceof SkillOverrideReasonRequired) {
				setReasonRequested(true);
				return;
			}
			toast.error(
				t("scheduling:scheduling.shiftRequests.approveFailed", "Failed to approve the request"),
				{ description: error.message },
			);
		},
	});

	const form = useForm({
		defaultValues: { skillOverrideReason: "" },
		onSubmit: async ({ value }) => {
			await approveMutation.mutateAsync(value.skillOverrideReason).catch(() => undefined);
		},
	});

	const showReason = reasonRequested || (skillValidation ? !skillValidation.isQualified : false);
	const isPending = approveMutation.isPending;

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<SkillWarningAlert validation={skillValidation} isLoading={isValidatingSkills} />

			{showReason && (
				<form.Field name="skillOverrideReason">
					{(field) => {
						// The server decides whether a reason is needed (#893); it asked and got none.
						const missing = reasonRequested && !field.state.value.trim();
						return (
							<TFormItem>
								<TFormLabel hasError={missing}>
									{t(
										"scheduling:scheduling.skills.overrideReason",
										"Reason for the skill override",
									)}
								</TFormLabel>
								<TFormControl hasError={missing}>
									<Textarea
										className="resize-none"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										disabled={isPending}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"scheduling:scheduling.shiftRequests.overrideReasonHelp",
										"Recorded with the approval as a skill override.",
									)}
								</TFormDescription>
								{missing && (
									<TFormMessage>
										{t(
											"scheduling:scheduling.skills.overrideReasonRequired",
											"Give a reason to assign an employee without every required skill.",
										)}
									</TFormMessage>
								)}
							</TFormItem>
						);
					}}
				</form.Field>
			)}

			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" size="sm" disabled={isPending}>
					{isPending ? (
						<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconCheck className="mr-2 size-4" aria-hidden="true" />
					)}
					{t("scheduling:scheduling.shiftRequests.confirmApprove", "Confirm approval")}
				</Button>
			</div>
		</form>
	);
}

export function RejectShiftRequestForm({
	request,
	onDone,
	onCancel,
}: Omit<ShiftRequestDecisionProps, "organizationTimezone">) {
	const { t } = useTranslate();
	const refresh = useRefreshAfterDecision();

	const rejectMutation = useMutation({
		mutationFn: async (reason: string) => {
			const result = await rejectShiftRequest(request.id, reason.trim() || undefined);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("scheduling:scheduling.shiftRequests.rejected", "Request rejected"));
			refresh();
			onDone();
		},
		onError: (error) => {
			toast.error(
				t("scheduling:scheduling.shiftRequests.rejectFailed", "Failed to reject the request"),
				{ description: error.message },
			);
		},
	});

	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			await rejectMutation.mutateAsync(value.reason).catch(() => undefined);
		},
	});

	const isPending = rejectMutation.isPending;

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<form.Field name="reason">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"scheduling:scheduling.shiftRequests.rejectReason",
								"Reason for rejecting (optional)",
							)}
						</TFormLabel>
						<TFormControl>
							<Textarea
								className="resize-none"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								disabled={isPending}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>

			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" variant="destructive" size="sm" disabled={isPending}>
					{isPending ? (
						<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconX className="mr-2 size-4" aria-hidden="true" />
					)}
					{t("scheduling:scheduling.shiftRequests.confirmReject", "Confirm rejection")}
				</Button>
			</div>
		</form>
	);
}
