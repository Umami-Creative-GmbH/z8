"use client";

import { ClientForm } from "@/components/ui/client-form";
import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
} from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	copySystemWorkPolicyPreset,
	createWorkPolicyFromPreset,
	createWorkPolicyPreset,
	updateWorkPolicyPreset,
	type WorkPolicyPresetInput,
	type WorkPolicyPresetWithSource,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
	actionErrorMessage,
	type RefusalOverrides,
} from "@/lib/organization-action/action-error-message";
import { runWithBusyState } from "../run-with-busy-state";
import { buildPresetReviewValues } from "./work-policy-preset-utils";
import { WORK_POLICY_PRESET_REFUSALS, WORK_POLICY_REFUSALS } from "./work-policy-refusals";

type ReviewMode = "createCustom" | "editCustom" | "copySystem" | "useAsPolicy";

/** A preset mode submitted without a selected preset; refused before any action runs. */
const NO_PRESET = "no_preset";

/** A name conflict is the policy's when one is created from the preset, else the preset's. */
function presetReviewRefusals(mode: ReviewMode): RefusalOverrides {
	return {
		...(mode === "useAsPolicy" ? WORK_POLICY_REFUSALS : WORK_POLICY_PRESET_REFUSALS),
		[NO_PRESET]: ["settings.workPolicies.presetReview.selectPreset", "Select a preset to continue"],
	};
}

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

type WorkPolicyPresetForm = ReactFormExtendedApi<
	WorkPolicyPresetInput,
	FormValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormAsyncValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormAsyncValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormAsyncValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormAsyncValidateOrFn<WorkPolicyPresetInput> | undefined,
	FormAsyncValidateOrFn<WorkPolicyPresetInput> | undefined,
	unknown
>;

type TranslationFunction = ReturnType<typeof useTranslate>["t"];

interface PresetFormSectionProps {
	form: WorkPolicyPresetForm;
	t: TranslationFunction;
}

function getInitialValues(
	mode: ReviewMode,
	t: TranslationFunction,
	preset?: WorkPolicyPresetWithSource | null,
): WorkPolicyPresetInput {
	const values = buildPresetReviewValues(preset);
	return {
		...values,
		name:
			mode === "copySystem" && values.name
				? t("settings.workPolicies.presetReview.copyName", "{name} Copy", {
						name: values.name,
					})
				: values.name,
		description: values.description ?? "",
	};
}

function getDialogCopy(mode: ReviewMode, t: TranslationFunction) {
	switch (mode) {
		case "editCustom":
			return {
				title: t("settings.workPolicies.editCustom.title", "Edit custom preset"),
				description: t(
					"settings.workPolicies.editCustom.description",
					"Review this preset before saving your changes.",
				),
				submitLabel: t("settings.workPolicies.editCustom.submit", "Save custom preset"),
				success: t("settings.workPolicies.editCustom.success", "Preset updated"),
			};
		case "copySystem":
			return {
				title: t("settings.workPolicies.copySystem.title", "Copy system preset"),
				description: t(
					"settings.workPolicies.copySystem.description",
					"Review the system preset and save it as a custom preset.",
				),
				submitLabel: t("settings.workPolicies.copySystem.submit", "Save custom preset"),
				success: t("settings.workPolicies.copySystem.success", "Preset copied"),
			};
		case "useAsPolicy":
			return {
				title: t("settings.workPolicies.useAsPolicy.title", "Create policy from preset"),
				description: t(
					"settings.workPolicies.useAsPolicy.description",
					"Review the preset values before creating a work policy.",
				),
				submitLabel: t("settings.workPolicies.useAsPolicy.submit", "Create policy"),
				success: t("settings.workPolicies.useAsPolicy.success", "Policy created"),
			};
		default:
			return {
				title: t("settings.workPolicies.createCustom.title", "Create custom preset"),
				description: t(
					"settings.workPolicies.createCustom.description",
					"Review and save reusable policy defaults for your organization.",
				),
				submitLabel: t("settings.workPolicies.createCustom.submit", "Save custom preset"),
				success: t("settings.workPolicies.createCustom.success", "Preset created"),
			};
	}
}

