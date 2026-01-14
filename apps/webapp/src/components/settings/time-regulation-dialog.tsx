"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	createTimeRegulation,
	type TimeRegulationWithBreakRules,
	updateTimeRegulation,
} from "@/app/[locale]/(app)/settings/time-regulations/actions";
import { Button } from "@/components/ui/button";
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
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import {
	type BreakRuleFormValues,
	type TimeRegulationFormValues,
	timeRegulationFormSchema,
} from "@/lib/time-regulations/validation";
import { BreakRuleEditor } from "./break-rule-editor";

interface TimeRegulationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingRegulation: TimeRegulationWithBreakRules | null;
	onSuccess: () => void;
}

const defaultBreakRule: BreakRuleFormValues = {
	workingMinutesThreshold: 360, // 6 hours
	requiredBreakMinutes: 30,
	options: [
		{
			splitCount: 1,
			minimumSplitMinutes: null,
			minimumLongestSplitMinutes: null,
		},
	],
};

export function TimeRegulationDialog({
	open,
	onOpenChange,
	organizationId,
	editingRegulation,
	onSuccess,
}: TimeRegulationDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!editingRegulation;

	const form = useForm({
		defaultValues: {
			name: "",
			description: "",
			maxDailyMinutes: null as number | null,
			maxWeeklyMinutes: null as number | null,
			maxUninterruptedMinutes: null as number | null,
			breakRules: [] as BreakRuleFormValues[],
			isActive: true,
		},
		validators: {
			onChange: ({ value }) => {
				const result = timeRegulationFormSchema.safeParse(value);
				if (!result.success) {
					return result.error.issues[0]?.message || "Validation error";
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			if (isEditing) {
				updateMutation.mutate(value as TimeRegulationFormValues);
			} else {
				createMutation.mutate(value as TimeRegulationFormValues);
			}
		},
	});

	// Reset form when dialog opens/closes or when editing regulation changes
	useEffect(() => {
		if (open) {
			if (editingRegulation) {
				form.reset({
					name: editingRegulation.name,
					description: editingRegulation.description || "",
					maxDailyMinutes: editingRegulation.maxDailyMinutes,
					maxWeeklyMinutes: editingRegulation.maxWeeklyMinutes,
					maxUninterruptedMinutes: editingRegulation.maxUninterruptedMinutes,
					breakRules: (editingRegulation.breakRules || []).map((rule) => ({
						id: rule.id,
						workingMinutesThreshold: rule.workingMinutesThreshold,
						requiredBreakMinutes: rule.requiredBreakMinutes,
						options: (rule.options || []).map((opt) => ({
							id: opt.id,
							splitCount: opt.splitCount,
							minimumSplitMinutes: opt.minimumSplitMinutes,
							minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
						})),
					})),
					isActive: editingRegulation.isActive,
				});
			} else {
				form.reset({
					name: "",
					description: "",
					maxDailyMinutes: null,
					maxWeeklyMinutes: null,
					maxUninterruptedMinutes: null,
					breakRules: [],
					isActive: true,
				});
			}
		}
	}, [open, editingRegulation, form]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (data: TimeRegulationFormValues) => createTimeRegulation(organizationId, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.timeRegulations.created", "Regulation created"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.timeRegulations.createFailed", "Failed to create"));
			}
		},
		onError: () => {
			toast.error(t("settings.timeRegulations.createFailed", "Failed to create regulation"));
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: (data: TimeRegulationFormValues) =>
			updateTimeRegulation(editingRegulation!.id, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.timeRegulations.updated", "Regulation updated"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.timeRegulations.updateFailed", "Failed to update"));
			}
		},
		onError: () => {
			toast.error(t("settings.timeRegulations.updateFailed", "Failed to update regulation"));
		},
	});

	const isPending = createMutation.isPending || updateMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.timeRegulations.editRegulation", "Edit Regulation")
							: t("settings.timeRegulations.createRegulation", "Create Regulation")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.timeRegulations.regulationDescription",
							"Define working time limits and break requirements that can be assigned to your organization, teams, or employees.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-6"
				>
					{/* Basic Info */}
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="name">
							{(field) => (
								<TFormItem className="sm:col-span-2">
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.timeRegulations.name", "Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.timeRegulations.namePlaceholder",
												"e.g., German Labor Law",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="description">
							{(field) => (
								<TFormItem className="sm:col-span-2">
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.timeRegulations.descriptionLabel", "Description")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											value={field.state.value || ""}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.timeRegulations.descriptionPlaceholder",
												"Optional description of this regulation",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					{/* Working Time Limits */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium">
							{t("settings.timeRegulations.workingTimeLimits", "Working Time Limits")}
						</h3>
						<div className="grid gap-4 sm:grid-cols-3">
							<form.Field name="maxDailyMinutes">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.timeRegulations.maxDaily", "Max Daily")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<div className="flex items-center gap-2">
												<Input
													type="number"
													min="60"
													max="1440"
													value={field.state.value ? Math.floor(field.state.value / 60) : ""}
													onChange={(e) => {
														const hours = parseInt(e.target.value);
														field.handleChange(isNaN(hours) ? null : hours * 60);
													}}
													onBlur={field.handleBlur}
													placeholder="—"
													className="w-20"
												/>
												<span className="text-sm text-muted-foreground">hours</span>
											</div>
										</TFormControl>
										<TFormDescription>
											{t("settings.timeRegulations.maxDailyDescription", "Per day limit")}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="maxWeeklyMinutes">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.timeRegulations.maxWeekly", "Max Weekly")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<div className="flex items-center gap-2">
												<Input
													type="number"
													min="1"
													max="168"
													value={field.state.value ? Math.floor(field.state.value / 60) : ""}
													onChange={(e) => {
														const hours = parseInt(e.target.value);
														field.handleChange(isNaN(hours) ? null : hours * 60);
													}}
													onBlur={field.handleBlur}
													placeholder="—"
													className="w-20"
												/>
												<span className="text-sm text-muted-foreground">hours</span>
											</div>
										</TFormControl>
										<TFormDescription>
											{t("settings.timeRegulations.maxWeeklyDescription", "Per week limit")}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="maxUninterruptedMinutes">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.timeRegulations.maxUninterrupted", "Max Uninterrupted")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<div className="flex items-center gap-2">
												<Input
													type="number"
													min="0.5"
													max="12"
													step="0.5"
													value={field.state.value ? field.state.value / 60 : ""}
													onChange={(e) => {
														const hours = parseFloat(e.target.value);
														field.handleChange(isNaN(hours) ? null : Math.round(hours * 60));
													}}
													onBlur={field.handleBlur}
													placeholder="—"
													className="w-20"
												/>
												<span className="text-sm text-muted-foreground">hours</span>
											</div>
										</TFormControl>
										<TFormDescription>
											{t("settings.timeRegulations.maxUninterruptedDescription", "Without a break")}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						</div>
					</div>

					{/* Break Rules */}
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-medium">
								{t("settings.timeRegulations.breakRules", "Break Rules")}
							</h3>
							<form.Field name="breakRules">
								{(field) => (
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => {
											field.pushValue({ ...defaultBreakRule });
										}}
									>
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.timeRegulations.addBreakRule", "Add Break Rule")}
									</Button>
								)}
							</form.Field>
						</div>

						<form.Field name="breakRules" mode="array">
							{(field) => (
								<div className="space-y-4">
									{field.state.value.length === 0 ? (
										<div className="flex flex-col items-center justify-center py-8 text-center border rounded-lg border-dashed">
											<p className="text-sm text-muted-foreground">
												{t("settings.timeRegulations.noBreakRules", "No break rules defined")}
											</p>
											<p className="text-xs text-muted-foreground mt-1">
												{t(
													"settings.timeRegulations.noBreakRulesDescription",
													"Add break rules to define required breaks based on working time",
												)}
											</p>
										</div>
									) : (
										field.state.value.map((_, ruleIndex) => (
											<form.Field key={ruleIndex} name={`breakRules[${ruleIndex}]`}>
												{(ruleField) => (
													<BreakRuleEditor
														ruleIndex={ruleIndex}
														form={form}
														onRemove={() => field.removeValue(ruleIndex)}
													/>
												)}
											</form.Field>
										))
									)}
								</div>
							)}
						</form.Field>
					</div>

					{/* Active Status */}
					<form.Field name="isActive">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label>{t("settings.timeRegulations.active", "Active")}</Label>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.timeRegulations.activeDescription",
											"Inactive regulations won't be enforced",
										)}
									</p>
								</div>
								<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
							</div>
						)}
					</form.Field>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
							{([isSubmitting, canSubmit]) => (
								<Button type="submit" disabled={isPending || isSubmitting || !canSubmit}>
									{(isPending || isSubmitting) && (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
