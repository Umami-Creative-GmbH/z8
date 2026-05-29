"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { buildPresetReviewValues } from "./work-policy-preset-utils";

type ReviewMode = "createCustom" | "editCustom" | "copySystem" | "useAsPolicy";

const defaultBreakRule = {
	workingMinutesThreshold: 360,
	requiredBreakMinutes: 30,
	options: [
		{
			splitCount: 1,
			minimumSplitMinutes: null,
			minimumLongestSplitMinutes: null,
		},
	],
};

const defaultBreakOption = {
	splitCount: 1,
	minimumSplitMinutes: null,
	minimumLongestSplitMinutes: null,
};

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

					return createWorkPolicyFromPreset(organizationId, preset.id, reviewedValue, setAsDefault);
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
									<Label htmlFor="preset-review-name">
										{t("settings.workPolicies.name", "Name")}
									</Label>
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

					<div className="space-y-4 rounded-lg border p-4">
						<div>
							<h3 className="text-sm font-medium">
								{t("settings.workPolicies.scheduleDefaults", "Schedule defaults")}
							</h3>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.workPolicies.scheduleDefaultsDescription",
									"Review the cycle and working-day defaults saved with this preset.",
								)}
							</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-3">
							<form.Field name="schedule.scheduleCycle">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="preset-review-schedule-cycle">
											{t("settings.workSchedules.scheduleCycle", "Schedule cycle")}
										</Label>
										<Select
											value={field.state.value ?? "weekly"}
											onValueChange={(value) =>
												field.handleChange(
													value as NonNullable<WorkPolicyPresetInput["schedule"]>["scheduleCycle"],
												)
											}
										>
											<SelectTrigger id="preset-review-schedule-cycle" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="daily">
													{t("settings.workSchedules.daily", "Daily")}
												</SelectItem>
												<SelectItem value="weekly">
													{t("settings.workSchedules.weekly", "Weekly")}
												</SelectItem>
												<SelectItem value="biweekly">
													{t("settings.workSchedules.biweekly", "Biweekly")}
												</SelectItem>
												<SelectItem value="monthly">
													{t("settings.workSchedules.monthly", "Monthly")}
												</SelectItem>
												<SelectItem value="yearly">
													{t("settings.workSchedules.yearly", "Yearly")}
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>

							<form.Field name="schedule.workingDaysPreset">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="preset-review-working-days">
											{t("settings.workSchedules.workingDays", "Working days")}
										</Label>
										<Select
											value={field.state.value ?? "weekdays"}
											onValueChange={(value) =>
												field.handleChange(
													value as NonNullable<
														WorkPolicyPresetInput["schedule"]
													>["workingDaysPreset"],
												)
											}
										>
											<SelectTrigger id="preset-review-working-days" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="weekdays">
													{t("settings.workSchedules.weekdays", "Weekdays")}
												</SelectItem>
												<SelectItem value="weekends">
													{t("settings.workSchedules.weekends", "Weekends")}
												</SelectItem>
												<SelectItem value="all_days">
													{t("settings.workSchedules.allDays", "All days")}
												</SelectItem>
												<SelectItem value="custom">
													{t("settings.workSchedules.custom", "Custom")}
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>

							<form.Field name="schedule.hoursPerCycle">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="preset-review-hours-per-cycle">
											{t("settings.workSchedules.hoursPerCycle", "Hours per cycle")}
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
						</div>
					</div>

					<div className="space-y-4 rounded-lg border p-4">
						<div>
							<h3 className="text-sm font-medium">
								{t("settings.workPolicies.regulationDefaults", "Regulation defaults")}
							</h3>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.workPolicies.regulationDefaultsDescription",
									"Edit limit hours and break rules before saving or importing.",
								)}
							</p>
						</div>

						<div className="grid gap-4 sm:grid-cols-3">
							<form.Field name="regulation.maxDailyMinutes">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="preset-review-max-daily-hours">Max daily hours</Label>
										<Input
											id="preset-review-max-daily-hours"
											name="preset-review-max-daily-hours"
											autoComplete="off"
											type="number"
											min="0"
											max="24"
											step="0.5"
											value={field.state.value ? field.state.value / 60 : ""}
											onBlur={field.handleBlur}
											onChange={(event) => {
												const hours = Number.parseFloat(event.target.value);
												field.handleChange(
													Number.isNaN(hours) ? undefined : Math.round(hours * 60),
												);
											}}
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="regulation.maxWeeklyMinutes">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="preset-review-max-weekly-hours">Max weekly hours</Label>
										<Input
											id="preset-review-max-weekly-hours"
											name="preset-review-max-weekly-hours"
											autoComplete="off"
											type="number"
											min="0"
											max="168"
											step="0.5"
											value={field.state.value ? field.state.value / 60 : ""}
											onBlur={field.handleBlur}
											onChange={(event) => {
												const hours = Number.parseFloat(event.target.value);
												field.handleChange(
													Number.isNaN(hours) ? undefined : Math.round(hours * 60),
												);
											}}
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="regulation.maxUninterruptedMinutes">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="preset-review-max-uninterrupted-hours">
											Max uninterrupted hours
										</Label>
										<Input
											id="preset-review-max-uninterrupted-hours"
											name="preset-review-max-uninterrupted-hours"
											autoComplete="off"
											type="number"
											min="0"
											max="24"
											step="0.5"
											value={field.state.value ? field.state.value / 60 : ""}
											onBlur={field.handleBlur}
											onChange={(event) => {
												const hours = Number.parseFloat(event.target.value);
												field.handleChange(
													Number.isNaN(hours) ? undefined : Math.round(hours * 60),
												);
											}}
										/>
									</div>
								)}
							</form.Field>
						</div>

						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<Label>{t("settings.timeRegulations.breakRules", "Break rules")}</Label>
								<form.Field name="regulation.breakRules">
									{(field) => (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => field.pushValue(defaultBreakRule)}
										>
											<IconPlus aria-hidden="true" className="mr-2 size-4" />
											{t("settings.timeRegulations.addBreakRule", "Add break rule")}
										</Button>
									)}
								</form.Field>
							</div>

							<form.Field name="regulation.breakRules" mode="array">
								{(rulesField) => (
									<div className="space-y-3">
										{rulesField.state.value?.length ? (
											rulesField.state.value.map((_, ruleIndex) => (
												<div
													key={ruleIndex}
													className="space-y-3 rounded-lg border bg-muted/20 p-3"
												>
													<div className="flex items-center justify-between">
														<p className="text-sm font-medium">Break rule {ruleIndex + 1}</p>
														<Button
															type="button"
															variant="ghost"
															size="icon"
															aria-label="Remove break rule"
															className="size-8 text-destructive hover:text-destructive"
															onClick={() => rulesField.removeValue(ruleIndex)}
														>
															<IconTrash aria-hidden="true" className="size-4" />
															<span className="sr-only">Remove break rule</span>
														</Button>
													</div>

													<div className="grid gap-4 sm:grid-cols-2">
														<form.Field
															name={`regulation.breakRules[${ruleIndex}].workingMinutesThreshold`}
														>
															{(field) => (
																<div className="space-y-2">
																	<Label htmlFor={`preset-review-break-threshold-${ruleIndex}`}>
																		After working hours
																	</Label>
																	<Input
																		id={`preset-review-break-threshold-${ruleIndex}`}
																		name={`preset-review-break-threshold-${ruleIndex}`}
																		autoComplete="off"
																		type="number"
																		min="0"
																		max="24"
																		step="0.5"
																		value={field.state.value ? field.state.value / 60 : ""}
																		onBlur={field.handleBlur}
																		onChange={(event) => {
																			const hours = Number.parseFloat(event.target.value);
																			field.handleChange(
																				Number.isNaN(hours) ? 0 : Math.round(hours * 60),
																			);
																		}}
																	/>
																</div>
															)}
														</form.Field>

														<form.Field
															name={`regulation.breakRules[${ruleIndex}].requiredBreakMinutes`}
														>
															{(field) => (
																<div className="space-y-2">
																	<Label htmlFor={`preset-review-break-required-${ruleIndex}`}>
																		Break required minutes
																	</Label>
																	<Input
																		id={`preset-review-break-required-${ruleIndex}`}
																		name={`preset-review-break-required-${ruleIndex}`}
																		autoComplete="off"
																		type="number"
																		min="0"
																		max="240"
																		value={field.state.value ?? ""}
																		onBlur={field.handleBlur}
																		onChange={(event) => {
																			const minutes = Number.parseInt(event.target.value, 10);
																			field.handleChange(Number.isNaN(minutes) ? 0 : minutes);
																		}}
																	/>
																</div>
															)}
														</form.Field>
													</div>

													<form.Field
														name={`regulation.breakRules[${ruleIndex}].options`}
														mode="array"
													>
														{(optionsField) => (
															<div className="space-y-2">
																<div className="flex items-center justify-between">
																	<Label>
																		{t("settings.timeRegulations.breakOptions", "Break options")}
																	</Label>
																	<Button
																		type="button"
																		variant="ghost"
																		size="sm"
																		onClick={() => optionsField.pushValue(defaultBreakOption)}
																	>
																		<IconPlus aria-hidden="true" className="mr-1 size-3" />
																		{t("settings.timeRegulations.addOption", "Add option")}
																	</Button>
																</div>

																{optionsField.state.value?.map((_, optionIndex) => (
																	<div
																		key={optionIndex}
																		className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
																	>
																		<form.Field
																			name={`regulation.breakRules[${ruleIndex}].options[${optionIndex}].splitCount`}
																		>
																			{(field) => (
																				<div className="space-y-2">
																					<Label
																						htmlFor={`preset-review-break-split-${ruleIndex}-${optionIndex}`}
																					>
																						Split count
																					</Label>
																					<Input
																						id={`preset-review-break-split-${ruleIndex}-${optionIndex}`}
																						name={`preset-review-break-split-${ruleIndex}-${optionIndex}`}
																						autoComplete="off"
																						type="number"
																						min="1"
																						value={field.state.value ?? ""}
																						onBlur={field.handleBlur}
																						onChange={(event) => {
																							const count = Number.parseInt(event.target.value, 10);
																							field.handleChange(
																								Number.isNaN(count) ? null : count,
																							);
																						}}
																					/>
																				</div>
																			)}
																		</form.Field>
																		<form.Field
																			name={`regulation.breakRules[${ruleIndex}].options[${optionIndex}].minimumSplitMinutes`}
																		>
																			{(field) => (
																				<div className="space-y-2">
																					<Label
																						htmlFor={`preset-review-break-min-split-${ruleIndex}-${optionIndex}`}
																					>
																						Min split minutes
																					</Label>
																					<Input
																						id={`preset-review-break-min-split-${ruleIndex}-${optionIndex}`}
																						name={`preset-review-break-min-split-${ruleIndex}-${optionIndex}`}
																						autoComplete="off"
																						type="number"
																						min="0"
																						value={field.state.value ?? ""}
																						onBlur={field.handleBlur}
																						onChange={(event) => {
																							const minutes = Number.parseInt(
																								event.target.value,
																								10,
																							);
																							field.handleChange(
																								Number.isNaN(minutes) ? null : minutes,
																							);
																						}}
																					/>
																				</div>
																			)}
																		</form.Field>
																		<form.Field
																			name={`regulation.breakRules[${ruleIndex}].options[${optionIndex}].minimumLongestSplitMinutes`}
																		>
																			{(field) => (
																				<div className="space-y-2">
																					<Label
																						htmlFor={`preset-review-break-longest-split-${ruleIndex}-${optionIndex}`}
																					>
																						Longest split minutes
																					</Label>
																					<Input
																						id={`preset-review-break-longest-split-${ruleIndex}-${optionIndex}`}
																						name={`preset-review-break-longest-split-${ruleIndex}-${optionIndex}`}
																						autoComplete="off"
																						type="number"
																						min="0"
																						value={field.state.value ?? ""}
																						onBlur={field.handleBlur}
																						onChange={(event) => {
																							const minutes = Number.parseInt(
																								event.target.value,
																								10,
																							);
																							field.handleChange(
																								Number.isNaN(minutes) ? null : minutes,
																							);
																						}}
																					/>
																				</div>
																			)}
																		</form.Field>
																		<Button
																			type="button"
																			variant="ghost"
																			size="icon"
																			aria-label="Remove break option"
																			className="self-end text-destructive hover:text-destructive"
																			onClick={() => optionsField.removeValue(optionIndex)}
																			disabled={(optionsField.state.value?.length ?? 0) <= 1}
																		>
																			<IconTrash aria-hidden="true" className="size-4" />
																			<span className="sr-only">Remove break option</span>
																		</Button>
																	</div>
																))}
															</div>
														)}
													</form.Field>
												</div>
											))
										) : (
											<p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
												{t("settings.timeRegulations.noBreakRules", "No break rules defined")}
											</p>
										)}
									</div>
								)}
							</form.Field>
						</div>
					</div>

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
							{isSubmitting && (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
							)}
							{t(`settings.workPolicies.${mode}.submit`, copy.submitLabel)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
