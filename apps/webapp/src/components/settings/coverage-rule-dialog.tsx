"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	createCoverageRule,
	updateCoverageRule,
} from "@/app/[locale]/(app)/settings/coverage-rules/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TimeInput } from "@/components/ui/time-input";
import { useEditSession } from "@/hooks/use-edit-session";
import type { CoverageRuleWithRelations } from "@/lib/effect/services/coverage.service";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { DayOfWeek } from "@/lib/validations/coverage";
import {
	type CoverageRuleFieldError,
	coverageRuleEndTimeError,
	coverageRuleStaffCountError,
	coverageRuleStartTimeError,
	coverageRuleSubareaError,
	MAX_STAFF_COUNT,
	MIN_STAFF_COUNT,
} from "./coverage-rule-validation";

/** The first message a field's validators returned. */
function firstFieldError(errors: unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string" && error.length > 0);
}

function FieldErrorText({ id, error }: { id: string; error?: string }) {
	if (!error) return null;
	return (
		<p id={id} role="alert" className="text-destructive text-sm">
			{error}
		</p>
	);
}

interface CoverageRuleDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	locations: Array<{
		id: string;
		name: string;
		subareas: Array<{
			id: string;
			name: string;
			isActive: boolean;
		}>;
	}>;
	requireScopedSubareaSelection: boolean;
	editingRule: CoverageRuleWithRelations | null;
	onSuccess: () => void;
}

function daysOfWeek(
	t: ReturnType<typeof useTranslate>["t"],
): { value: DayOfWeek; label: string }[] {
	return [
		{ value: "monday", label: t("common.days.monday", "Monday") },
		{ value: "tuesday", label: t("common.days.tuesday", "Tuesday") },
		{ value: "wednesday", label: t("common.days.wednesday", "Wednesday") },
		{ value: "thursday", label: t("common.days.thursday", "Thursday") },
		{ value: "friday", label: t("common.days.friday", "Friday") },
		{ value: "saturday", label: t("common.days.saturday", "Saturday") },
		{ value: "sunday", label: t("common.days.sunday", "Sunday") },
	];
}

