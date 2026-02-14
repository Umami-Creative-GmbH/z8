"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
	createWorkPolicy,
	updateWorkPolicy,
	type WorkPolicyWithDetails,
	type BreakRuleInput,
	type ScheduleDayInput,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import {
	generateDaysFromPreset,
	WorkSchedulePreview,
} from "@/components/settings/work-policy-preview";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BreakRuleEditor } from "./break-rule-editor";

interface WorkPolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingPolicy: WorkPolicyWithDetails | null;
	onSuccess: () => void;
}

const DAYS_OF_WEEK = [
	{ value: "monday", label: "Monday" },
	{ value: "tuesday", label: "Tuesday" },
	{ value: "wednesday", label: "Wednesday" },
	{ value: "thursday", label: "Thursday" },
	{ value: "friday", label: "Friday" },
	{ value: "saturday", label: "Saturday" },
	{ value: "sunday", label: "Sunday" },
] as const;

type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

const defaultDays: ScheduleDayInput[] = DAYS_OF_WEEK.map((day) => ({
	dayOfWeek: day.value,
	hoursPerDay: day.value === "saturday" || day.value === "sunday" ? "0" : "8",
	isWorkDay: day.value !== "saturday" && day.value !== "sunday",
	cycleWeek: 1,
}));

const defaultBreakRule: BreakRuleInput = {
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

// Type definitions for form
type ScheduleCycleType = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
type ScheduleTypeType = "simple" | "detailed";
type WorkingDaysPresetType = "weekdays" | "weekends" | "all_days" | "custom";

const formDefaultValues = {
	name: "",
	description: "",
	scheduleEnabled: true,
	regulationEnabled: false,
	presenceEnabled: false,
	scheduleCycle: "weekly" as ScheduleCycleType,
	scheduleType: "simple" as ScheduleTypeType,
	workingDaysPreset: "weekdays" as WorkingDaysPresetType,
	hoursPerCycle: "40",
	homeOfficeDaysPerCycle: 0,
	days: defaultDays,
	maxDailyMinutes: null as number | null,
	maxWeeklyMinutes: null as number | null,
	maxUninterruptedMinutes: null as number | null,
	breakRules: [] as BreakRuleInput[],
};

export function WorkPolicyDialog({
	open,
	onOpenChange,
	organizationId,
	editingPolicy,
	onSuccess,
}: WorkPolicyDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!editingPolicy;

	const form = useForm({
		defaultValues: formDefaultValues,
		onSubmit: async ({ value }) => {
		const input = {
				name: value.name,
				description: value.description || undefined,
				scheduleEnabled: value.scheduleEnabled,
				regulationEnabled: value.regulationEnabled,
				presenceEnabled: value.presenceEnabled,
				schedule: value.scheduleEnabled
					? {
							scheduleCycle: value.scheduleCycle,
							scheduleType: value.scheduleType,
							workingDaysPreset:
								value.scheduleType === "detailed" ? ("custom" as const) : value.workingDaysPreset,
							hoursPerCycle: value.scheduleType === "simple" ? value.hoursPerCycle : undefined,
							homeOfficeDaysPerCycle: value.homeOfficeDaysPerCycle,
							days: value.scheduleType === "detailed" ? value.days : undefined,
						}
					: undefined,
				regulation: value.regulationEnabled
					? {
							maxDailyMinutes: value.maxDailyMinutes ?? undefined,
							maxWeeklyMinutes: value.maxWeeklyMinutes ?? undefined,
							maxUninterruptedMinutes: value.maxUninterruptedMinutes ?? undefined,
							breakRules: value.breakRules,
						}
					: undefined,
			};

			if (isEditing) {
				updateMutation.mutate(input);
			} else {
				createMutation.mutate(input);
			}
		},
	});

	// Reset form when opening or editing policy changes
	useEffect(() => {
		if (open) {
			if (editingPolicy) {
				form.reset();
				form.setFieldValue("name", editingPolicy.name);
				form.setFieldValue("description", editingPolicy.description || "");
				form.setFieldValue("scheduleEnabled", editingPolicy.scheduleEnabled);
				form.setFieldValue("regulationEnabled", editingPolicy.regulationEnabled);

				// Schedule fields
				if (editingPolicy.schedule) {
					form.setFieldValue("scheduleCycle", editingPolicy.schedule.scheduleCycle);
					form.setFieldValue("scheduleType", editingPolicy.schedule.scheduleType);
					form.setFieldValue("workingDaysPreset", editingPolicy.schedule.workingDaysPreset);
					form.setFieldValue("hoursPerCycle", editingPolicy.schedule.hoursPerCycle || "40");
					form.setFieldValue(
						"homeOfficeDaysPerCycle",
						editingPolicy.schedule.homeOfficeDaysPerCycle || 0,
					);
					form.setFieldValue(
						"days",
						editingPolicy.schedule.days.length > 0
							? editingPolicy.schedule.days.map((d) => ({
									dayOfWeek: d.dayOfWeek as DayOfWeek,
									hoursPerDay: d.hoursPerDay,
									isWorkDay: d.isWorkDay,
									cycleWeek: d.cycleWeek ?? 1,
								}))
							: defaultDays,
					);
				}

				// Regulation fields
				if (editingPolicy.regulation) {
					form.setFieldValue("maxDailyMinutes", editingPolicy.regulation.maxDailyMinutes);
					form.setFieldValue("maxWeeklyMinutes", editingPolicy.regulation.maxWeeklyMinutes);
					form.setFieldValue(
						"maxUninterruptedMinutes",
						editingPolicy.regulation.maxUninterruptedMinutes,
					);
					form.setFieldValue(
						"breakRules",
						(editingPolicy.regulation.breakRules || []).map((rule) => ({
							workingMinutesThreshold: rule.workingMinutesThreshold,
							requiredBreakMinutes: rule.requiredBreakMinutes,
							options: (rule.options || []).map((opt) => ({
								splitCount: opt.splitCount,
								minimumSplitMinutes: opt.minimumSplitMinutes,
								minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
							})),
						})),
					);
				}
			} else {
				form.reset();
			}
		}
	}, [open, editingPolicy, form]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (data: Parameters<typeof createWorkPolicy>[1]) =>
			createWorkPolicy(organizationId, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.created", "Policy created"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.workPolicies.createFailed", "Failed to create"));
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.createFailed", "Failed to create policy"));
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: (data: Parameters<typeof updateWorkPolicy>[1]) =>
			updateWorkPolicy(editingPolicy!.id, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.updated", "Policy updated"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.workPolicies.updateFailed", "Failed to update"));
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.updateFailed", "Failed to update policy"));
		},
	});

	const isPending = createMutation.isPending || updateMutation.isPending;

	// Subscribe to form values for conditional rendering
	const scheduleEnabled = useStore(form.store, (state) => state.values.scheduleEnabled);
	const regulationEnabled = useStore(form.store, (state) => state.values.regulationEnabled);
	const scheduleType = useStore(form.store, (state) => state.values.scheduleType);
	const days = useStore(form.store, (state) => state.values.days) || defaultDays;
	const workingDaysPreset = useStore(form.store, (state) => state.values.workingDaysPreset);
	const hoursPerCycle = useStore(form.store, (state) => state.values.hoursPerCycle);
	const scheduleCycle = useStore(form.store, (state) => state.values.scheduleCycle);
	const homeOfficeDaysPerCycle = useStore(
		form.store,
		(state) => state.values.homeOfficeDaysPerCycle,
	);
	const breakRules = useStore(form.store, (state) => state.values.breakRules);

	// Calculate total hours for detailed mode
	const totalHours = days
		.filter((d) => d.isWorkDay)
		.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);

	// Generate preview days based on schedule type
	const previewDays = useMemo(() => {
		if (scheduleType === "detailed") {
			return days;
		}
		const generatedDays = generateDaysFromPreset(workingDaysPreset);
		const workDayCount = generatedDays.filter((d) => d.isWorkDay).length;
		const hoursPerDay =
			workDayCount > 0 ? (parseFloat(hoursPerCycle || "40") / workDayCount).toFixed(1) : "0";
		return generatedDays.map((d) => ({
			...d,
			hoursPerDay: d.isWorkDay ? hoursPerDay : "0",
		}));
	}, [scheduleType, days, workingDaysPreset, hoursPerCycle]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.workPolicies.editPolicy", "Edit Policy")
							: t("settings.workPolicies.createPolicy", "Create Policy")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.workPolicies.policyDescription",
							"Define work schedules and time regulations that can be assigned to your organization, teams, or employees.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-6"
				>
					{/* Basic Info */}
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field
							name="name"
							validators={{
								onChange: ({ value }) => {
									if (!value) return "Name is required";
									if (value.length > 100) return "Name too long";
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2 sm:col-span-2">
									<Label>{t("settings.workPolicies.name", "Name")}</Label>
									<Input
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.workPolicies.namePlaceholder",
											"e.g., Full-Time Germany",
										)}
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
									<Label>{t("settings.workPolicies.descriptionLabel", "Description")}</Label>
									<Textarea
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.workPolicies.descriptionPlaceholder",
											"Optional description",
										)}
									/>
								</div>
							)}
						</form.Field>
					</div>

					{/* Feature Toggles */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium">
							{t("settings.workPolicies.enabledFeatures", "Enabled Features")}
						</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field name="scheduleEnabled">
								{(field) => (
									<div className="flex items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label>{t("settings.workPolicies.workSchedule", "Work Schedule")}</Label>
											<p className="text-xs text-muted-foreground">
												{t(
													"settings.workPolicies.workScheduleDescription",
													"Define working hours and days",
												)}
											</p>
										</div>
										<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
									</div>
								)}
							</form.Field>

							<form.Field name="regulationEnabled">
								{(field) => (
									<div className="flex items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label>{t("settings.workPolicies.timeRegulation", "Time Regulation")}</Label>
											<p className="text-xs text-muted-foreground">
												{t(
													"settings.workPolicies.timeRegulationDescription",
													"Set time limits and break rules",
												)}
											</p>
										</div>
										<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
									</div>
								)}
							</form.Field>
						</div>
						{!scheduleEnabled && !regulationEnabled && (
							<p className="text-sm text-destructive">
								{t(
									"settings.workPolicies.atLeastOneFeature",
									"At least one feature must be enabled",
								)}
							</p>
						)}
					</div>

					{/* Schedule Configuration */}
					{scheduleEnabled && (
						<>
							<Separator />
							<div className="space-y-4">
								<h3 className="text-sm font-medium">
									{t("settings.workPolicies.scheduleConfiguration", "Schedule Configuration")}
								</h3>

								<div className="grid gap-4 sm:grid-cols-2">
									<form.Field name="scheduleCycle">
										{(field) => (
											<div className="space-y-2">
												<Label>{t("settings.workSchedules.cycle.label", "Cycle")}</Label>
												<Select
													value={field.state.value}
													onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="daily">
															{t("settings.workSchedules.cycle.daily", "Daily")}
														</SelectItem>
														<SelectItem value="weekly">
															{t("settings.workSchedules.cycle.weekly", "Weekly")}
														</SelectItem>
														<SelectItem value="biweekly">
															{t("settings.workSchedules.cycle.biweekly", "Biweekly")}
														</SelectItem>
														<SelectItem value="monthly">
															{t("settings.workSchedules.cycle.monthly", "Monthly")}
														</SelectItem>
														<SelectItem value="yearly">
															{t("settings.workSchedules.cycle.yearly", "Yearly")}
														</SelectItem>
													</SelectContent>
												</Select>
											</div>
										)}
									</form.Field>

									<form.Field name="homeOfficeDaysPerCycle">
										{(field) => (
											<div className="space-y-2">
												<Label>
													{t("settings.workSchedules.homeOfficeDays", "Home Office Days")}
												</Label>
												<Input
													type="number"
													min="0"
													max="31"
													value={field.state.value}
													onChange={(e) => field.handleChange(Number(e.target.value))}
													onBlur={field.handleBlur}
												/>
											</div>
										)}
									</form.Field>
								</div>

								{/* Schedule Type Tabs */}
								<form.Field name="scheduleType">
									{(field) => (
										<Tabs
											value={field.state.value}
											onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
										>
											<TabsList className="grid w-full grid-cols-2">
												<TabsTrigger value="simple">
													{t("settings.workSchedules.type.simple", "Simple")}
												</TabsTrigger>
												<TabsTrigger value="detailed">
													{t("settings.workSchedules.type.detailed", "Detailed")}
												</TabsTrigger>
											</TabsList>

											<TabsContent value="simple" className="space-y-4 pt-4">
												<form.Field name="workingDaysPreset">
													{(presetField) => (
														<div className="space-y-2">
															<Label>
																{t("settings.workSchedules.workingDays.label", "Working Days")}
															</Label>
															<Select
																value={presetField.state.value}
																onValueChange={(v) =>
																	presetField.handleChange(v as typeof presetField.state.value)
																}
															>
																<SelectTrigger>
																	<SelectValue />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="weekdays">
																		{t(
																			"settings.workSchedules.workingDays.weekdays",
																			"Weekdays (Mon-Fri)",
																		)}
																	</SelectItem>
																	<SelectItem value="weekends">
																		{t(
																			"settings.workSchedules.workingDays.weekends",
																			"Weekends (Sat-Sun)",
																		)}
																	</SelectItem>
																	<SelectItem value="all_days">
																		{t("settings.workSchedules.workingDays.allDays", "All Days")}
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</form.Field>

												<form.Field name="hoursPerCycle">
													{(hoursField) => (
														<div className="space-y-2">
															<Label>
																{t("settings.workSchedules.hoursPerCycle", "Hours per Cycle")}
															</Label>
															<Input
																type="number"
																min="0"
																max="744"
																step="0.5"
																value={hoursField.state.value}
																onChange={(e) => hoursField.handleChange(e.target.value)}
																onBlur={hoursField.handleBlur}
															/>
														</div>
													)}
												</form.Field>
											</TabsContent>

											<TabsContent value="detailed" className="space-y-4 pt-4">
												<div className="space-y-3">
													{DAYS_OF_WEEK.map((day, index) => (
														<div
															key={day.value}
															className="flex items-center gap-4 p-3 rounded-lg border"
														>
															<Checkbox
																checked={days[index]?.isWorkDay ?? false}
																onCheckedChange={(checked) => {
																	const newDays = [...days];
																	newDays[index] = { ...newDays[index], isWorkDay: !!checked };
																	form.setFieldValue("days", newDays);
																}}
															/>
															<span className="w-24 font-medium">{day.label}</span>
															<div className="flex-1">
																<Input
																	type="number"
																	min="0"
																	max="24"
																	step="0.5"
																	disabled={!days[index]?.isWorkDay}
																	placeholder="0"
																	value={days[index]?.hoursPerDay ?? "0"}
																	onChange={(e) => {
																		const newDays = [...days];
																		newDays[index] = {
																			...newDays[index],
																			hoursPerDay: e.target.value,
																		};
																		form.setFieldValue("days", newDays);
																	}}
																/>
															</div>
															<span className="text-sm text-muted-foreground w-12">hours</span>
														</div>
													))}
												</div>
												<div className="text-right text-sm font-medium pt-2 border-t">
													{t("settings.workSchedules.totalHours", "Total")}: {totalHours.toFixed(1)}{" "}
													{t("settings.workSchedules.hoursUnit", "hours")}
												</div>
											</TabsContent>
										</Tabs>
									)}
								</form.Field>

								{/* Schedule Preview */}
								<div className="rounded-lg border bg-muted/30 p-4">
									<div className="text-sm font-medium mb-2">
										{t("settings.workSchedules.preview", "Schedule Preview")}
									</div>
									<WorkSchedulePreview
										days={previewDays}
										homeOfficeDaysPerCycle={homeOfficeDaysPerCycle}
										scheduleCycle={scheduleCycle}
									/>
								</div>
							</div>
						</>
					)}

					{/* Regulation Configuration */}
					{regulationEnabled && (
						<>
							<Separator />
							<div className="space-y-4">
								<h3 className="text-sm font-medium">
									{t("settings.workPolicies.regulationConfiguration", "Regulation Configuration")}
								</h3>

								{/* Working Time Limits */}
								<div className="space-y-4">
									<h4 className="text-sm text-muted-foreground">
										{t("settings.timeRegulations.workingTimeLimits", "Working Time Limits")}
									</h4>
									<div className="grid gap-4 sm:grid-cols-3">
										<form.Field name="maxDailyMinutes">
											{(field) => (
												<div className="space-y-2">
													<Label>{t("settings.timeRegulations.maxDaily", "Max Daily")}</Label>
													<div className="flex items-center gap-2">
														<Input
															type="number"
															min="1"
															max="24"
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
												</div>
											)}
										</form.Field>

										<form.Field name="maxWeeklyMinutes">
											{(field) => (
												<div className="space-y-2">
													<Label>{t("settings.timeRegulations.maxWeekly", "Max Weekly")}</Label>
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
												</div>
											)}
										</form.Field>

										<form.Field name="maxUninterruptedMinutes">
											{(field) => (
												<div className="space-y-2">
													<Label>
														{t("settings.timeRegulations.maxUninterrupted", "Max Uninterrupted")}
													</Label>
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
												</div>
											)}
										</form.Field>
									</div>
								</div>

								{/* Break Rules */}
								<div className="space-y-4">
									<div className="flex items-center justify-between">
										<h4 className="text-sm text-muted-foreground">
											{t("settings.timeRegulations.breakRules", "Break Rules")}
										</h4>
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
															{() => (
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
							</div>
						</>
					)}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isPending || (!scheduleEnabled && !regulationEnabled)}>
							{isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
