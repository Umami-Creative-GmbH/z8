"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	copySystemWorkPolicyPreset,
	createWorkPolicyFromPreset,
	createWorkPolicyPreset,
	type WorkPolicyPresetInput,
	type WorkPolicyPresetWithSource,
	updateWorkPolicyPreset,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { buildPresetReviewValues } from "./work-policy-preset-utils";

type ReviewMode = "createCustom" | "editCustom" | "copySystem" | "useAsPolicy";

interface WorkPolicyPresetReviewDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	mode: ReviewMode;
	preset?: WorkPolicyPresetWithSource | null;
	onSuccess: () => void;
}

function getInitialValues(
	mode: ReviewMode,
	preset?: WorkPolicyPresetWithSource | null,
): WorkPolicyPresetInput {
	const values = buildPresetReviewValues(preset);
	return {
		...values,
		name: mode === "copySystem" && values.name ? `${values.name} Copy` : values.name,
		description: values.description ?? "",
	};
}

function getDialogCopy(mode: ReviewMode) {
	switch (mode) {
		case "editCustom":
			return {
				title: "Edit custom preset",
				description: "Review this preset before saving your changes.",
				submitLabel: "Save custom preset",
				success: "Preset updated",
			};
		case "copySystem":
			return {
				title: "Copy system preset",
				description: "Review the system preset and save it as a custom preset.",
				submitLabel: "Save custom preset",
				success: "Preset copied",
			};
		case "useAsPolicy":
			return {
				title: "Create policy from preset",
				description: "Review the preset values before creating a work policy.",
				submitLabel: "Create policy",
				success: "Policy created",
			};
		case "createCustom":
		default:
			return {
				title: "Create custom preset",
				description: "Review and save reusable policy defaults for your organization.",
				submitLabel: "Save custom preset",
				success: "Preset created",
			};
	}
}

export function WorkPolicyPresetReviewDialog({
	open,
	onOpenChange,
	organizationId,
	mode,
	preset,
	onSuccess,
}: WorkPolicyPresetReviewDialogProps) {
	const { t } = useTranslate();
	const [serverError, setServerError] = useState<string | null>(null);
	const [setAsDefault, setSetAsDefault] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const copy = getDialogCopy(mode);

	const form = useForm({
		defaultValues: getInitialValues(mode, preset),
		onSubmit: async ({ value }) => {
			setServerError(null);
			setIsSubmitting(true);

			const reviewedValue: WorkPolicyPresetInput = {
				...value,
				name: value.name.trim(),
				description: value.description?.trim() || undefined,
				countryCode: value.countryCode?.trim() || null,
			};

			try {
				const result = await (async () => {
					if (mode === "createCustom") {
						return createWorkPolicyPreset(organizationId, reviewedValue);
					}

					if (!preset) {
						return { success: false, error: "Select a preset to continue" } as const;
					}

					if (mode === "editCustom") {
						return updateWorkPolicyPreset(organizationId, preset.id, reviewedValue);
					}

					if (mode === "copySystem") {
						return copySystemWorkPolicyPreset(organizationId, preset.id, reviewedValue);
					}

					return createWorkPolicyFromPreset(
						organizationId,
						preset.id,
						reviewedValue,
						setAsDefault,
					);
				})();

				if (result.success) {
					toast.success(t("settings.workPolicies.presetReviewSuccess", copy.success));
					onSuccess();
					onOpenChange(false);
					return;
				}

				setServerError(
					result.error ?? t("settings.workPolicies.presetReviewError", "Failed to save preset"),
				);
			} catch {
				setServerError(t("settings.workPolicies.presetReviewError", "Failed to save preset"));
			} finally {
				setIsSubmitting(false);
			}
		},
	});

	useEffect(() => {
		if (!open) return;

		const values = getInitialValues(mode, preset);
		form.reset(values);
		setSetAsDefault(false);
		setServerError(null);
	}, [open, mode, preset, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t(`settings.workPolicies.${mode}.title`, copy.title)}</DialogTitle>
					<DialogDescription>
						{t(`settings.workPolicies.${mode}.description`, copy.description)}
					</DialogDescription>
				</DialogHeader>

				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					{serverError && (
						<Alert variant="destructive" aria-live="polite">
							<AlertDescription>{serverError}</AlertDescription>
						</Alert>
					)}

					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field
							name="name"
							validators={{
								onChange: ({ value }) => {
									if (!value.trim()) return "Name is required";
									if (value.length > 100) return "Name too long";
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2 sm:col-span-2">
									<Label htmlFor="preset-review-name">{t("settings.workPolicies.name", "Name")}</Label>
									<Input
										id="preset-review-name"
										name="preset-review-name"
										autoComplete="off"
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field name="description">
							{(field) => (
								<div className="space-y-2 sm:col-span-2">
									<Label htmlFor="preset-review-description">
										{t("settings.workPolicies.descriptionLabel", "Description")}
									</Label>
									<Textarea
										id="preset-review-description"
										name="preset-review-description"
										autoComplete="off"
										value={field.state.value ?? ""}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="countryCode">
							{(field) => (
								<div className="space-y-2 sm:col-span-2">
									<Label htmlFor="preset-review-country">
										{t("settings.workPolicies.country", "Country")}
									</Label>
									<Input
										id="preset-review-country"
										name="preset-review-country"
										autoComplete="off"
										value={field.state.value ?? ""}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
										placeholder="DE"
									/>
								</div>
							)}
						</form.Field>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="scheduleEnabled">
							{(field) => (
								<div className="flex items-center justify-between rounded-lg border p-4">
									<div className="space-y-0.5">
										<Label htmlFor="preset-review-schedule-enabled">
											{t("settings.workPolicies.workSchedule", "Work Schedule")}
										</Label>
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.workPolicies.workScheduleDescription",
												"Define working hours and days",
											)}
										</p>
									</div>
									<Switch
										id="preset-review-schedule-enabled"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="regulationEnabled">
							{(field) => (
								<div className="flex items-center justify-between rounded-lg border p-4">
									<div className="space-y-0.5">
										<Label htmlFor="preset-review-regulation-enabled">
											{t("settings.workPolicies.timeRegulation", "Time Regulation")}
										</Label>
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.workPolicies.timeRegulationDescription",
												"Set time limits and break rules",
											)}
										</p>
									</div>
									<Switch
										id="preset-review-regulation-enabled"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								</div>
							)}
						</form.Field>
					</div>

					<form.Field name="schedule.hoursPerCycle">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="preset-review-hours-per-cycle">
									{t("settings.workSchedules.hoursPerCycle", "Hours per Cycle")}
								</Label>
								<Input
									id="preset-review-hours-per-cycle"
									name="preset-review-hours-per-cycle"
									autoComplete="off"
									type="number"
									min="0"
									max="744"
									step="0.5"
									value={field.state.value ?? ""}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</div>
						)}
					</form.Field>

					{mode === "useAsPolicy" && (
						<div className="flex items-center gap-2 rounded-lg border p-4">
							<Checkbox
								id="preset-review-set-default"
								checked={setAsDefault}
								onCheckedChange={(checked) => setSetAsDefault(checked === true)}
							/>
							<Label htmlFor="preset-review-set-default">
								{t("settings.workPolicies.setAsDefault", "Set as organization default")}
							</Label>
						</div>
					)}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
							{t(`settings.workPolicies.${mode}.submit`, copy.submitLabel)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