function useCoverageRuleForm({
		open,
		locations,
		requireScopedSubareaSelection,
		editingRule,
		onSuccess,
	}: CoverageRuleDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!editingRule;

	// Build flat list of subareas with location names
	const subareaOptions = locations.flatMap((loc) =>
		loc.subareas.flatMap((sub) =>
			sub.isActive
				? [
						{
							id: sub.id,
							name: sub.name,
							locationName: loc.name,
							locationId: loc.id,
						},
					]
				: [],
		),
	);
	const defaultSubareaId = subareaOptions[0]?.id || "";

	// Form
	const form = useForm({
		defaultValues: {
			subareaId: editingRule?.subareaId || (requireScopedSubareaSelection ? defaultSubareaId : ""),
			dayOfWeek: (editingRule?.dayOfWeek || "monday") as DayOfWeek,
			startTime: editingRule?.startTime || "09:00",
			endTime: editingRule?.endTime || "17:00",
			minimumStaffCount: editingRule?.minimumStaffCount || 1,
		},
		onSubmit: async ({ value }) => {
			if (isEditing) {
				await updateMutation.mutateAsync({ ruleId: editingRule.id, data: value });
			} else {
				await createMutation.mutateAsync(value);
			}
		},
	});

	// Reset form when dialog opens/closes or editing rule changes
	useEditSession({
		open,
		scope: editingRule?.id ?? "create",
		initialize: () => {
		if (open) {
			form.reset({
				subareaId:
					editingRule?.subareaId || (requireScopedSubareaSelection ? defaultSubareaId : ""),
				dayOfWeek: (editingRule?.dayOfWeek || "monday") as DayOfWeek,
				startTime: editingRule?.startTime || "09:00",
				endTime: editingRule?.endTime || "17:00",
				minimumStaffCount: editingRule?.minimumStaffCount || 1,
			});
		}
	},
	});

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async (data: {
			subareaId: string;
			dayOfWeek: DayOfWeek;
			startTime: string;
			endTime: string;
			minimumStaffCount: number;
			priority?: number;
		}) => {
			const result = await createCoverageRule(data);
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.coverageRules.createFailed",
						"Failed to create rule",
					]),
				);
			}
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries();
			toast.success(t("settings.coverageRules.ruleCreated", "Coverage rule created"));
			onSuccess();
		},
		onError: (error) => {
			toast.error(
				error.message || t("settings.coverageRules.createFailed", "Failed to create rule"),
			);
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: async ({
			ruleId,
			data,
		}: {
			ruleId: string;
			data: {
				subareaId: string;
				dayOfWeek: DayOfWeek;
				startTime: string;
				endTime: string;
				minimumStaffCount: number;
				priority?: number;
			};
		}) => {
			const result = await updateCoverageRule({ ruleId, data });
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.coverageRules.updateFailed",
						"Failed to update rule",
					]),
				);
			}
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries();
			toast.success(t("settings.coverageRules.ruleUpdated", "Coverage rule updated"));
			onSuccess();
		},
		onError: (error) => {
			toast.error(
				error.message || t("settings.coverageRules.updateFailed", "Failed to update rule"),
			);
		},
	});

	const isSubmitting = createMutation.isPending || updateMutation.isPending;

	// The messages of the checks the server also makes (coverage-rule-validation).
	const errorText = (error: CoverageRuleFieldError | undefined) => {
		switch (error) {
			case "subareaRequired":
				return t("settings.coverageRules.errors.subareaRequired", "Select a subarea.");
			case "invalidTime":
				return t(
					"settings.coverageRules.errors.invalidTime",
					"Enter a time in 24-hour HH:mm format.",
				);
			case "endNotAfterStart":
				return t(
					"settings.coverageRules.errors.endNotAfterStart",
					"End time must be after the start time on the same day.",
				);
			case "staffCountRange":
				return t(
					"settings.coverageRules.errors.staffCountRange",
					"Enter a whole number from 1 to 100.",
				);
			default:
				return undefined;
		}
	};
	return {
		t,
		isEditing,
		subareaOptions,
		form,
		isSubmitting,
		errorText,
	};
}