export function WorkPolicyPresetReviewDialog(props: WorkPolicyPresetReviewDialogProps) {
	const { open, mode, preset } = props;
	const formKey = open ? `${mode}:${preset?.id ?? "new"}:open` : "closed";

	return <WorkPolicyPresetReviewDialogContent key={formKey} {...props} />;
}

function WorkPolicyPresetReviewDialogContent({
	open,
	onOpenChange,
	mode,
	preset,
	onSuccess,
}: WorkPolicyPresetReviewDialogProps) {
	const { t } = useTranslate();
	const [serverError, setServerError] = useState<string | null>(null);
	const [setAsDefault, setSetAsDefault] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const copy = getDialogCopy(mode, t);

	const form = useForm({
		defaultValues: getInitialValues(mode, t, preset),
		onSubmit: async ({ value }) => {
			setServerError(null);

			const reviewedValue: WorkPolicyPresetInput = {
				...value,
				name: value.name.trim(),
				description: value.description?.trim() || undefined,
				countryCode: value.countryCode?.trim() || null,
			};

			await runWithBusyState(setIsSubmitting, async () => {
				try {
					const result = await (async () => {
						if (mode === "createCustom") {
							return createWorkPolicyPreset(reviewedValue);
						}

						if (!preset) {
							return { success: false, code: NO_PRESET } as const;
						}

						if (mode === "editCustom") {
							return updateWorkPolicyPreset({ presetId: preset.id, input: reviewedValue });
						}

						if (mode === "copySystem") {
							return copySystemWorkPolicyPreset({ presetId: preset.id, input: reviewedValue });
						}

						return createWorkPolicyFromPreset({
							presetId: preset.id,
							input: reviewedValue,
							setAsDefault,
						});
					})();

					if (result.success) {
						toast.success(copy.success);
						onSuccess();
						onOpenChange(false);
						return;
					}

					setServerError(
						actionErrorMessage(t, result, presetReviewRefusals(mode), [
							"settings.workPolicies.presetReviewError",
							"Failed to save preset",
						]),
					);
				} catch {
					setServerError(t("settings.workPolicies.presetReviewError", "Failed to save preset"));
				}
			});
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (nextOpen) {
			form.reset(getInitialValues(mode, t, preset));
		}
		onOpenChange(nextOpen);
	}

	return (
		<ActionPanel
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && isSubmitting) return;
				handleOpenChange(nextOpen);
			}}
		>
			<ActionPanelContent
				size="wide"
				className="overscroll-contain"
				showCloseButton={!isSubmitting}
				onEscapeKeyDown={(event) => {
					if (isSubmitting) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (isSubmitting) event.preventDefault();
				}}
			>
				<ActionPanelHeader>
					<ActionPanelTitle>{copy.title}</ActionPanelTitle>
					<ActionPanelDescription>{copy.description}</ActionPanelDescription>
				</ActionPanelHeader>

				<ClientForm
					className="flex min-h-0 flex-1 flex-col"
					noValidate
					stopPropagation
					onSubmit={() => {
						// Enter in a field submits too; never start a second save while one is running.
						if (!isSubmitting) form.handleSubmit();
					}}
				>
					<ActionPanelBody className="space-y-5">
						{serverError && (
							<Alert variant="destructive" aria-live="polite">
								<AlertDescription>{serverError}</AlertDescription>
							</Alert>
						)}

						<PresetIdentityFields form={form} t={t} />
						<PresetEnablementFields form={form} t={t} />
						<ScheduleDefaultsSection form={form} t={t} />
						<RegulationDefaultsSection form={form} t={t} />
						<UseAsPolicyDefaultField
							mode={mode}
							setAsDefault={setAsDefault}
							onSetAsDefaultChange={setSetAsDefault}
							t={t}
						/>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							disabled={isSubmitting}
							onClick={() => onOpenChange(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting || undefined}>
							{isSubmitting && (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
							)}
							{copy.submitLabel}
						</Button>
					</ActionPanelFooter>
				</ClientForm>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function ScheduleDefaultsSection({ form, t }: PresetFormSectionProps) {
	return (
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
										value as NonNullable<WorkPolicyPresetInput["schedule"]>["workingDaysPreset"],
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
	);
}

function RegulationDefaultsSection({ form, t }: PresetFormSectionProps) {
	return (
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
							<Label htmlFor="preset-review-max-daily-hours">
								{t("settings.workPolicies.presetReview.maxDailyHours", "Max daily hours")}
							</Label>
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
									field.handleChange(Number.isNaN(hours) ? undefined : Math.round(hours * 60));
								}}
							/>
						</div>
					)}
				</form.Field>

				<form.Field name="regulation.maxWeeklyMinutes">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="preset-review-max-weekly-hours">
								{t("settings.workPolicies.presetReview.maxWeeklyHours", "Max weekly hours")}
							</Label>
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
									field.handleChange(Number.isNaN(hours) ? undefined : Math.round(hours * 60));
								}}
							/>
						</div>
					)}
				</form.Field>

				<form.Field name="regulation.maxUninterruptedMinutes">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="preset-review-max-uninterrupted-hours">
								{t(
									"settings.workPolicies.presetReview.maxUninterruptedHours",
									"Max uninterrupted hours",
								)}
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
									field.handleChange(Number.isNaN(hours) ? undefined : Math.round(hours * 60));
								}}
							/>
						</div>
					)}
				</form.Field>
			</div>

			<BreakRulesField form={form} t={t} />
		</div>
	);
}

