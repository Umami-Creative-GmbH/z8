"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CronSchedulePreset, ScheduledCronJobRow } from "@/lib/cron/schedules";
import { resetCronSchedule, updateCronSchedule } from "./actions";

export interface ScheduleControlsLabels {
	edit: string;
	reset: string;
	save: string;
	cancel: string;
	presetLabel: string;
	highRiskTitle: string;
	highRiskDescription: string;
	confirmationLabel: string;
	confirmationText: string;
	saved: string;
	resetSaved: string;
	warningPrefix: string;
	failed: string;
	mismatch: string;
	readOnly: string;
}

const HIGH_RISK_CRON_JOB_NAMES = new Set<string>([
	"cron:billing-seat-reconciliation",
	"cron:execution-cleanup",
	"cron:organization-cleanup",
	"cron:break-enforcement",
	"cron:teams-daily-digest",
	"cron:teams-escalation",
	"cron:telegram-daily-digest",
	"cron:telegram-escalation",
	"cron:discord-daily-digest",
	"cron:discord-escalation",
	"cron:slack-daily-digest",
	"cron:slack-escalation",
]);

type ScheduleControlsJob = ScheduledCronJobRow & { isHighRisk?: boolean };

interface ScheduleControlsProps {
	job: ScheduleControlsJob;
	labels: ScheduleControlsLabels;
	presets: CronSchedulePreset[];
}

interface ScheduleFormValues {
	presetId: string;
	confirmation: string;
}

function showMutationResultToast({
	result,
	successLabel,
	warningPrefix,
	failedLabel,
}: {
	result: Awaited<ReturnType<typeof updateCronSchedule>>;
	successLabel: string;
	warningPrefix: string;
	failedLabel: string;
}) {
	if (!result.success) {
		toast.error(result.error ?? failedLabel);
		return false;
	}

	if (result.data.warning) {
		toast.warning(`${warningPrefix}: ${result.data.warning}`);
	} else {
		toast.success(successLabel);
	}

	return true;
}

