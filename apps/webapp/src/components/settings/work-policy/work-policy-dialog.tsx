"use client";
/* eslint-disable react-doctor/no-giant-component */

import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
	type BreakRuleInput,
	createWorkPolicy,
	type ScheduleDayInput,
	updateWorkPolicy,
	type WorkPolicyWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { WorkSchedulePreview } from "@/components/settings/work-policy/work-policy-preview";
import { generateDaysFromPreset } from "@/components/settings/work-policy/work-policy-preview-utils";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { queryKeys } from "@/lib/query";
import { BreakRuleEditor } from "../break-rule-editor";

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
type PresenceModeType = "minimum_count" | "fixed_days";
type PresenceEvaluationPeriodType = "weekly" | "biweekly" | "monthly";
type PresenceEnforcementType = "none" | "warn" | "block";

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
	presence: {
		presenceMode: "minimum_count" as PresenceModeType,
		requiredOnsiteDays: 3,
		requiredOnsiteFixedDays: [] as string[],
		locationId: "",
		evaluationPeriod: "weekly" as PresenceEvaluationPeriodType,
		enforcement: "warn" as PresenceEnforcementType,
	},
};

function parsePresenceFixedDays(value: string | null): string[] {
	if (!value) return [];

	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function buildWorkPolicyFormValues(
	editingPolicy: WorkPolicyWithDetails | null,
): typeof formDefaultValues {
	if (!editingPolicy) {
		return formDefaultValues;
	}

	return {
		name: editingPolicy.name,
		description: editingPolicy.description || "",
		scheduleEnabled: editingPolicy.scheduleEnabled,
		regulationEnabled: editingPolicy.regulationEnabled,
		presenceEnabled: editingPolicy.presenceEnabled,
		scheduleCycle: editingPolicy.schedule?.scheduleCycle ?? "weekly",
		scheduleType: editingPolicy.schedule?.scheduleType ?? "simple",
		workingDaysPreset: editingPolicy.schedule?.workingDaysPreset ?? "weekdays",
		hoursPerCycle: editingPolicy.schedule?.hoursPerCycle || "40",
		homeOfficeDaysPerCycle: editingPolicy.schedule?.homeOfficeDaysPerCycle || 0,
		days: editingPolicy.schedule?.days.length
			? editingPolicy.schedule.days.map((day) => ({
					dayOfWeek: day.dayOfWeek as DayOfWeek,
					hoursPerDay: day.hoursPerDay,
					isWorkDay: day.isWorkDay,
					cycleWeek: day.cycleWeek ?? 1,
				}))
			: defaultDays,
		maxDailyMinutes: editingPolicy.regulation?.maxDailyMinutes ?? null,
		maxWeeklyMinutes: editingPolicy.regulation?.maxWeeklyMinutes ?? null,
		maxUninterruptedMinutes: editingPolicy.regulation?.maxUninterruptedMinutes ?? null,
		breakRules: (editingPolicy.regulation?.breakRules || []).map((rule) => ({
			workingMinutesThreshold: rule.workingMinutesThreshold,
			requiredBreakMinutes: rule.requiredBreakMinutes,
			options: (rule.options || []).map((option) => ({
				splitCount: option.splitCount,
				minimumSplitMinutes: option.minimumSplitMinutes,
				minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
			})),
		})),
		presence: {
			presenceMode: editingPolicy.presence?.presenceMode ?? "minimum_count",
			requiredOnsiteDays: editingPolicy.presence?.requiredOnsiteDays ?? 3,
			requiredOnsiteFixedDays: parsePresenceFixedDays(
				editingPolicy.presence?.requiredOnsiteFixedDays ?? null,
			),
			locationId: editingPolicy.presence?.locationId ?? "",
			evaluationPeriod: editingPolicy.presence?.evaluationPeriod ?? "weekly",
			enforcement: editingPolicy.presence?.enforcement ?? "warn",
		},
	};
}

export function WorkPolicyDialog({
	open,
	onOpenChange,
	organizationId,
	editingPolicy,
	onSuccess,
}: WorkPolicyDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
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
				presence: value.presenceEnabled
					? {
							presenceMode: value.presence.presenceMode,
							requiredOnsiteDays:
								value.presence.presenceMode === "minimum_count"
									? value.presence.requiredOnsiteDays
									: undefined,
							requiredOnsiteFixedDays:
								value.presence.presenceMode === "fixed_days"
									? value.presence.requiredOnsiteFixedDays
									: undefined,
							locationId: value.presence.locationId || undefined,
							evaluationPeriod: value.presence.evaluationPeriod,
							enforcement: value.presence.enforcement,
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
	const resetScopeRef = useRef("");
	useEffect(() => {
		const nextResetScope = open ? `${editingPolicy?.id ?? "new"}` : "";
		if (open && resetScopeRef.current !== nextResetScope) {
			resetScopeRef.current = nextResetScope;
			form.reset(buildWorkPolicyFormValues(editingPolicy));
		} else if (!open && resetScopeRef.current !== "") {
			resetScopeRef.current = "";
		}
	}, [open, editingPolicy, form]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (data: Parameters<typeof createWorkPolicy>[1]) =>
			createWorkPolicy(organizationId, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.created", "Policy created"));
				void queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.list(organizationId),
				});
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
		mutationFn: (data: Parameters<typeof updateWorkPolicy>[1]) => {
			if (!editingPolicy) {
				throw new Error("Cannot update policy without an editing target");
			}
			return updateWorkPolicy(editingPolicy.id, data);
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.updated", "Policy updated"));
				void Promise.all([
					queryClient.invalidateQueries({
						queryKey: queryKeys.workPolicies.list(organizationId),
					}),
					editingPolicy
						? queryClient.invalidateQueries({
								queryKey: queryKeys.workPolicies.detail(editingPolicy.id),
							})
						: Promise.resolve(),
				]);
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
	const presenceEnabled = useStore(form.store, (state) => state.values.presenceEnabled);
	const presenceMode = useStore(form.store, (state) => state.values.presence.presenceMode);
	const _presenceFixedDays = useStore(
		form.store,
		(state) => state.values.presence.requiredOnsiteFixedDays,
	);
	const scheduleType = useStore(form.store, (state) => state.values.scheduleType);
	const days = useStore(form.store, (state) => state.values.days) || defaultDays;
	const workingDaysPreset = useStore(form.store, (state) => state.values.workingDaysPreset);
	const hoursPerCycle = useStore(form.store, (state) => state.values.hoursPerCycle);
	const scheduleCycle = useStore(form.store, (state) => state.values.scheduleCycle);
	const homeOfficeDaysPerCycle = useStore(
		form.store,
		(state) => state.values.homeOfficeDaysPerCycle,
	);
	const _breakRules = useStore(form.store, (state) => state.values.breakRules);

	// Calculate total hours for detailed mode
	const totalHours = days
		.filter((d) => d.isWorkDay)
		.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);

	// Generate preview days based on schedule type
	const previewDays = (() => {
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
	})();

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.workPolicies.editPolicy", "Edit Policy")
							: t("settings.workPolicies.createPolicy", "Create Policy")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.workPolicies.policyDescription",
							"Define work schedules and time regulations that can be assigned to your organization, teams, or employees.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-6">
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
												<Label>
													{t("settings.workPolicies.timeRegulation", "Time Regulation")}
												</Label>
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

								<form.Field name="presenceEnabled">
									{(field) => (
										<div className="flex items-center justify-between rounded-lg border p-4">
											<div className="space-y-0.5">
												<Label>
													{t("settings.workPolicies.presenceEnabled", "Presence Requirements")}
												</Label>
												<p className="text-xs text-muted-foreground">
													{t(
														"settings.workPolicies.presenceEnabledDescription",
														"Set on-site attendance requirements for employees",
													)}
												</p>
											</div>
											<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
										</div>
									)}
								</form.Field>
							</div>
							{!scheduleEnabled && !regulationEnabled && !presenceEnabled && (
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
																		newDays[index] = {
																			...newDays[index],
																			isWorkDay: !!checked,
																		};
																		form.setFieldValue("days", newDays);
																	}}
																/>
																<span className="w-24 font-medium">
																	{t(`common.days.${day.value}`, day.label)}
																</span>
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
																<span className="text-sm text-muted-foreground w-12">
																	{t("settings.workSchedules.hoursUnit", "hours")}
																</span>
															</div>
														))}
													</div>
													<div className="text-right text-sm font-medium pt-2 border-t">
														{t("settings.workSchedules.totalHours", "Total")}:{" "}
														{totalHours.toFixed(1)} {t("settings.workSchedules.hoursUnit", "hours")}
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
																	const hours = parseInt(e.target.value, 10);
																	field.handleChange(Number.isNaN(hours) ? null : hours * 60);
																}}
																onBlur={field.handleBlur}
																placeholder="—"
																className="w-20"
															/>
															<span className="text-sm text-muted-foreground">
																{t("settings.workSchedules.hoursUnit", "hours")}
															</span>
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
																	const hours = parseInt(e.target.value, 10);
																	field.handleChange(Number.isNaN(hours) ? null : hours * 60);
																}}
																onBlur={field.handleBlur}
																placeholder="—"
																className="w-20"
															/>
															<span className="text-sm text-muted-foreground">
																{t("settings.workSchedules.hoursUnit", "hours")}
															</span>
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
																	field.handleChange(
																		Number.isNaN(hours) ? null : Math.round(hours * 60),
																	);
																}}
																onBlur={field.handleBlur}
																placeholder="—"
																className="w-20"
															/>
															<span className="text-sm text-muted-foreground">
																{t("settings.workSchedules.hoursUnit", "hours")}
															</span>
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
														<IconPlus className="mr-2 size-4" />
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
																{t(
																	"settings.timeRegulations.noBreakRules",
																	"No break rules defined",
																)}
															</p>
															<p className="text-xs text-muted-foreground mt-1">
																{t(
																	"settings.timeRegulations.noBreakRulesDescription",
																	"Add break rules to define required breaks based on working time",
																)}
															</p>
														</div>
													) : (
														field.state.value.map((rule, ruleIndex) => {
															const ruleKey = `${rule.workingMinutesThreshold}-${rule.requiredBreakMinutes}-${rule.options.length}-${ruleIndex}`;
															return (
																<form.Field key={ruleKey} name={`breakRules[${ruleIndex}]`}>
																	{() => (
																		<BreakRuleEditor
																			ruleIndex={ruleIndex}
																			form={form}
																			onRemove={() => field.removeValue(ruleIndex)}
																		/>
																	)}
																</form.Field>
															);
														})
													)}
												</div>
											)}
										</form.Field>
									</div>
								</div>
							</>
						)}

						{/* Presence Configuration */}
						{presenceEnabled && (
							<>
								<Separator />
								<div className="space-y-4">
									<h3 className="text-sm font-medium">
										{t("settings.workPolicies.presenceConfiguration", "Presence Configuration")}
									</h3>

									{/* Mode */}
									<div className="space-y-2">
										<Label>{t("settings.workPolicies.presenceMode", "Mode")}</Label>
										<form.Field name="presence.presenceMode">
											{(field) => (
												<RadioGroup
													value={field.state.value}
													onValueChange={(v) => field.handleChange(v as PresenceModeType)}
													className="grid gap-3 sm:grid-cols-2"
												>
													<label
														htmlFor="presence-mode-minimum-count"
														className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer has-data-checked:border-primary"
													>
														<RadioGroupItem
															id="presence-mode-minimum-count"
															value="minimum_count"
														/>
														<div className="space-y-0.5">
															<span className="text-sm font-medium">
																{t(
																	"settings.workPolicies.presenceModeMinimumCount",
																	"Minimum days on-site",
																)}
															</span>
															<p className="text-xs text-muted-foreground">
																{t(
																	"settings.workPolicies.presenceModeMinimumCountDescription",
																	"Require a minimum number of on-site days per period",
																)}
															</p>
														</div>
													</label>
													<label
														htmlFor="presence-mode-fixed-days"
														className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer has-data-checked:border-primary"
													>
														<RadioGroupItem id="presence-mode-fixed-days" value="fixed_days" />
														<div className="space-y-0.5">
															<span className="text-sm font-medium">
																{t(
																	"settings.workPolicies.presenceModeFixedDays",
																	"Fixed specific days",
																)}
															</span>
															<p className="text-xs text-muted-foreground">
																{t(
																	"settings.workPolicies.presenceModeFixedDaysDescription",
																	"Require attendance on specific days of the week",
																)}
															</p>
														</div>
													</label>
												</RadioGroup>
											)}
										</form.Field>
									</div>

									{/* Minimum count input */}
									{presenceMode === "minimum_count" && (
										<form.Field
											name="presence.requiredOnsiteDays"
											validators={{
												onChange: ({ value }) => {
													if (!presenceEnabled) return undefined;
													if (value < 1 || value > 7) {
														return t(
															"settings.workPolicies.presenceRequiredDaysError",
															"Must be between 1 and 7",
														);
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<div className="space-y-2">
													<Label>
														{t(
															"settings.workPolicies.presenceRequiredDays",
															"Required on-site days",
														)}
													</Label>
													<Input
														type="number"
														min={1}
														max={7}
														value={field.state.value}
														onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 1)}
														onBlur={field.handleBlur}
														className="w-32"
													/>
													{field.state.meta.errors.length > 0 && (
														<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
													)}
													<p className="text-xs text-muted-foreground">
														{t(
															"settings.workPolicies.presenceRequiredDaysHelp",
															"Number of days per evaluation period employees must be on-site",
														)}
													</p>
												</div>
											)}
										</form.Field>
									)}

									{/* Fixed days checkboxes */}
									{presenceMode === "fixed_days" && (
										<form.Field
											name="presence.requiredOnsiteFixedDays"
											validators={{
												onChange: ({ value }) => {
													if (!presenceEnabled) return undefined;
													if (!value || value.length === 0) {
														return t(
															"settings.workPolicies.presenceFixedDaysError",
															"At least one day must be selected",
														);
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<div className="space-y-2">
													<Label>
														{t(
															"settings.workPolicies.presenceFixedDaysLabel",
															"Required on-site days",
														)}
													</Label>
													<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
														{DAYS_OF_WEEK.map((day) => {
															const isChecked = (field.state.value || []).includes(day.value);
															const dayId = `presence-fixed-day-${day.value}`;
															return (
																<label
																	htmlFor={dayId}
																	key={day.value}
																	className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer"
																>
																	<Checkbox
																		id={dayId}
																		checked={isChecked}
																		onCheckedChange={(checked) => {
																			const current = field.state.value || [];
																			if (checked) {
																				field.handleChange([...current, day.value]);
																			} else {
																				field.handleChange(
																					current.filter((d: string) => d !== day.value),
																				);
																			}
																		}}
																	/>
																	<span className="text-sm">
																		{t(`common.days.${day.value}`, day.label)}
																	</span>
																</label>
															);
														})}
													</div>
													{field.state.meta.errors.length > 0 && (
														<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
													)}
												</div>
											)}
										</form.Field>
									)}

									{/* Evaluation Period & Location */}
									<div className="grid gap-4 sm:grid-cols-2">
										<form.Field name="presence.evaluationPeriod">
											{(field) => (
												<div className="space-y-2">
													<Label>
														{t(
															"settings.workPolicies.presenceEvaluationPeriod",
															"Evaluation period",
														)}
													</Label>
													<Select
														value={field.state.value}
														onValueChange={(v) =>
															field.handleChange(v as PresenceEvaluationPeriodType)
														}
													>
														<SelectTrigger>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="weekly">
																{t("settings.workPolicies.presenceEvaluationWeekly", "Weekly")}
															</SelectItem>
															<SelectItem value="biweekly">
																{t("settings.workPolicies.presenceEvaluationBiweekly", "Biweekly")}
															</SelectItem>
															<SelectItem value="monthly">
																{t("settings.workPolicies.presenceEvaluationMonthly", "Monthly")}
															</SelectItem>
														</SelectContent>
													</Select>
												</div>
											)}
										</form.Field>

										<form.Field name="presence.locationId">
											{(field) => (
												<div className="space-y-2">
													<Label>{t("settings.workPolicies.presenceLocation", "Location")}</Label>
													<Select
														value={field.state.value || "__any__"}
														onValueChange={(v) => field.handleChange(v === "__any__" ? "" : v)}
													>
														<SelectTrigger>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="__any__">
																{t("settings.workPolicies.presenceAnyLocation", "Any location")}
															</SelectItem>
														</SelectContent>
													</Select>
													<p className="text-xs text-muted-foreground">
														{t(
															"settings.workPolicies.presenceLocationHelp",
															"Organization locations can be configured separately",
														)}
													</p>
												</div>
											)}
										</form.Field>
									</div>

									{/* Enforcement */}
									<div className="space-y-2">
										<Label>{t("settings.workPolicies.presenceEnforcement", "Enforcement")}</Label>
										<form.Field name="presence.enforcement">
											{(field) => (
												<RadioGroup
													value={field.state.value}
													onValueChange={(v) => field.handleChange(v as PresenceEnforcementType)}
													className="grid gap-3 sm:grid-cols-3"
												>
													<label
														htmlFor="presence-enforcement-none"
														className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer has-data-checked:border-primary"
													>
														<RadioGroupItem id="presence-enforcement-none" value="none" />
														<div className="space-y-0.5">
															<span className="text-sm font-medium">
																{t("settings.workPolicies.presenceEnforcementNone", "None")}
															</span>
															<p className="text-xs text-muted-foreground">
																{t(
																	"settings.workPolicies.presenceEnforcementNoneDescription",
																	"Track only",
																)}
															</p>
														</div>
													</label>
													<label
														htmlFor="presence-enforcement-warn"
														className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer has-data-checked:border-primary"
													>
														<RadioGroupItem id="presence-enforcement-warn" value="warn" />
														<div className="space-y-0.5">
															<span className="text-sm font-medium">
																{t("settings.workPolicies.presenceEnforcementWarn", "Warn")}
															</span>
															<p className="text-xs text-muted-foreground">
																{t(
																	"settings.workPolicies.presenceEnforcementWarnDescription",
																	"Notify employee & manager",
																)}
															</p>
														</div>
													</label>
													<label
														htmlFor="presence-enforcement-block"
														className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer has-data-checked:border-primary"
													>
														<RadioGroupItem id="presence-enforcement-block" value="block" />
														<div className="space-y-0.5">
															<span className="text-sm font-medium">
																{t("settings.workPolicies.presenceEnforcementEscalate", "Escalate")}
															</span>
															<p className="text-xs text-muted-foreground">
																{t(
																	"settings.workPolicies.presenceEnforcementEscalateDescription",
																	"Notify + flag on dashboard",
																)}
															</p>
														</div>
													</label>
												</RadioGroup>
											)}
										</form.Field>
									</div>
								</div>
							</>
						)}
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="button"
							onClick={() => {
								form.handleSubmit();
							}}
							disabled={isPending || (!scheduleEnabled && !regulationEnabled && !presenceEnabled)}
						>
							{isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