function BreakRulesField({ form, t }: PresetFormSectionProps) {
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<h4 className="text-sm font-medium">
					{t("settings.timeRegulations.breakRules", "Break rules")}
				</h4>
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
							rulesField.state.value.map((_rule, ruleIndex) => (
								<div
									// Keyed by position, like the form's own `breakRules[i]` field names: a
									// value-based key remounted the rule on every keystroke and dropped focus.
									// oxlint-disable-next-line react/no-array-index-key -- rows are addressed by index
									key={`break-rule-${ruleIndex}`}
									className="space-y-3 rounded-lg border bg-muted/20 p-3"
								>
									<div className="flex items-center justify-between">
										<p className="text-sm font-medium">
											{t(
												"settings.workPolicies.presetReview.breakRuleNumber",
												"Break rule {number}",
												{ number: ruleIndex + 1 },
											)}
										</p>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											aria-label={t(
												"settings.workPolicies.presetReview.removeBreakRuleNumber",
												"Remove break rule {number}",
												{ number: ruleIndex + 1 },
											)}
											className="size-8 text-destructive hover:text-destructive"
											onClick={() => rulesField.removeValue(ruleIndex)}
										>
											<IconTrash aria-hidden="true" className="size-4" />
										</Button>
									</div>

									<div className="grid gap-4 sm:grid-cols-2">
										<form.Field
											name={`regulation.breakRules[${ruleIndex}].workingMinutesThreshold`}
										>
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={`preset-review-break-threshold-${ruleIndex}`}>
														{t(
															"settings.workPolicies.presetReview.afterWorkingHours",
															"After working hours",
														)}
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
															field.handleChange(Number.isNaN(hours) ? 0 : Math.round(hours * 60));
														}}
													/>
												</div>
											)}
										</form.Field>

										<form.Field name={`regulation.breakRules[${ruleIndex}].requiredBreakMinutes`}>
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={`preset-review-break-required-${ruleIndex}`}>
														{t(
															"settings.workPolicies.presetReview.breakRequiredMinutes",
															"Break required minutes",
														)}
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

									<form.Field name={`regulation.breakRules[${ruleIndex}].options`} mode="array">
										{(optionsField) => (
											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<p className="text-sm font-medium">
														{t("settings.timeRegulations.breakOptions", "Break options")}
													</p>
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

												{optionsField.state.value?.map((_option, optionIndex) => (
													<div
														// oxlint-disable-next-line react/no-array-index-key -- options are addressed by index, like their field names
														key={`break-option-${optionIndex}`}
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
																		{t(
																			"settings.workPolicies.presetReview.splitCount",
																			"Split count",
																		)}
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
																			field.handleChange(Number.isNaN(count) ? null : count);
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
																		{t(
																			"settings.workPolicies.presetReview.minSplitMinutes",
																			"Min split minutes",
																		)}
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
																			const minutes = Number.parseInt(event.target.value, 10);
																			field.handleChange(Number.isNaN(minutes) ? null : minutes);
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
																		{t(
																			"settings.workPolicies.presetReview.longestSplitMinutes",
																			"Longest split minutes",
																		)}
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
																			const minutes = Number.parseInt(event.target.value, 10);
																			field.handleChange(Number.isNaN(minutes) ? null : minutes);
																		}}
																	/>
																</div>
															)}
														</form.Field>
														<Button
															type="button"
															variant="ghost"
															size="icon"
															aria-label={t(
																"settings.workPolicies.presetReview.removeBreakOptionNumber",
																"Remove option {option} of break rule {rule}",
																{ option: optionIndex + 1, rule: ruleIndex + 1 },
															)}
															className="self-end text-destructive hover:text-destructive"
															onClick={() => optionsField.removeValue(optionIndex)}
															disabled={(optionsField.state.value?.length ?? 0) <= 1}
														>
															<IconTrash aria-hidden="true" className="size-4" />
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
	);
}