export function CoverageRuleDialog(props: CoverageRuleDialogProps) {
	const { open, onOpenChange } = props;
	const {
		t,
		isEditing,
		subareaOptions,
		form,
		isSubmitting,
		errorText,
	} =
		useCoverageRuleForm(props);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.coverageRules.editRule", "Edit Coverage Rule")
							: t("settings.coverageRules.createRule", "Create Coverage Rule")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.coverageRules.ruleDialogDescription",
							"Define the minimum staffing requirement for a specific location, day, and time block.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="grid gap-4">
						{/* Subarea Select */}
						<form.Field
							name="subareaId"
							validators={{
								onChange: ({ value }) => errorText(coverageRuleSubareaError(value)),
							}}
						>
							{(field) => {
								const error = firstFieldError(field.state.meta.errors);
								return (
									<div className="grid gap-2">
										<Label htmlFor="subareaId">
											{t("settings.coverageRules.subarea", "Location / Subarea")}
										</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger
												id="subareaId"
												aria-invalid={error ? true : undefined}
												aria-describedby={error ? "coverage-rule-subarea-error" : undefined}
											>
												<SelectValue
													placeholder={t("settings.coverageRules.selectSubarea", "Select a subarea")}
												/>
											</SelectTrigger>
											<SelectContent>
												{subareaOptions.map((opt) => (
													<SelectItem key={opt.id} value={opt.id}>
														{opt.locationName} - {opt.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FieldErrorText id="coverage-rule-subarea-error" error={error} />
									</div>
								);
							}}
						</form.Field>

						{/* Day of Week Select */}
						<form.Field name="dayOfWeek">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="dayOfWeek">
										{t("settings.coverageRules.dayOfWeek", "Day of Week")}
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(v) => field.handleChange(v as DayOfWeek)}
									>
										<SelectTrigger id="dayOfWeek">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{daysOfWeek(t).map((day) => (
												<SelectItem key={day.value} value={day.value}>
													{day.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{/* Time Range */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field
								name="startTime"
								validators={{
									onChange: ({ value }) => errorText(coverageRuleStartTimeError(value)),
								}}
							>
								{(field) => {
									const error = firstFieldError(field.state.meta.errors);
									return (
										<div className="grid content-start gap-2">
											<Label htmlFor="startTime">
												{t("settings.coverageRules.startTime", "Start Time")}
											</Label>
											<TimeInput
												id="startTime"
												value={field.state.value}
												aria-invalid={error ? true : undefined}
												aria-describedby={error ? "coverage-rule-start-time-error" : undefined}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											<FieldErrorText id="coverage-rule-start-time-error" error={error} />
										</div>
									);
								}}
							</form.Field>

							<form.Field
								name="endTime"
								validators={{
									// The order of start and end is checked on the end field.
									onChangeListenTo: ["startTime"],
									onChange: ({ value, fieldApi }) =>
										errorText(
											coverageRuleEndTimeError(value, fieldApi.form.getFieldValue("startTime")),
										),
								}}
							>
								{(field) => {
									const error = firstFieldError(field.state.meta.errors);
									return (
										<div className="grid content-start gap-2">
											<Label htmlFor="endTime">
												{t("settings.coverageRules.endTime", "End Time")}
											</Label>
											<TimeInput
												id="endTime"
												value={field.state.value}
												aria-invalid={error ? true : undefined}
												aria-describedby={error ? "coverage-rule-end-time-error" : undefined}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											<FieldErrorText id="coverage-rule-end-time-error" error={error} />
										</div>
									);
								}}
							</form.Field>
						</div>

						{/* Minimum Staff Count */}
						<form.Field
							name="minimumStaffCount"
							validators={{
								onChange: ({ value }) => errorText(coverageRuleStaffCountError(value)),
							}}
						>
							{(field) => {
								const error = firstFieldError(field.state.meta.errors);
								return (
									<div className="grid gap-2">
										<Label htmlFor="minimumStaffCount">
											{t("settings.coverageRules.minimumStaffCount", "Minimum Staff Count")}
										</Label>
										<Input
											id="minimumStaffCount"
											type="number"
											inputMode="numeric"
											min={MIN_STAFF_COUNT}
											max={MAX_STAFF_COUNT}
											step={1}
											className="tabular-nums"
											// An emptied field stays empty (and invalid) instead of jumping to 1.
											value={Number.isNaN(field.state.value) ? "" : field.state.value}
											aria-invalid={error ? true : undefined}
											aria-describedby={
												error
													? "coverage-rule-staff-count-hint coverage-rule-staff-count-error"
													: "coverage-rule-staff-count-hint"
											}
											onChange={(e) =>
												field.handleChange(
													e.target.value === "" ? Number.NaN : Number(e.target.value),
												)
											}
											onBlur={field.handleBlur}
										/>
										<FieldErrorText id="coverage-rule-staff-count-error" error={error} />
										<p id="coverage-rule-staff-count-hint" className="text-muted-foreground text-sm">
											{t(
												"settings.coverageRules.minimumStaffHint",
												"The minimum number of staff required during this time block.",
											)}
										</p>
									</div>
								);
							}}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.canSubmit}>
							{(canSubmit) => (
								<Button
									type="submit"
									// Invalid fields block the submit until corrected; a first
									// submit validates every field and shows its message inline.
									disabled={isSubmitting || !canSubmit}
								>
									{isSubmitting
										? t("common.saving", "Saving...")
										: isEditing
											? t("common.save", "Save")
											: t("common.create", "Create")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
