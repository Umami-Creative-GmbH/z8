"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
	createWorkScheduleTemplate,
	updateWorkScheduleTemplate,
	type WorkScheduleTemplateWithDays,
} from "@/app/[locale]/(app)/settings/work-schedules/actions";
import {
	generateDaysFromPreset,
	WorkSchedulePreview,
} from "@/components/settings/work-schedule-preview";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface WorkScheduleTemplateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingTemplate: WorkScheduleTemplateWithDays | null;
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

interface DayConfig {
	dayOfWeek: DayOfWeek;
	hoursPerDay: string;
	isWorkDay: boolean;
	cycleWeek: number;
}

interface FormValues {
	name: string;
	description: string;
	scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
	scheduleType: "simple" | "detailed";
	workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
	hoursPerCycle: string;
	homeOfficeDaysPerCycle: number;
	days: DayConfig[];
}

const defaultDays: DayConfig[] = DAYS_OF_WEEK.map((day) => ({
	dayOfWeek: day.value,
	hoursPerDay: day.value === "saturday" || day.value === "sunday" ? "0" : "8",
	isWorkDay: day.value !== "saturday" && day.value !== "sunday",
	cycleWeek: 1,
}));

export function WorkScheduleTemplateDialog({
	open,
	onOpenChange,
	organizationId,
	editingTemplate,
	onSuccess,
}: WorkScheduleTemplateDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!editingTemplate;

	const form = useForm({
		defaultValues: {
			name: "",
			description: "",
			scheduleCycle: "weekly" as "daily" | "weekly" | "biweekly" | "monthly" | "yearly",
			scheduleType: "simple" as "simple" | "detailed",
			workingDaysPreset: "weekdays" as "weekdays" | "weekends" | "all_days" | "custom",
			hoursPerCycle: "40",
			homeOfficeDaysPerCycle: 0,
			days: defaultDays,
		},
		onSubmit: async ({ value }) => {
			if (isEditing) {
				updateMutation.mutate(value);
			} else {
				createMutation.mutate(value);
			}
		},
	});

	// Reset form when opening/closing or when editing template changes
	useEffect(() => {
		if (open) {
			if (editingTemplate) {
				form.reset();
				form.setFieldValue("name", editingTemplate.name);
				form.setFieldValue("description", editingTemplate.description || "");
				form.setFieldValue("scheduleCycle", editingTemplate.scheduleCycle);
				form.setFieldValue("scheduleType", editingTemplate.scheduleType);
				form.setFieldValue("workingDaysPreset", editingTemplate.workingDaysPreset);
				form.setFieldValue("hoursPerCycle", editingTemplate.hoursPerCycle || "40");
				form.setFieldValue("homeOfficeDaysPerCycle", editingTemplate.homeOfficeDaysPerCycle || 0);
				form.setFieldValue(
					"days",
					editingTemplate.days.length > 0
						? editingTemplate.days.map((d) => ({
								dayOfWeek: d.dayOfWeek as DayOfWeek,
								hoursPerDay: d.hoursPerDay,
								isWorkDay: d.isWorkDay,
								cycleWeek: d.cycleWeek ?? 1,
							}))
						: defaultDays,
				);
			} else {
				form.reset();
			}
		}
	}, [open, editingTemplate, form]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (data: FormValues) => {
			const payload =
				data.scheduleType === "simple"
					? {
							scheduleType: "simple" as const,
							name: data.name,
							description: data.description,
							scheduleCycle: data.scheduleCycle,
							workingDaysPreset: data.workingDaysPreset,
							hoursPerCycle: data.hoursPerCycle || "0",
							homeOfficeDaysPerCycle: data.homeOfficeDaysPerCycle,
						}
					: {
							scheduleType: "detailed" as const,
							name: data.name,
							description: data.description,
							scheduleCycle: data.scheduleCycle,
							workingDaysPreset: "custom" as const,
							homeOfficeDaysPerCycle: data.homeOfficeDaysPerCycle,
							days: data.days || defaultDays,
						};
			return createWorkScheduleTemplate(organizationId, payload);
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workSchedules.created", "Template created"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.workSchedules.createFailed", "Failed to create"));
			}
		},
		onError: () => {
			toast.error(t("settings.workSchedules.createFailed", "Failed to create template"));
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: (data: FormValues) =>
			updateWorkScheduleTemplate(editingTemplate!.id, {
				name: data.name,
				description: data.description,
				scheduleCycle: data.scheduleCycle,
				scheduleType: data.scheduleType,
				workingDaysPreset: data.scheduleType === "detailed" ? "custom" : data.workingDaysPreset,
				hoursPerCycle: data.scheduleType === "simple" ? data.hoursPerCycle : null,
				homeOfficeDaysPerCycle: data.homeOfficeDaysPerCycle,
				days: data.scheduleType === "detailed" ? data.days : undefined,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workSchedules.updated", "Template updated"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.workSchedules.updateFailed", "Failed to update"));
			}
		},
		onError: () => {
			toast.error(t("settings.workSchedules.updateFailed", "Failed to update template"));
		},
	});

	const isPending = createMutation.isPending || updateMutation.isPending;

	// Subscribe to form values for conditional rendering and preview
	const scheduleType = useStore(form.store, (state) => state.values.scheduleType);
	const days = useStore(form.store, (state) => state.values.days) || defaultDays;
	const workingDaysPreset = useStore(form.store, (state) => state.values.workingDaysPreset);
	const hoursPerCycle = useStore(form.store, (state) => state.values.hoursPerCycle);
	const scheduleCycle = useStore(form.store, (state) => state.values.scheduleCycle);
	const homeOfficeDaysPerCycle = useStore(
		form.store,
		(state) => state.values.homeOfficeDaysPerCycle,
	);

	// Calculate total hours for detailed mode
	const totalHours = days
		.filter((d) => d.isWorkDay)
		.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);

	// Generate preview days based on schedule type
	const previewDays = useMemo(() => {
		if (scheduleType === "detailed") {
			return days;
		}
		// For simple mode, generate days from preset and distribute hours
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
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.workSchedules.editTemplate", "Edit Template")
							: t("settings.workSchedules.createTemplate", "Create Template")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.workSchedules.templateDescription",
							"Define a work schedule template that can be assigned to your organization, teams, or individual employees.",
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
									<Label>{t("settings.workSchedules.name", "Name")}</Label>
									<Input
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("settings.workSchedules.namePlaceholder", "e.g., Full-Time 40h")}
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
									<Label>{t("settings.workSchedules.descriptionLabel", "Description")}</Label>
									<Textarea
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.workSchedules.descriptionPlaceholder",
											"Optional description",
										)}
									/>
								</div>
							)}
						</form.Field>
					</div>

					{/* Schedule Configuration */}
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="scheduleCycle">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.workSchedules.cycle", "Cycle")}</Label>
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
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.workSchedules.cycleDescription",
											"The time period for this schedule",
										)}
									</p>
								</div>
							)}
						</form.Field>

						<form.Field name="homeOfficeDaysPerCycle">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.workSchedules.homeOfficeDays", "Home Office Days")}</Label>
									<Input
										type="number"
										min="0"
										max="31"
										value={field.state.value}
										onChange={(e) => field.handleChange(Number(e.target.value))}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.workSchedules.homeOfficeDaysDescription",
											"Allowed home office days per cycle",
										)}
									</p>
								</div>
							)}
						</form.Field>
					</div>

					{/* Schedule Type Tabs */}
					<form.Field name="scheduleType">
						{(field) => (
							<div className="space-y-2">
								<Label>{t("settings.workSchedules.type", "Schedule Type")}</Label>
								<Tabs
									value={field.state.value}
									onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
									className="mt-2"
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
													<Label>{t("settings.workSchedules.workingDays", "Working Days")}</Label>
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
													<p className="text-sm text-muted-foreground">
														{t(
															"settings.workSchedules.hoursPerCycleDescription",
															"Total working hours per cycle (e.g., 40 for weekly)",
														)}
													</p>
												</div>
											)}
										</form.Field>
									</TabsContent>

									<TabsContent value="detailed" className="space-y-4 pt-4">
										<div className="text-sm text-muted-foreground mb-4">
											{t(
												"settings.workSchedules.detailedDescription",
												"Configure hours for each day of the week",
											)}
										</div>
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
																newDays[index] = { ...newDays[index], hoursPerDay: e.target.value };
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
							</div>
						)}
					</form.Field>

					{/* Schedule Preview */}
					<div className="space-y-2 rounded-lg border bg-muted/30 p-4">
						<div className="text-sm font-medium">
							{t("settings.workSchedules.preview", "Schedule Preview")}
						</div>
						<WorkSchedulePreview
							days={previewDays}
							homeOfficeDaysPerCycle={homeOfficeDaysPerCycle}
							scheduleCycle={scheduleCycle}
						/>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
