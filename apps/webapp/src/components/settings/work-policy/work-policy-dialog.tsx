"use client";
/* eslint-disable react-doctor/no-giant-component */

import { IconAlertTriangle, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type BreakRuleInput,
	type CreateWorkPolicyInput,
	createWorkPolicy,
	publishWorkPolicyVersion,
	type ScheduleDayInput,
	type UpdateWorkPolicyInput,
	updateWorkPolicy,
	type WorkPolicyWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { todayIsoDate } from "@/components/settings/contracts/contract-formatters";
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
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { BreakRuleEditor } from "../break-rule-editor";
import { WORK_POLICY_REFUSALS } from "./work-policy-refusals";

interface WorkPolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingPolicy: WorkPolicyWithDetails | null;
	workPolicyVersioningEnabled?: boolean;
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
	latestClockIn: null,
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
type RestPeriodEnforcementType = "none" | "warn" | "block";

function formatMinutesAsHours(minutes: number | null): string {
	if (minutes === null) return "";
	return String(Number((minutes / 60).toFixed(2)));
}

function parseHoursInputToMinutes(raw: string): number | null {
	if (raw.trim() === "") return null;
	const hours = Number(raw);
	return Number.isNaN(hours) ? null : Math.round(hours * 60);
}

function parseNumericInput(raw: string): number | null {
	if (raw.trim() === "") return null;
	const parsed = Number(raw);
	return Number.isNaN(parsed) ? null : parsed;
}

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
	minRestPeriodMinutes: null as number | null,
	restPeriodEnforcement: "warn" as RestPeriodEnforcementType,
	overtimeDailyThresholdMinutes: null as number | null,
	overtimeWeeklyThresholdMinutes: null as number | null,
	overtimeMonthlyThresholdMinutes: null as number | null,
	alertBeforeLimitMinutes: 30 as number | null,
	alertThresholdPercent: 80 as number | null,
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
					latestClockIn: day.latestClockIn ?? null,
				}))
			: defaultDays,
		maxDailyMinutes: editingPolicy.regulation?.maxDailyMinutes ?? null,
		maxWeeklyMinutes: editingPolicy.regulation?.maxWeeklyMinutes ?? null,
		maxUninterruptedMinutes: editingPolicy.regulation?.maxUninterruptedMinutes ?? null,
		minRestPeriodMinutes: editingPolicy.regulation?.minRestPeriodMinutes ?? null,
		restPeriodEnforcement: editingPolicy.regulation?.restPeriodEnforcement ?? "warn",
		overtimeDailyThresholdMinutes: editingPolicy.regulation?.overtimeDailyThresholdMinutes ?? null,
		overtimeWeeklyThresholdMinutes:
			editingPolicy.regulation?.overtimeWeeklyThresholdMinutes ?? null,
		overtimeMonthlyThresholdMinutes:
			editingPolicy.regulation?.overtimeMonthlyThresholdMinutes ?? null,
		alertBeforeLimitMinutes: editingPolicy.regulation
			? (editingPolicy.regulation.alertBeforeLimitMinutes ?? null)
			: 30,
		alertThresholdPercent: editingPolicy.regulation
			? (editingPolicy.regulation.alertThresholdPercent ?? null)
			: 80,
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

