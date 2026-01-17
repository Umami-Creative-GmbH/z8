"use client";

import { IconDroplet, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/navigation";
import {
	CUSTOM_INTERVAL_RANGE,
	DAILY_GOAL_RANGE,
	WATER_PRESETS,
	type WaterReminderPreset,
} from "@/lib/wellness/water-presets";
import { configureWellnessOnboarding, skipWellnessSetup } from "./actions";

export default function WellnessPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues: {
			enableWaterReminder: false,
			waterReminderPreset: "moderate" as WaterReminderPreset,
			waterReminderIntervalMinutes: 45,
			waterReminderDailyGoal: 8,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await configureWellnessOnboarding(value);

			setLoading(false);

			if (result.success) {
				if (value.enableWaterReminder) {
					toast.success(t("onboarding.wellness.success", "Water reminder enabled!"));
				}
				router.push("/onboarding/notifications");
			} else {
				toast.error(
					result.error || t("onboarding.wellness.error", "Failed to save wellness settings"),
				);
			}
		},
	});

	async function handleSkip() {
		setLoading(true);

		const result = await skipWellnessSetup();

		setLoading(false);

		if (result.success) {
			router.push("/onboarding/notifications");
		} else {
			toast.error(result.error || "Failed to skip wellness setup");
		}
	}

	// Track form values for conditional rendering
	const [isEnabled, setIsEnabled] = useState(false);
	const [selectedPreset, setSelectedPreset] = useState<WaterReminderPreset>("moderate");
	const isCustom = selectedPreset === "custom";

	// Sync form state to component state for conditional rendering
	useEffect(() => {
		return form.store.subscribe(() => {
			const values = form.store.state.values;
			setIsEnabled(values.enableWaterReminder);
			setSelectedPreset(values.waterReminderPreset);
		});
	}, [form.store]);

	function handlePresetChange(preset: WaterReminderPreset) {
		form.setFieldValue("waterReminderPreset", preset);
		if (preset !== "custom") {
			form.setFieldValue("waterReminderIntervalMinutes", WATER_PRESETS[preset].intervalMinutes);
		}
	}

	return (
		<>
			<ProgressIndicator currentStep="wellness" />

			<div className="mx-auto max-w-2xl">
				<div className="mb-8 text-center">
					<div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/20">
						<IconDroplet className="size-8 text-blue-600 dark:text-blue-400" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight">
						{t("onboarding.wellness.title", "Stay Hydrated")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"onboarding.wellness.subtitle",
							"Set up water reminders to stay healthy during your workday. You'll receive gentle notifications to drink water while clocked in.",
						)}
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconDroplet className="size-5" />
							{t("onboarding.wellness.cardTitle", "Water Reminders")}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.wellness.cardDesc",
								"Enable optional hydration reminders while you work. You can always adjust these settings later.",
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
							{/* Enable Toggle */}
							<form.Field name="enableWaterReminder">
								{(field) => (
									<div className="flex flex-row items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label className="text-base">
												{t("onboarding.wellness.enableReminder", "Enable Water Reminders")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"onboarding.wellness.enableReminderDesc",
													"Receive gentle reminders to drink water during work hours.",
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

							{/* Settings when enabled */}
							{isEnabled && (
								<div className="space-y-4 rounded-lg bg-muted/50 p-4">
									{/* Preset Selection */}
									<div className="space-y-2">
										<Label>{t("onboarding.wellness.reminderFrequency", "Reminder Frequency")}</Label>
										<Select value={selectedPreset} onValueChange={handlePresetChange}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{Object.values(WATER_PRESETS).map((preset) => (
													<SelectItem key={preset.id} value={preset.id}>
														<span className="flex items-center gap-2">
															{preset.label}
															{preset.recommended && (
																<span className="text-xs text-primary">(Recommended)</span>
															)}
														</span>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-xs text-muted-foreground">
											{WATER_PRESETS[selectedPreset].description}
										</p>
									</div>

									{/* Custom Interval Slider */}
									{isCustom && (
										<form.Field name="waterReminderIntervalMinutes">
											{(field) => (
												<div className="space-y-2">
													<div className="flex items-center justify-between">
														<Label>
															{t("onboarding.wellness.customInterval", "Custom Interval")}
														</Label>
														<span className="text-sm font-medium">{field.state.value} min</span>
													</div>
													<Slider
														value={[field.state.value]}
														onValueChange={(value) => field.handleChange(value[0])}
														min={CUSTOM_INTERVAL_RANGE.min}
														max={CUSTOM_INTERVAL_RANGE.max}
														step={5}
														disabled={loading}
													/>
													<div className="flex justify-between text-xs text-muted-foreground">
														<span>{CUSTOM_INTERVAL_RANGE.min} min</span>
														<span>{CUSTOM_INTERVAL_RANGE.max} min</span>
													</div>
												</div>
											)}
										</form.Field>
									)}

									{/* Daily Goal */}
									<form.Field name="waterReminderDailyGoal">
										{(field) => (
											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<Label>{t("onboarding.wellness.dailyGoal", "Daily Goal")}</Label>
													<span className="text-sm font-medium">
														{field.state.value} {t("onboarding.wellness.glasses", "glasses")}
													</span>
												</div>
												<Slider
													value={[field.state.value]}
													onValueChange={(value) => field.handleChange(value[0])}
													min={DAILY_GOAL_RANGE.min}
													max={DAILY_GOAL_RANGE.max}
													step={1}
													disabled={loading}
												/>
												<div className="flex justify-between text-xs text-muted-foreground">
													<span>
														{DAILY_GOAL_RANGE.min} {t("onboarding.wellness.glass", "glass")}
													</span>
													<span>
														{DAILY_GOAL_RANGE.max} {t("onboarding.wellness.glasses", "glasses")}
													</span>
												</div>
											</div>
										)}
									</form.Field>

									{/* Feature Info */}
									<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
										<h4 className="mb-1 text-sm font-medium text-blue-900 dark:text-blue-100">
											{t("onboarding.wellness.features", "What you'll get")}
										</h4>
										<ul className="space-y-1 text-xs text-blue-800 dark:text-blue-200">
											<li>
												{t(
													"onboarding.wellness.feature1",
													"• Gentle reminders while clocked in",
												)}
											</li>
											<li>
												{t(
													"onboarding.wellness.feature2",
													"• Track your daily water intake",
												)}
											</li>
											<li>
												{t(
													"onboarding.wellness.feature3",
													"• Build healthy streaks with gamification",
												)}
											</li>
											<li>
												{t(
													"onboarding.wellness.feature4",
													"• Dashboard widget to track progress",
												)}
											</li>
										</ul>
									</div>
								</div>
							)}

							{/* Action Buttons */}
							<div className="flex gap-3 pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={handleSkip}
									disabled={loading}
									className="flex-1"
								>
									{t("onboarding.wellness.skip", "Skip for now")}
								</Button>
								<Button type="submit" disabled={loading} className="flex-1">
									{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{t("onboarding.wellness.continue", "Continue")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