function UseAsPolicyDefaultField({
	mode,
	setAsDefault,
	onSetAsDefaultChange,
	t,
}: {
	mode: ReviewMode;
	setAsDefault: boolean;
	onSetAsDefaultChange: (checked: boolean) => void;
	t: TranslationFunction;
}) {
	if (mode !== "useAsPolicy") return null;

	return (
		<div className="flex items-center gap-2 rounded-lg border p-4">
			<Checkbox
				id="preset-review-set-default"
				checked={setAsDefault}
				onCheckedChange={(checked) => onSetAsDefaultChange(checked === true)}
			/>
			<Label htmlFor="preset-review-set-default">
				{t("settings.workPolicies.setAsDefault", "Set as organization default")}
			</Label>
		</div>
	);
}

function PresetIdentityFields({ form, t }: PresetFormSectionProps) {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<form.Field
				name="name"
				validators={{
					onChange: ({ value }) => {
						// Mirrors the server, which trims the name and requires one character.
						if (!value.trim()) {
							return t("settings.workPolicies.presetReview.nameRequired", "Enter a name");
						}
						if (value.length > 100) {
							return t("settings.workPolicies.nameTooLong", "Use 100 characters or fewer");
						}
						return undefined;
					},
				}}
			>
				{(field) => {
					const error = field.state.meta.errors[0];
					return (
						<div className="space-y-2 sm:col-span-2">
							<Label htmlFor="preset-review-name">{t("settings.workPolicies.name", "Name")}</Label>
							<Input
								id="preset-review-name"
								name="preset-review-name"
								autoComplete="off"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								aria-invalid={error ? true : undefined}
								aria-describedby={error ? "preset-review-name-error" : undefined}
							/>
							{error ? (
								<p id="preset-review-name-error" role="alert" className="text-sm text-destructive">
									{String(error)}
								</p>
							) : null}
						</div>
					);
				}}
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
	);
}

function PresetEnablementFields({ form, t }: PresetFormSectionProps) {
	return (
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
	);
}