function useWorkPolicyForm({
	open,
	onOpenChange,
	organizationId,
	editingPolicy,
	workPolicyVersioningEnabled = false,
	onSuccess,
}: WorkPolicyDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!editingPolicy;
	const initialFormValues = buildWorkPolicyFormValues(editingPolicy);
	const [effectiveFromDate, setEffectiveFromDate] = useState(() => todayIsoDate());
	const [confirmSameDayReplace, setConfirmSameDayReplace] = useState(false);

	const isMetadataOnlyEdit = (value: typeof formDefaultValues): boolean => {
		if (!editingPolicy) return false;
		const init = initialFormValues;
		return (
			value.scheduleEnabled === init.scheduleEnabled &&
			value.regulationEnabled === init.regulationEnabled &&
			value.presenceEnabled === init.presenceEnabled &&
			value.scheduleCycle === init.scheduleCycle &&
			value.scheduleType === init.scheduleType &&
			value.workingDaysPreset === init.workingDaysPreset &&
			value.hoursPerCycle === init.hoursPerCycle &&
			value.homeOfficeDaysPerCycle === init.homeOfficeDaysPerCycle &&
			JSON.stringify(value.days) === JSON.stringify(init.days) &&
			value.maxDailyMinutes === init.maxDailyMinutes &&
			value.maxWeeklyMinutes === init.maxWeeklyMinutes &&
			value.maxUninterruptedMinutes === init.maxUninterruptedMinutes &&
			value.minRestPeriodMinutes === init.minRestPeriodMinutes &&
			value.restPeriodEnforcement === init.restPeriodEnforcement &&
			value.overtimeDailyThresholdMinutes === init.overtimeDailyThresholdMinutes &&
			value.overtimeWeeklyThresholdMinutes === init.overtimeWeeklyThresholdMinutes &&
			value.overtimeMonthlyThresholdMinutes === init.overtimeMonthlyThresholdMinutes &&
			value.alertBeforeLimitMinutes === init.alertBeforeLimitMinutes &&
			value.alertThresholdPercent === init.alertThresholdPercent &&
			JSON.stringify(value.breakRules) === JSON.stringify(init.breakRules) &&
			JSON.stringify(value.presence) === JSON.stringify(init.presence)
		);
	};

	const form = useForm({
		defaultValues: initialFormValues,
		onSubmit: async ({ value }) => {
			const metadataOnly = isMetadataOnlyEdit(value);
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
							days:
								value.scheduleType === "detailed"
									? value.days.map((day) => ({
											...day,
											// Only work days carry a latest clock-in; an empty field clears it.
											latestClockIn: (day.isWorkDay && day.latestClockIn) || null,
										}))
									: undefined,
						}
					: undefined,
				regulation: value.regulationEnabled
					? {
							maxDailyMinutes: value.maxDailyMinutes ?? null,
							maxWeeklyMinutes: value.maxWeeklyMinutes ?? null,
							maxUninterruptedMinutes: value.maxUninterruptedMinutes ?? null,
							minRestPeriodMinutes: value.minRestPeriodMinutes ?? null,
							restPeriodEnforcement: value.restPeriodEnforcement,
							overtimeDailyThresholdMinutes: value.overtimeDailyThresholdMinutes ?? null,
							overtimeWeeklyThresholdMinutes: value.overtimeWeeklyThresholdMinutes ?? null,
							overtimeMonthlyThresholdMinutes: value.overtimeMonthlyThresholdMinutes ?? null,
							alertBeforeLimitMinutes: value.alertBeforeLimitMinutes ?? null,
							alertThresholdPercent: value.alertThresholdPercent ?? null,
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

			if (isEditing && workPolicyVersioningEnabled && !metadataOnly) {
				publishVersionMutation.mutate({
					effectiveFromDate,
					data: input,
				});
			} else if (isEditing) {
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
			form.reset(initialFormValues);
			setEffectiveFromDate(todayIsoDate());
			setConfirmSameDayReplace(false);
		} else if (!open && resetScopeRef.current !== "") {
			resetScopeRef.current = "";
		}
	}, [open, editingPolicy, form, initialFormValues]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (data: CreateWorkPolicyInput) => createWorkPolicy(data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.created", "Policy created"));
				void queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.list(organizationId),
				});
				onSuccess();
			} else {
				toast.error(
					actionErrorMessage(t, result, WORK_POLICY_REFUSALS, [
						"settings.workPolicies.createFailed",
						"Failed to create",
					]),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.createFailed", "Failed to create policy"));
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: (data: UpdateWorkPolicyInput) => {
			if (!editingPolicy) {
				throw new Error("Cannot update policy without an editing target");
			}
			return updateWorkPolicy({ policyId: editingPolicy.id, data });
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
				toast.error(
					actionErrorMessage(t, result, WORK_POLICY_REFUSALS, [
						"settings.workPolicies.updateFailed",
						"Failed to update",
					]),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.updateFailed", "Failed to update policy"));
		},
	});

	// Publish effective-dated version mutation
	const publishVersionMutation = useMutation({
		mutationFn: ({
			effectiveFromDate: targetDate,
			data,
		}: {
			effectiveFromDate: string;
			data: UpdateWorkPolicyInput;
		}) => {
			if (!editingPolicy) {
				throw new Error("Cannot publish policy version without an editing target");
			}
			return publishWorkPolicyVersion({
				policyId: editingPolicy.id,
				effectiveFromDate: targetDate,
				data,
			});
		},
		onSuccess: (result) => {
			if (result.success) {
				if (result.data.replacesSameDayVersion) {
					toast.warning(
						t(
							"settings.workPolicies.sameDayReplacedToast",
							"Version v{version} published for {date} (replaced earlier same-day revision v{replacedVersion} for that full day).",
							{
								version: result.data.version.versionNumber,
								date: result.data.replacesSameDayVersion.effectiveFromDate,
								replacedVersion: result.data.replacesSameDayVersion.replacedVersionNumber,
							},
						),
					);
				} else {
					toast.success(
						t(
							"settings.workPolicies.versionPublished",
							"Policy version v{version} published effective {date}",
							{
								version: result.data.version.versionNumber,
								date: result.data.version.effectiveFromDate,
							},
						),
					);
				}
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
				toast.error(
					actionErrorMessage(t, result, WORK_POLICY_REFUSALS, [
						"settings.workPolicies.updateFailed",
						"Failed to update",
					]),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.updateFailed", "Failed to update policy"));
		},
	});

	const isPending =
		createMutation.isPending || updateMutation.isPending || publishVersionMutation.isPending;

	// Subscribe to form values for conditional rendering
	const scheduleEnabled = useStore(form.store, (state) => state.values.scheduleEnabled);
	const regulationEnabled = useStore(form.store, (state) => state.values.regulationEnabled);
	const presenceEnabled = useStore(form.store, (state) => state.values.presenceEnabled);
	const presenceMode = useStore(form.store, (state) => state.values.presence.presenceMode);
	useStore(form.store, (state) => state.values.presence.requiredOnsiteFixedDays);
	const scheduleType = useStore(form.store, (state) => state.values.scheduleType);
	const days = useStore(form.store, (state) => state.values.days) || defaultDays;
	const workingDaysPreset = useStore(form.store, (state) => state.values.workingDaysPreset);
	const hoursPerCycle = useStore(form.store, (state) => state.values.hoursPerCycle);
	const scheduleCycle = useStore(form.store, (state) => state.values.scheduleCycle);
	const homeOfficeDaysPerCycle = useStore(
		form.store,
		(state) => state.values.homeOfficeDaysPerCycle,
	);
	useStore(form.store, (state) => state.values.breakRules);

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

	const currentValues = useStore(form.store, (state) => state.values);
	const isRuleEdit = isEditing && !isMetadataOnlyEdit(currentValues);
	const editedToday =
		Boolean(editingPolicy?.updatedAt) &&
		new Date(editingPolicy!.updatedAt).toISOString().slice(0, 10) === effectiveFromDate;
	const requiresSameDayConfirmation = workPolicyVersioningEnabled && isRuleEdit && editedToday;

	return {
		open,
		onOpenChange,
		isEditing,
		workPolicyVersioningEnabled,
		effectiveFromDate,
		setEffectiveFromDate,
		confirmSameDayReplace,
		setConfirmSameDayReplace,
		isRuleEdit,
		requiresSameDayConfirmation,
		t,
		form,
		noSectionsEnabled: !scheduleEnabled && !regulationEnabled && !presenceEnabled,
		scheduleEnabled,
		regulationEnabled,
		presenceEnabled,
		days,
		totalHours,
		previewDays,
		homeOfficeDaysPerCycle,
		scheduleCycle,
		presenceMode,
		isPending,
	};
}

export function WorkPolicyDialog({
	open,
	onOpenChange,
	organizationId,
	editingPolicy,
	workPolicyVersioningEnabled = false,
	onSuccess,
}: WorkPolicyDialogProps) {
	const {
		noSectionsEnabled,
		isEditing,
		effectiveFromDate,
		setEffectiveFromDate,
		confirmSameDayReplace,
		setConfirmSameDayReplace,
		isRuleEdit,
		requiresSameDayConfirmation,
		t,
		form,
		scheduleEnabled,
		regulationEnabled,
		presenceEnabled,
		days,
		totalHours,
		previewDays,
		homeOfficeDaysPerCycle,
		scheduleCycle,
		presenceMode,
		isPending,
	} = useWorkPolicyForm({
		open,
		onOpenChange,
		organizationId,
		editingPolicy,
		workPolicyVersioningEnabled,
		onSuccess,
	});
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

				<form
					className="flex min-h-0 flex-1 flex-col"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						// Enter in a field submits too; never start a second save while one is running.
						if (!isPending) form.handleSubmit();
					}}
				>
					<ActionPanelBody className="space-y-6">
						{/* Basic Info */}
						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field
								name="name"
								validators={{
									onChange: ({ value }) => {
										// Mirrors the server, which trims the name and requires one character.
										if (!value.trim()) {
											return t("settings.workPolicies.nameRequired", "Enter a policy name");
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
											<Label htmlFor="work-policy-name">
												{t("settings.workPolicies.name", "Name")}
											</Label>
											<Input
												id="work-policy-name"
												name="name"
												autoComplete="off"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={error ? true : undefined}
												aria-describedby={error ? "work-policy-name-error" : undefined}
												placeholder={t(
													"settings.workPolicies.namePlaceholder",
													"e.g., Full-Time Germany",
												)}
											/>
											{error ? (
												<p
													id="work-policy-name-error"
													role="alert"
													className="text-sm text-destructive"
												>
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
										<Label htmlFor="work-policy-description">
											{t("settings.workPolicies.descriptionLabel", "Description")}
										</Label>
										<Textarea
											id="work-policy-description"
											name="description"
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

						{/* Effective-Dated Version Publishing */}
						{isEditing && workPolicyVersioningEnabled && (
							<div className="space-y-3 rounded-lg border bg-muted/20 p-4">
								<div className="grid gap-3 sm:grid-cols-2 sm:items-end">
									<div className="space-y-1.5">
										<Label htmlFor="work-policy-effective-from">
											{t(
												"settings.workPolicies.versionEffectiveFrom",
												"New version effective from",
											)}
										</Label>
										<Input
											id="work-policy-effective-from"
											type="date"
											value={effectiveFromDate}
											onChange={(e) => {
												setEffectiveFromDate(e.target.value);
												setConfirmSameDayReplace(false);
											}}
										/>
									</div>
									<p className="text-muted-foreground text-xs">
										{isRuleEdit
											? t(
													"settings.workPolicies.versionPublishHint",
													"Rule changes publish a new immutable version from this date without altering past history.",
												)
											: t(
													"settings.workPolicies.metadataOnlyHint",
													"Name and description changes update in place without creating a new version.",
												)}
									</p>
								</div>

								{requiresSameDayConfirmation && (
									<Alert role="alert">
										<IconAlertTriangle className="size-4" aria-hidden="true" />
										<AlertTitle>
											{t(
												"settings.workPolicies.sameDayWarningTitle",
												"Same-day revision replaces earlier version",
											)}
										</AlertTitle>
										<AlertDescription className="space-y-2">
											<p>
												{t(
													"settings.workPolicies.sameDayWarningBody",
													"Publishing a second revision effective {date} replaces the earlier revision for that entire calendar day.",
													{ date: effectiveFromDate },
												)}
											</p>
											<label className="flex items-center gap-2 font-medium text-xs">
												<Checkbox
													id="work-policy-confirm-same-day"
													checked={confirmSameDayReplace}
													onCheckedChange={(c) => setConfirmSameDayReplace(c === true)}
												/>
												<span>
													{t(
														"settings.workPolicies.sameDayConfirmLabel",
														"I understand this replaces the earlier revision for {date}",
														{ date: effectiveFromDate },
													)}
												</span>
											</label>
										</AlertDescription>
									</Alert>
								)}
							</div>
						)}

						{/* Feature Toggles */}
						<div className="space-y-4">
							<h3 className="text-sm font-medium">
								{t("settings.workPolicies.enabledFeatures", "Enabled Features")}
							</h3>
							<div className="grid gap-4 sm:grid-cols-2">
								<form.Field name="scheduleEnabled">
									{(field) => (
										<div className="flex items-center justify-between gap-3 rounded-lg border p-4">
											<div className="space-y-0.5">
												<Label htmlFor="work-policy-schedule-enabled">
													{t("settings.workPolicies.workSchedule", "Work Schedule")}
												</Label>
												<p
													id="work-policy-schedule-enabled-description"
													className="text-xs text-muted-foreground"
												>
													{t(
														"settings.workPolicies.workScheduleDescription",
														"Define working hours and days",
													)}
												</p>
											</div>
											<Switch
												id="work-policy-schedule-enabled"
												aria-describedby="work-policy-schedule-enabled-description"
												checked={field.state.value}
												onCheckedChange={field.handleChange}
											/>
										</div>
									)}
								</form.Field>

								<form.Field name="regulationEnabled">
									{(field) => (
										<div className="flex items-center justify-between gap-3 rounded-lg border p-4">
											<div className="space-y-0.5">
												<Label htmlFor="work-policy-regulation-enabled">
													{t("settings.workPolicies.timeRegulation", "Time Regulation")}
												</Label>
												<p
													id="work-policy-regulation-enabled-description"
													className="text-xs text-muted-foreground"
												>
													{t(
														"settings.workPolicies.timeRegulationDescription",
														"Set time limits and break rules",
													)}
												</p>
											</div>
											<Switch
												id="work-policy-regulation-enabled"
												aria-describedby="work-policy-regulation-enabled-description"
												checked={field.state.value}
												onCheckedChange={field.handleChange}
											/>
										</div>
									)}
								</form.Field>

								<form.Field name="presenceEnabled">
									{(field) => (
										<div className="flex items-center justify-between gap-3 rounded-lg border p-4">
											<div className="space-y-0.5">
												<Label htmlFor="work-policy-presence-enabled">
													{t("settings.workPolicies.presenceEnabled", "Presence Requirements")}
												</Label>
												<p
													id="work-policy-presence-enabled-description"
													className="text-xs text-muted-foreground"
												>
													{t(
														"settings.workPolicies.presenceEnabledDescription",
														"Set on-site attendance requirements for employees",
													)}
												</p>
											</div>
											<Switch
												id="work-policy-presence-enabled"
												aria-describedby="work-policy-presence-enabled-description"
												checked={field.state.value}
												onCheckedChange={field.handleChange}
											/>
										</div>
									)}
								</form.Field>
							</div>
							{noSectionsEnabled && (
								<p role="alert" className="text-sm text-destructive">
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
													<Label htmlFor="work-policy-schedule-cycle">
														{t("settings.workSchedules.cycle.label", "Cycle")}
													</Label>
													<Select
														value={field.state.value}
														onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
													>
														<SelectTrigger id="work-policy-schedule-cycle" className="w-full">
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
													<Label htmlFor="work-policy-home-office-days">
														{t("settings.workSchedules.homeOfficeDays", "Home Office Days")}
													</Label>
													<Input
														id="work-policy-home-office-days"
														name="homeOfficeDaysPerCycle"
														className="tabular-nums"
														inputMode="numeric"
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
																<Label htmlFor="work-policy-working-days">
																	{t("settings.workSchedules.workingDays.label", "Working Days")}
																</Label>
																<Select
																	value={presetField.state.value}
																	onValueChange={(v) =>
																		presetField.handleChange(v as typeof presetField.state.value)
																	}
																>
																	<SelectTrigger id="work-policy-working-days" className="w-full">
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
																<Label htmlFor="work-policy-hours-per-cycle">
																	{t("settings.workSchedules.hoursPerCycle", "Hours per Cycle")}
																</Label>
																<Input
																	id="work-policy-hours-per-cycle"
																	name="hoursPerCycle"
																	className="tabular-nums"
																	inputMode="decimal"
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
													<p className="text-sm text-muted-foreground">
														{t(
															"settings.workSchedules.latestClockIn.simpleHint",
															"A latest clock-in per day needs a detailed schedule. Switch to Detailed to set one.",
														)}
													</p>
												</TabsContent>

												<TabsContent value="detailed" className="space-y-4 pt-4">
													<p className="text-sm text-muted-foreground">
														{t(
															"settings.workSchedules.latestClockIn.description",
															"Optional latest clock-in per work day: on days without a shift, employees who have not clocked in by then can get a reminder.",
														)}
													</p>
													<div className="space-y-3">
														{DAYS_OF_WEEK.map((day, index) => {
															const dayLabel = t(`common.days.${day.value}`, day.label);
															return (
																<div
																	key={day.value}
																	className="flex flex-wrap items-center gap-4 p-3 rounded-lg border"
																>
																	<Checkbox
																		id={`work-policy-work-day-${day.value}`}
																		aria-label={t(
																			"settings.workSchedules.workDayToggle",
																			"{day} is a work day",
																			{ day: dayLabel },
																		)}
																		checked={days[index]?.isWorkDay ?? false}
																		onCheckedChange={(checked) => {
																			const newDays = [...days];
																			newDays[index] = {
																				...newDays[index],
																				isWorkDay: !!checked,
																				// A latest clock-in applies only to work days.
																				latestClockIn: checked
																					? newDays[index]?.latestClockIn
																					: null,
																			};
																			form.setFieldValue("days", newDays);
																		}}
																	/>
																	<label
																		htmlFor={`work-policy-work-day-${day.value}`}
																		className="w-24 font-medium"
																	>
																		{dayLabel}
																	</label>
																	<div className="flex-1">
																		<Input
																			type="number"
																			min="0"
																			max="24"
																			step="0.5"
																			inputMode="decimal"
																			className="tabular-nums"
																			aria-label={t(
																				"settings.workSchedules.hoursOnDay",
																				"Hours on {day}",
																				{ day: dayLabel },
																			)}
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
																	{days[index]?.isWorkDay ? (
																		<Input
																			type="time"
																			className="w-32"
																			aria-label={t(
																				"settings.workSchedules.latestClockIn.dayLabel",
																				"Latest clock-in on {day}",
																				{ day: dayLabel },
																			)}
																			title={t(
																				"settings.workSchedules.latestClockIn.label",
																				"Latest clock-in",
																			)}
																			value={days[index]?.latestClockIn ?? ""}
																			onChange={(e) => {
																				const newDays = [...days];
																				newDays[index] = {
																					...newDays[index],
																					latestClockIn: e.target.value || null,
																				};
																				form.setFieldValue("days", newDays);
																			}}
																		/>
																	) : (
																		<span className="w-32" aria-hidden="true" />
																	)}
																</div>
															);
														})}
													</div>
													<div className="text-right text-sm font-medium tabular-nums pt-2 border-t">
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
								<WorkRegulationFields form={form} />
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
										<Label id="work-policy-presence-mode-label">
											{t("settings.workPolicies.presenceMode", "Mode")}
										</Label>
										<form.Field name="presence.presenceMode">
											{(field) => (
												<RadioGroup
													aria-labelledby="work-policy-presence-mode-label"
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
													<Label htmlFor="work-policy-presence-required-days">
														{t(
															"settings.workPolicies.presenceRequiredDays",
															"Required on-site days",
														)}
													</Label>
													<Input
														id="work-policy-presence-required-days"
														name="requiredOnsiteDays"
														type="number"
														inputMode="numeric"
														min={1}
														max={7}
														value={field.state.value}
														onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 1)}
														onBlur={field.handleBlur}
														aria-invalid={field.state.meta.errors.length > 0 ? true : undefined}
														aria-describedby={
															field.state.meta.errors.length > 0
																? "work-policy-presence-required-days-help work-policy-presence-required-days-error"
																: "work-policy-presence-required-days-help"
														}
														className="w-32 tabular-nums"
													/>
													{field.state.meta.errors.length > 0 && (
														<p
															id="work-policy-presence-required-days-error"
															role="alert"
															className="text-sm text-destructive"
														>
															{field.state.meta.errors[0]}
														</p>
													)}
													<p
														id="work-policy-presence-required-days-help"
														className="text-xs text-muted-foreground"
													>
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
													<Label id="work-policy-presence-fixed-days-label">
														{t(
															"settings.workPolicies.presenceFixedDaysLabel",
															"Required on-site days",
														)}
													</Label>
													<div
														role="group"
														aria-labelledby="work-policy-presence-fixed-days-label"
														aria-describedby={
															field.state.meta.errors.length > 0
																? "work-policy-presence-fixed-days-error"
																: undefined
														}
														className="grid grid-cols-2 gap-2 sm:grid-cols-4"
													>
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
														<p
															id="work-policy-presence-fixed-days-error"
															role="alert"
															className="text-sm text-destructive"
														>
															{field.state.meta.errors[0]}
														</p>
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
													<Label htmlFor="work-policy-presence-evaluation-period">
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
														<SelectTrigger
															id="work-policy-presence-evaluation-period"
															className="w-full"
														>
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
													<Label htmlFor="work-policy-presence-location">
														{t("settings.workPolicies.presenceLocation", "Location")}
													</Label>
													<Select
														value={field.state.value || "__any__"}
														onValueChange={(v) => field.handleChange(v === "__any__" ? "" : v)}
													>
														<SelectTrigger id="work-policy-presence-location" className="w-full">
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
										<Label id="work-policy-presence-enforcement-label">
											{t("settings.workPolicies.presenceEnforcement", "Enforcement")}
										</Label>
										<form.Field name="presence.enforcement">
											{(field) => (
												<RadioGroup
													aria-labelledby="work-policy-presence-enforcement-label"
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
							type="submit"
							disabled={
								isPending ||
								noSectionsEnabled ||
								(requiresSameDayConfirmation && !confirmSameDayReplace)
							}
							aria-busy={isPending || undefined}
						>
							{isPending && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
							{isEditing && workPolicyVersioningEnabled && isRuleEdit
								? t("settings.workPolicies.publishVersion", "Publish version")
								: isEditing
									? t("common.save", "Save")
									: t("common.create", "Create")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function WorkRegulationFields({ form }: { form: ReturnType<typeof useWorkPolicyForm>["form"] }) {
	const { t } = useTranslate();
	return (
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
								<Label htmlFor="work-policy-max-daily">
									{t("settings.timeRegulations.maxDaily", "Max Daily")}
								</Label>
								<div className="flex items-center gap-2">
									<Input
										id="work-policy-max-daily"
										name="maxDailyHours"
										inputMode="numeric"
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
								<Label htmlFor="work-policy-max-weekly">
									{t("settings.timeRegulations.maxWeekly", "Max Weekly")}
								</Label>
								<div className="flex items-center gap-2">
									<Input
										id="work-policy-max-weekly"
										name="maxWeeklyHours"
										inputMode="numeric"
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
								<Label htmlFor="work-policy-max-uninterrupted">
									{t("settings.timeRegulations.maxUninterrupted", "Max Uninterrupted")}
								</Label>
								<div className="flex items-center gap-2">
									<Input
										id="work-policy-max-uninterrupted"
										name="maxUninterruptedHours"
										inputMode="decimal"
										type="number"
										min="0.5"
										max="12"
										step="0.5"
										value={field.state.value ? field.state.value / 60 : ""}
										onChange={(e) => {
											const hours = parseFloat(e.target.value);
											field.handleChange(Number.isNaN(hours) ? null : Math.round(hours * 60));
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

			{/* Rest Period (ArbZG §5) */}
			<div className="space-y-4">
				<h4 className="text-sm text-muted-foreground">
					{t("settings.timeRegulations.restPeriodSection", "Rest Period (ArbZG §5)")}
				</h4>
				<div className="space-y-4">
					<form.Field
						name="minRestPeriodMinutes"
						validators={{
							onChange: ({ value, fieldApi }) => {
								if (!fieldApi.form.state.values.regulationEnabled) return undefined;
								if (value === null) return undefined;
								if (!Number.isInteger(value) || value < 1 || value > 1440) {
									return t(
										"settings.timeRegulations.minRestPeriodError",
										"Must be greater than 0 and at most 24 hours",
									);
								}
								return undefined;
							},
						}}
					>
						{(field) => {
							const error = field.state.meta.errors[0];
							return (
								<div className="space-y-2">
									<Label htmlFor="work-policy-min-rest-period">
										{t("settings.timeRegulations.minRestPeriod", "Minimum Rest Period")}
									</Label>
									<div className="flex items-center gap-2">
										<Input
											id="work-policy-min-rest-period"
											name="minRestPeriodHours"
											inputMode="decimal"
											type="number"
											min="0.5"
											max="24"
											step="0.5"
											value={formatMinutesAsHours(field.state.value)}
											onChange={(e) => field.handleChange(parseHoursInputToMinutes(e.target.value))}
											onBlur={field.handleBlur}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? "work-policy-min-rest-period-error" : undefined}
											placeholder="—"
											className="w-24 tabular-nums"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.workSchedules.hoursUnit", "hours")}
										</span>
									</div>
									{error && (
										<p
											id="work-policy-min-rest-period-error"
											role="alert"
											className="text-sm text-destructive"
										>
											{error}
										</p>
									)}
								</div>
							);
						}}
					</form.Field>

					<div className="space-y-2">
						<Label id="work-policy-rest-enforcement-label">
							{t("settings.timeRegulations.restPeriodEnforcement", "Rest Period Enforcement")}
						</Label>
						<form.Field name="restPeriodEnforcement">
							{(field) => (
								<RadioGroup
									aria-labelledby="work-policy-rest-enforcement-label"
									value={field.state.value}
									onValueChange={(v) => field.handleChange(v as RestPeriodEnforcementType)}
									className="grid gap-3 sm:grid-cols-3"
								>
									<label
										htmlFor="rest-period-enforcement-none"
										className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer has-data-checked:border-primary"
									>
										<RadioGroupItem id="rest-period-enforcement-none" value="none" />
										<div className="space-y-0.5">
											<span className="text-sm font-medium">
												{t("settings.timeRegulations.restEnforcementNone", "None")}
											</span>
											<p className="text-xs text-muted-foreground">
												{t("settings.timeRegulations.restEnforcementNoneDescription", "Track only")}
											</p>
										</div>
									</label>
									<label
										htmlFor="rest-period-enforcement-warn"
										className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer has-data-checked:border-primary"
									>
										<RadioGroupItem id="rest-period-enforcement-warn" value="warn" />
										<div className="space-y-0.5">
											<span className="text-sm font-medium">
												{t("settings.timeRegulations.restEnforcementWarn", "Warn")}
											</span>
											<p className="text-xs text-muted-foreground">
												{t(
													"settings.timeRegulations.restEnforcementWarnDescription",
													"Warn on clock-in",
												)}
											</p>
										</div>
									</label>
									<label
										htmlFor="rest-period-enforcement-block"
										className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer has-data-checked:border-primary"
									>
										<RadioGroupItem id="rest-period-enforcement-block" value="block" />
										<div className="space-y-0.5">
											<span className="text-sm font-medium">
												{t("settings.timeRegulations.restEnforcementBlock", "Block")}
											</span>
											<p className="text-xs text-muted-foreground">
												{t(
													"settings.timeRegulations.restEnforcementBlockDescription",
													"Prevent clock-in",
												)}
											</p>
										</div>
									</label>
								</RadioGroup>
							)}
						</form.Field>
					</div>
				</div>
			</div>

			{/* Overtime Thresholds */}
			<div className="space-y-4">
				<h4 className="text-sm text-muted-foreground">
					{t("settings.timeRegulations.overtimeThresholdsSection", "Overtime Thresholds")}
				</h4>
				<div className="grid gap-4 sm:grid-cols-3">
					<form.Field
						name="overtimeDailyThresholdMinutes"
						validators={{
							onChange: ({ value, fieldApi }) => {
								if (!fieldApi.form.state.values.regulationEnabled) return undefined;
								if (value === null) return undefined;
								if (!Number.isInteger(value) || value < 1 || value > 1440) {
									return t(
										"settings.timeRegulations.overtimeDailyThresholdError",
										"Must be greater than 0 and at most 24 hours",
									);
								}
								return undefined;
							},
						}}
					>
						{(field) => {
							const error = field.state.meta.errors[0];
							return (
								<div className="space-y-2">
									<Label htmlFor="work-policy-overtime-daily">
										{t(
											"settings.timeRegulations.overtimeDailyThreshold",
											"Daily Overtime Threshold",
										)}
									</Label>
									<div className="flex items-center gap-2">
										<Input
											id="work-policy-overtime-daily"
											name="overtimeDailyThresholdHours"
											inputMode="decimal"
											type="number"
											min="0.5"
											max="24"
											step="0.5"
											value={formatMinutesAsHours(field.state.value)}
											onChange={(e) => field.handleChange(parseHoursInputToMinutes(e.target.value))}
											onBlur={field.handleBlur}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? "work-policy-overtime-daily-error" : undefined}
											placeholder="—"
											className="w-24 tabular-nums"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.workSchedules.hoursUnit", "hours")}
										</span>
									</div>
									{error && (
										<p
											id="work-policy-overtime-daily-error"
											role="alert"
											className="text-sm text-destructive"
										>
											{error}
										</p>
									)}
								</div>
							);
						}}
					</form.Field>

					<form.Field
						name="overtimeWeeklyThresholdMinutes"
						validators={{
							onChange: ({ value, fieldApi }) => {
								if (!fieldApi.form.state.values.regulationEnabled) return undefined;
								if (value === null) return undefined;
								if (!Number.isInteger(value) || value < 1 || value > 10080) {
									return t(
										"settings.timeRegulations.overtimeWeeklyThresholdError",
										"Must be greater than 0 and at most 168 hours",
									);
								}
								return undefined;
							},
						}}
					>
						{(field) => {
							const error = field.state.meta.errors[0];
							return (
								<div className="space-y-2">
									<Label htmlFor="work-policy-overtime-weekly">
										{t(
											"settings.timeRegulations.overtimeWeeklyThreshold",
											"Weekly Overtime Threshold",
										)}
									</Label>
									<div className="flex items-center gap-2">
										<Input
											id="work-policy-overtime-weekly"
											name="overtimeWeeklyThresholdHours"
											inputMode="decimal"
											type="number"
											min="0.5"
											max="168"
											step="0.5"
											value={formatMinutesAsHours(field.state.value)}
											onChange={(e) => field.handleChange(parseHoursInputToMinutes(e.target.value))}
											onBlur={field.handleBlur}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? "work-policy-overtime-weekly-error" : undefined}
											placeholder="—"
											className="w-24 tabular-nums"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.workSchedules.hoursUnit", "hours")}
										</span>
									</div>
									{error && (
										<p
											id="work-policy-overtime-weekly-error"
											role="alert"
											className="text-sm text-destructive"
										>
											{error}
										</p>
									)}
								</div>
							);
						}}
					</form.Field>

					<form.Field
						name="overtimeMonthlyThresholdMinutes"
						validators={{
							onChange: ({ value, fieldApi }) => {
								if (!fieldApi.form.state.values.regulationEnabled) return undefined;
								if (value === null) return undefined;
								if (!Number.isInteger(value) || value < 1 || value > 44640) {
									return t(
										"settings.timeRegulations.overtimeMonthlyThresholdError",
										"Must be greater than 0 and at most 744 hours",
									);
								}
								return undefined;
							},
						}}
					>
						{(field) => {
							const error = field.state.meta.errors[0];
							return (
								<div className="space-y-2">
									<Label htmlFor="work-policy-overtime-monthly">
										{t(
											"settings.timeRegulations.overtimeMonthlyThreshold",
											"Monthly Overtime Threshold",
										)}
									</Label>
									<div className="flex items-center gap-2">
										<Input
											id="work-policy-overtime-monthly"
											name="overtimeMonthlyThresholdHours"
											inputMode="decimal"
											type="number"
											min="0.5"
											max="744"
											step="0.5"
											value={formatMinutesAsHours(field.state.value)}
											onChange={(e) => field.handleChange(parseHoursInputToMinutes(e.target.value))}
											onBlur={field.handleBlur}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? "work-policy-overtime-monthly-error" : undefined}
											placeholder="—"
											className="w-24 tabular-nums"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.workSchedules.hoursUnit", "hours")}
										</span>
									</div>
									{error && (
										<p
											id="work-policy-overtime-monthly-error"
											role="alert"
											className="text-sm text-destructive"
										>
											{error}
										</p>
									)}
								</div>
							);
						}}
					</form.Field>
				</div>
			</div>

			{/* Proactive Alerts */}
			<div className="space-y-4">
				<h4 className="text-sm text-muted-foreground">
					{t("settings.timeRegulations.proactiveAlertsSection", "Proactive Alerts")}
				</h4>
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field
						name="alertBeforeLimitMinutes"
						validators={{
							onChange: ({ value, fieldApi }) => {
								if (!fieldApi.form.state.values.regulationEnabled) return undefined;
								if (value === null) return undefined;
								if (!Number.isInteger(value) || value < 0 || value > 1440) {
									return t(
										"settings.timeRegulations.alertBeforeLimitError",
										"Must be between 0 and 1440 minutes",
									);
								}
								return undefined;
							},
						}}
					>
						{(field) => {
							const error = field.state.meta.errors[0];
							return (
								<div className="space-y-2">
									<Label htmlFor="work-policy-alert-before-limit">
										{t("settings.timeRegulations.alertBeforeLimit", "Alert Before Limit")}
									</Label>
									<div className="flex items-center gap-2">
										<Input
											id="work-policy-alert-before-limit"
											name="alertBeforeLimitMinutes"
											inputMode="numeric"
											type="number"
											min="0"
											max="1440"
											value={field.state.value !== null ? String(field.state.value) : ""}
											onChange={(e) => field.handleChange(parseNumericInput(e.target.value))}
											onBlur={field.handleBlur}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? "work-policy-alert-before-limit-error" : undefined}
											placeholder="—"
											className="w-24 tabular-nums"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.timeRegulations.minutes", "minutes")}
										</span>
									</div>
									{error && (
										<p
											id="work-policy-alert-before-limit-error"
											role="alert"
											className="text-sm text-destructive"
										>
											{error}
										</p>
									)}
								</div>
							);
						}}
					</form.Field>

					<form.Field
						name="alertThresholdPercent"
						validators={{
							onChange: ({ value, fieldApi }) => {
								if (!fieldApi.form.state.values.regulationEnabled) return undefined;
								if (value === null) return undefined;
								if (!Number.isInteger(value) || value < 1 || value > 100) {
									return t(
										"settings.timeRegulations.alertThresholdPercentError",
										"Must be between 1 and 100%",
									);
								}
								return undefined;
							},
						}}
					>
						{(field) => {
							const error = field.state.meta.errors[0];
							return (
								<div className="space-y-2">
									<Label htmlFor="work-policy-alert-threshold-percent">
										{t("settings.timeRegulations.alertThresholdPercent", "Alert Threshold")}
									</Label>
									<div className="flex items-center gap-2">
										<Input
											id="work-policy-alert-threshold-percent"
											name="alertThresholdPercent"
											inputMode="numeric"
											type="number"
											min="1"
											max="100"
											value={field.state.value !== null ? String(field.state.value) : ""}
											onChange={(e) => field.handleChange(parseNumericInput(e.target.value))}
											onBlur={field.handleBlur}
											aria-invalid={error ? true : undefined}
											aria-describedby={
												error ? "work-policy-alert-threshold-percent-error" : undefined
											}
											placeholder="—"
											className="w-24 tabular-nums"
										/>
										<span className="text-sm text-muted-foreground">%</span>
									</div>
									{error && (
										<p
											id="work-policy-alert-threshold-percent-error"
											role="alert"
											className="text-sm text-destructive"
										>
											{error}
										</p>
									)}
								</div>
							);
						}}
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
								<IconPlus className="mr-2 size-4" aria-hidden="true" />
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
								field.state.value.map((_rule, ruleIndex) => {
									// Keyed by position: a value-based key remounted the editor on every
									// keystroke and dropped focus from the field being typed in.
									const ruleKey = `break-rule-${ruleIndex}`;
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
	);
}