export function ScheduleControls({ job, labels, presets }: ScheduleControlsProps) {
	const router = useRouter();
	const highRisk = job.isHighRisk ?? HIGH_RISK_CRON_JOB_NAMES.has(job.jobName);
	const [isEditing, setIsEditing] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isResetConfirming, setIsResetConfirming] = useState(false);
	const [resetConfirmation, setResetConfirmation] = useState("");
	const defaultPresetId = job.presetId ?? presets[0]?.id ?? "";

	const form = useForm({
		defaultValues: {
			presetId: defaultPresetId,
			confirmation: "",
		} satisfies ScheduleFormValues,
		onSubmit: async ({ value }) => {
			if (highRisk && value.confirmation !== labels.confirmationText) {
				toast.error(labels.failed);
				return;
			}

			setIsSubmitting(true);
			try {
				const result = await updateCronSchedule({
					jobName: job.jobName,
					presetId: value.presetId,
					confirmation: highRisk ? value.confirmation : undefined,
				});

				const didSave = showMutationResultToast({
					result,
					successLabel: labels.saved,
					warningPrefix: labels.warningPrefix,
					failedLabel: labels.failed,
				});

				if (didSave) {
					setIsEditing(false);
					router.refresh();
				}
			} catch (error) {
				setIsSubmitting(false);
				toast.error(error instanceof Error ? error.message : labels.failed);
				return;
			}

			setIsSubmitting(false);
		},
	});

	function getDefaultFormValues(): ScheduleFormValues {
		return {
			presetId: defaultPresetId,
			confirmation: "",
		};
	}

	useEffect(() => {
		if (isEditing) {
			form.reset({
				presetId: defaultPresetId,
				confirmation: "",
			});
		}
	}, [isEditing, defaultPresetId, form.reset]);

	function openEditForm() {
		form.reset(getDefaultFormValues());
		setIsEditing(true);
	}

	function closeEditForm() {
		form.reset(getDefaultFormValues());
		setIsEditing(false);
	}

	const resetDisabled = !job.isOverridden || isSubmitting;
	const resetNeedsConfirmation = highRisk && isResetConfirming;
	const canSubmitReset = !highRisk || resetConfirmation === labels.confirmationText;

	async function handleReset() {
		if (highRisk && !isResetConfirming) {
			setIsResetConfirming(true);
			return;
		}

		setIsSubmitting(true);
		try {
			const result = await resetCronSchedule({
				jobName: job.jobName,
				confirmation: highRisk ? resetConfirmation : undefined,
			});

			const didReset = showMutationResultToast({
				result,
				successLabel: labels.resetSaved,
				warningPrefix: labels.warningPrefix,
				failedLabel: labels.failed,
			});

			if (didReset) {
				setIsResetConfirming(false);
				setResetConfirmation("");
				router.refresh();
			}
		} catch (error) {
			setIsSubmitting(false);
			toast.error(error instanceof Error ? error.message : labels.failed);
			return;
		}

		setIsSubmitting(false);
	}

	return (
		<div className="space-y-2">
			{job.hasScheduleMismatch ? (
				<p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-medium text-amber-700 text-xs dark:text-amber-300">
					{labels.mismatch}
				</p>
			) : null}

			{job.canEdit ? null : <p className="text-muted-foreground text-xs">{labels.readOnly}</p>}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={openEditForm}
					disabled={!job.canEdit || isSubmitting}
				>
					{labels.edit}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleReset}
					disabled={resetDisabled || resetNeedsConfirmation}
				>
					{labels.reset}
				</Button>
			</div>

			{isEditing ? (
				<form
					className="space-y-3 rounded-md border bg-muted/30 p-3"
					action={async () => {
						await form.handleSubmit();
					}}
				>
					{highRisk ? (
						<Alert className="border-destructive/40 bg-destructive/5">
							<AlertTitle>{labels.highRiskTitle}</AlertTitle>
							<AlertDescription>{labels.highRiskDescription}</AlertDescription>
						</Alert>
					) : null}

					<form.Field name="presetId">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor={`cron-preset-${job.jobName}`}>{labels.presetLabel}</Label>
								<select
									id={`cron-preset-${job.jobName}`}
									className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									disabled={isSubmitting}
								>
									{presets.map((preset) => (
										<option key={preset.id} value={preset.id}>
											{preset.label}
										</option>
									))}
								</select>
							</div>
						)}
					</form.Field>

					{highRisk ? (
						<form.Field name="confirmation">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor={`cron-confirmation-${job.jobName}`}>
										{labels.confirmationLabel}
									</Label>
									<Input
										id={`cron-confirmation-${job.jobName}`}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder={labels.confirmationText}
										disabled={isSubmitting}
									/>
								</div>
							)}
						</form.Field>
					) : null}

					<div className="flex items-center gap-2">
						<form.Subscribe selector={(state) => state.values.confirmation}>
							{(confirmation) => (
								<Button
									type="submit"
									size="sm"
									disabled={isSubmitting || (highRisk && confirmation !== labels.confirmationText)}
								>
									{labels.save}
								</Button>
							)}
						</form.Subscribe>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={closeEditForm}
							disabled={isSubmitting}
						>
							{labels.cancel}
						</Button>
					</div>
				</form>
			) : null}

			{resetNeedsConfirmation ? (
				<div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
					<Alert className="border-destructive/40 bg-transparent">
						<AlertTitle>{labels.highRiskTitle}</AlertTitle>
						<AlertDescription>{labels.highRiskDescription}</AlertDescription>
					</Alert>
					<div className="space-y-1.5">
						<Label htmlFor={`cron-reset-confirmation-${job.jobName}`}>
							{labels.confirmationLabel}
						</Label>
						<Input
							id={`cron-reset-confirmation-${job.jobName}`}
							value={resetConfirmation}
							onChange={(event) => setResetConfirmation(event.target.value)}
							placeholder={labels.confirmationText}
							disabled={isSubmitting}
						/>
					</div>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							onClick={handleReset}
							disabled={isSubmitting || !canSubmitReset}
						>
							{labels.reset}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setIsResetConfirming(false);
								setResetConfirmation("");
							}}
							disabled={isSubmitting}
						>
							{labels.cancel}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
