"use client";

import { IconClock, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/navigation";
import { checkIsAdmin, createWorkTemplateOnboarding, skipWorkTemplateSetup } from "./actions";

const DAYS_OF_WEEK = [
	{ value: "monday", label: "Monday", shortLabel: "Mon" },
	{ value: "tuesday", label: "Tuesday", shortLabel: "Tue" },
	{ value: "wednesday", label: "Wednesday", shortLabel: "Wed" },
	{ value: "thursday", label: "Thursday", shortLabel: "Thu" },
	{ value: "friday", label: "Friday", shortLabel: "Fri" },
	{ value: "saturday", label: "Saturday", shortLabel: "Sat" },
	{ value: "sunday", label: "Sunday", shortLabel: "Sun" },
] as const;

type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export default function WorkTemplatesPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

	const form = useForm({
		defaultValues: {
			name: t("onboarding.workTemplates.defaultName", "Standard"),
			hoursPerWeek: 40,
			workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] as DayOfWeek[],
			setAsDefault: true,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await createWorkTemplateOnboarding(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("onboarding.workTemplates.success", "Work schedule template created!"));
				router.push("/onboarding/notifications");
			} else {
				toast.error(
					result.error ||
						t("onboarding.workTemplates.error", "Failed to create work schedule template"),
				);
			}
		},
	});

	const formValues = useStore(form.store, (state) => state.values);
	const workingDays = formValues.workingDays;
	const hoursPerWeek = formValues.hoursPerWeek;

	// Check if user is admin, redirect if not
	useEffect(() => {
		async function checkAdmin() {
			const result = await checkIsAdmin();
			if (result.success) {
				setIsAdmin(result.data);
				if (!result.data) {
					router.push("/onboarding/notifications");
				}
			} else {
				router.push("/onboarding/notifications");
			}
		}
		checkAdmin();
	}, [router]);

	async function handleSkip() {
		setLoading(true);

		const result = await skipWorkTemplateSetup();

		setLoading(false);

		if (result.success) {
			router.push("/onboarding/notifications");
		} else {
			toast.error(result.error || "Failed to skip work schedule template setup");
		}
	}

	// Show loading while checking admin status
	if (isAdmin === null) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<div className="text-center">
					<div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
					<p className="mt-4 text-muted-foreground">{t("common.loading", "Loading...")}</p>
				</div>
			</div>
		);
	}

	// Calculate hours per day
	const hoursPerDay = workingDays.length > 0 ? (hoursPerWeek / workingDays.length).toFixed(1) : "0";

	return (
		<>
			<ProgressIndicator currentStep="work_templates" />

			<div className="mx-auto max-w-2xl">
				<div className="mb-8 text-center">
					<div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
						<IconClock className="size-8 text-primary" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight">
						{t("onboarding.workTemplates.title", "Create work schedule template")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"onboarding.workTemplates.subtitle",
							"Set up a work schedule template for your organization. This defines working hours for your team.",
						)}
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>
							{t("onboarding.workTemplates.cardTitle", "Work Schedule Template")}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.workTemplates.cardDesc",
								"Create a default work schedule. You can add more templates later in settings.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
							{/* Template Name */}
							<form.Field
								name="name"
								validators={{
									onChange: z.string().min(1, "Template name is required").max(100),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.workTemplates.name", "Template Name")}</Label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"onboarding.workTemplates.namePlaceholder",
												"e.g., Full-Time, Part-Time",
											)}
											disabled={loading}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.workTemplates.nameDesc",
												"A name to identify this work schedule.",
											)}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm font-medium text-destructive">
												{typeof field.state.meta.errors[0] === "string"
													? field.state.meta.errors[0]
													: (field.state.meta.errors[0] as any)?.message}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Hours Per Week */}
							<form.Field
								name="hoursPerWeek"
								validators={{
									onChange: z.number().min(0).max(168),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.workTemplates.hoursPerWeek", "Hours per Week")}</Label>
										<Input
											type="number"
											min={0}
											max={168}
											placeholder="40"
											disabled={loading}
											value={field.state.value}
											onChange={(e) => field.handleChange(parseFloat(e.target.value) || 0)}
											onBlur={field.handleBlur}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.workTemplates.hoursPerWeekDesc",
												"Total working hours per week. Typical full-time is 40 hours.",
											)}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm font-medium text-destructive">
												{typeof field.state.meta.errors[0] === "string"
													? field.state.meta.errors[0]
													: (field.state.meta.errors[0] as any)?.message}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Working Days */}
							<form.Field name="workingDays">
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.workTemplates.workingDays", "Working Days")}</Label>
										<div className="grid grid-cols-7 gap-2">
											{DAYS_OF_WEEK.map((day) => (
												<div key={day.value} className="flex flex-col items-center space-y-2">
													<Checkbox
														checked={field.state.value?.includes(day.value)}
														onCheckedChange={(checked) => {
															const currentValue = field.state.value || [];
															if (checked) {
																field.handleChange([...currentValue, day.value]);
															} else {
																field.handleChange(
																	currentValue.filter((v: DayOfWeek) => v !== day.value),
																);
															}
														}}
														disabled={loading}
														className="size-6"
													/>
													<Label className="text-xs font-normal">{day.shortLabel}</Label>
												</div>
											))}
										</div>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.workTemplates.workingDaysDesc",
												"Select which days are working days. Hours will be distributed evenly.",
											)}
										</p>
									</div>
								)}
							</form.Field>

							{/* Summary Preview */}
							{workingDays.length > 0 && (
								<div className="rounded-lg border bg-muted/50 p-4">
									<p className="text-sm font-medium">
										{t("onboarding.workTemplates.preview", "Schedule Preview")}
									</p>
									<p className="mt-1 text-sm text-muted-foreground">
										{t(
											"onboarding.workTemplates.previewText",
											"{days} working days, {hoursPerDay} hours per day",
											{
												days: workingDays.length,
												hoursPerDay,
											},
										)}
									</p>
								</div>
							)}

							{/* Set as Default */}
							<form.Field name="setAsDefault">
								{(field) => (
									<div className="flex flex-row items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label className="text-base">
												{t("onboarding.workTemplates.setAsDefault", "Set as organization default")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"onboarding.workTemplates.setAsDefaultDesc",
													"Apply this schedule to all employees.",
												)}
											</p>
										</div>
										<Switch
											checked={field.state.value}
											onCheckedChange={field.handleChange}
											disabled={loading}
										/>
									</div>
								)}
							</form.Field>

							{/* Action Buttons */}
							<div className="flex gap-3 pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={handleSkip}
									disabled={loading}
									className="flex-1"
								>
									{t("onboarding.workTemplates.skip", "Skip for now")}
								</Button>
								<Button
									type="submit"
									disabled={loading || workingDays.length === 0}
									className="flex-1"
								>
									{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{t("onboarding.workTemplates.continue", "Continue")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
