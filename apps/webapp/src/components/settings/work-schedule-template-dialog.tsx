"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
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
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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

const formSchema = z.object({
	name: z.string().min(1, "Name is required").max(100),
	description: z.string().max(500).optional(),
	scheduleCycle: z.enum(["daily", "weekly", "biweekly", "monthly", "yearly"]),
	scheduleType: z.enum(["simple", "detailed"]),
	workingDaysPreset: z.enum(["weekdays", "weekends", "all_days", "custom"]),
	hoursPerCycle: z.string().optional(),
	homeOfficeDaysPerCycle: z.coerce.number().min(0).max(31),
	days: z
		.array(
			z.object({
				dayOfWeek: z.enum([
					"monday",
					"tuesday",
					"wednesday",
					"thursday",
					"friday",
					"saturday",
					"sunday",
				]),
				hoursPerDay: z.string(),
				isWorkDay: z.boolean(),
			}),
		)
		.optional(),
});

type FormValues = z.infer<typeof formSchema>;

const defaultDays = DAYS_OF_WEEK.map((day) => ({
	dayOfWeek: day.value,
	hoursPerDay: day.value === "saturday" || day.value === "sunday" ? "0" : "8",
	isWorkDay: day.value !== "saturday" && day.value !== "sunday",
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

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: "",
			description: "",
			scheduleCycle: "weekly",
			scheduleType: "simple",
			workingDaysPreset: "weekdays",
			hoursPerCycle: "40",
			homeOfficeDaysPerCycle: 0,
			days: defaultDays,
		},
	});

	// Reset form when opening/closing or when editing template changes
	useEffect(() => {
		if (open) {
			if (editingTemplate) {
				form.reset({
					name: editingTemplate.name,
					description: editingTemplate.description || "",
					scheduleCycle: editingTemplate.scheduleCycle,
					scheduleType: editingTemplate.scheduleType,
					workingDaysPreset: editingTemplate.workingDaysPreset,
					hoursPerCycle: editingTemplate.hoursPerCycle || "40",
					homeOfficeDaysPerCycle: editingTemplate.homeOfficeDaysPerCycle || 0,
					days:
						editingTemplate.days.length > 0
							? editingTemplate.days.map((d) => ({
									dayOfWeek: d.dayOfWeek,
									hoursPerDay: d.hoursPerDay,
									isWorkDay: d.isWorkDay,
								}))
							: defaultDays,
				});
			} else {
				form.reset({
					name: "",
					description: "",
					scheduleCycle: "weekly",
					scheduleType: "simple",
					workingDaysPreset: "weekdays",
					hoursPerCycle: "40",
					homeOfficeDaysPerCycle: 0,
					days: defaultDays,
				});
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
			updateWorkScheduleTemplate(editingTemplate?.id, {
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

	const onSubmit = (data: FormValues) => {
		if (isEditing) {
			updateMutation.mutate(data);
		} else {
			createMutation.mutate(data);
		}
	};

	const isPending = createMutation.isPending || updateMutation.isPending;
	const scheduleType = form.watch("scheduleType");
	const days = form.watch("days") || defaultDays;
	const workingDaysPreset = form.watch("workingDaysPreset");
	const hoursPerCycle = form.watch("hoursPerCycle");
	const scheduleCycle = form.watch("scheduleCycle");
	const homeOfficeDaysPerCycle = form.watch("homeOfficeDaysPerCycle");

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

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
						{/* Basic Info */}
						<div className="grid gap-4 sm:grid-cols-2">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem className="sm:col-span-2">
										<FormLabel>{t("settings.workSchedules.name", "Name")}</FormLabel>
										<FormControl>
											<Input
												placeholder={t(
													"settings.workSchedules.namePlaceholder",
													"e.g., Full-Time 40h",
												)}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="description"
								render={({ field }) => (
									<FormItem className="sm:col-span-2">
										<FormLabel>
											{t("settings.workSchedules.descriptionLabel", "Description")}
										</FormLabel>
										<FormControl>
											<Textarea
												placeholder={t(
													"settings.workSchedules.descriptionPlaceholder",
													"Optional description",
												)}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Schedule Configuration */}
						<div className="grid gap-4 sm:grid-cols-2">
							<FormField
								control={form.control}
								name="scheduleCycle"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("settings.workSchedules.cycle", "Cycle")}</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
											</FormControl>
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
										<FormDescription>
											{t(
												"settings.workSchedules.cycleDescription",
												"The time period for this schedule",
											)}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="homeOfficeDaysPerCycle"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("settings.workSchedules.homeOfficeDays", "Home Office Days")}
										</FormLabel>
										<FormControl>
											<Input type="number" min="0" max="31" {...field} />
										</FormControl>
										<FormDescription>
											{t(
												"settings.workSchedules.homeOfficeDaysDescription",
												"Allowed home office days per cycle",
											)}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Schedule Type Tabs */}
						<FormField
							control={form.control}
							name="scheduleType"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("settings.workSchedules.type", "Schedule Type")}</FormLabel>
									<Tabs value={field.value} onValueChange={field.onChange} className="mt-2">
										<TabsList className="grid w-full grid-cols-2">
											<TabsTrigger value="simple">
												{t("settings.workSchedules.type.simple", "Simple")}
											</TabsTrigger>
											<TabsTrigger value="detailed">
												{t("settings.workSchedules.type.detailed", "Detailed")}
											</TabsTrigger>
										</TabsList>

										<TabsContent value="simple" className="space-y-4 pt-4">
											<FormField
												control={form.control}
												name="workingDaysPreset"
												render={({ field: presetField }) => (
													<FormItem>
														<FormLabel>
															{t("settings.workSchedules.workingDays", "Working Days")}
														</FormLabel>
														<Select onValueChange={presetField.onChange} value={presetField.value}>
															<FormControl>
																<SelectTrigger>
																	<SelectValue />
																</SelectTrigger>
															</FormControl>
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
														<FormMessage />
													</FormItem>
												)}
											/>

											<FormField
												control={form.control}
												name="hoursPerCycle"
												render={({ field: hoursField }) => (
													<FormItem>
														<FormLabel>
															{t("settings.workSchedules.hoursPerCycle", "Hours per Cycle")}
														</FormLabel>
														<FormControl>
															<Input type="number" min="0" max="744" step="0.5" {...hoursField} />
														</FormControl>
														<FormDescription>
															{t(
																"settings.workSchedules.hoursPerCycleDescription",
																"Total working hours per cycle (e.g., 40 for weekly)",
															)}
														</FormDescription>
														<FormMessage />
													</FormItem>
												)}
											/>
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
														<FormField
															control={form.control}
															name={`days.${index}.isWorkDay`}
															render={({ field: checkField }) => (
																<FormItem className="flex items-center space-x-2 space-y-0">
																	<FormControl>
																		<Checkbox
																			checked={checkField.value}
																			onCheckedChange={checkField.onChange}
																		/>
																	</FormControl>
																</FormItem>
															)}
														/>
														<span className="w-24 font-medium">{day.label}</span>
														<FormField
															control={form.control}
															name={`days.${index}.hoursPerDay`}
															render={({ field: hoursField }) => (
																<FormItem className="flex-1">
																	<FormControl>
																		<Input
																			type="number"
																			min="0"
																			max="24"
																			step="0.5"
																			disabled={!days[index]?.isWorkDay}
																			placeholder="0"
																			{...hoursField}
																		/>
																	</FormControl>
																</FormItem>
															)}
														/>
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
									<FormMessage />
								</FormItem>
							)}
						/>

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
				</Form>
			</DialogContent>
		</Dialog>
	);
}
