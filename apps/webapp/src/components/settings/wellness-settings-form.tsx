"use client";

import { IconDroplet, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import {
	CUSTOM_INTERVAL_RANGE,
	DAILY_GOAL_RANGE,
	WATER_PRESETS,
	type WaterReminderPreset,
} from "@/lib/wellness/water-presets";
import type { WaterReminderSettings } from "@/lib/validations/wellness";
import { updateWellnessSettings } from "@/app/[locale]/(app)/settings/wellness/actions";

interface WellnessSettingsFormProps {
	initialSettings: WaterReminderSettings;
}

export function WellnessSettingsForm({ initialSettings }: WellnessSettingsFormProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues: {
			enabled: initialSettings.enabled,
			preset: initialSettings.preset,
			intervalMinutes: initialSettings.intervalMinutes,
			dailyGoal: initialSettings.dailyGoal,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await updateWellnessSettings(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("settings.wellness.saved", "Wellness settings saved"));
			} else {
				toast.error(
					result.error || t("settings.wellness.saveError", "Failed to save wellness settings"),
				);
			}
		},
	});

	// Track form values for conditional rendering
	const [isEnabled, setIsEnabled] = useState(initialSettings.enabled);
	const [selectedPreset, setSelectedPreset] = useState<WaterReminderPreset>(initialSettings.preset);
	const [isDirty, setIsDirty] = useState(false);
	const isCustom = selectedPreset === "custom";

	// Sync form state to component state for conditional rendering
	useEffect(() => {
		return form.store.subscribe(() => {
			const state = form.store.state;
			setIsEnabled(state.values.enabled);
			setSelectedPreset(state.values.preset);
			setIsDirty(state.isDirty);
		});
	}, [form.store]);

	function handlePresetChange(preset: WaterReminderPreset) {
		form.setFieldValue("preset", preset);
		if (preset !== "custom") {
			form.setFieldValue("intervalMinutes", WATER_PRESETS[preset].intervalMinutes);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconDroplet className="size-5" />
					{t("settings.wellness.cardTitle", "Water Reminders")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.wellness.cardDesc",
						"Configure hydration reminders during your work sessions. Reminders appear while you're clocked in.",
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
					<form.Field name="enabled">
						{(field) => (
							<div className="flex flex-row items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label className="text-base">
										{t("settings.wellness.enableReminder", "Enable Water Reminders")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.wellness.enableReminderDesc",
											"Receive gentle reminders to drink water while clocked in.",
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
								<Label>{t("settings.wellness.reminderFrequency", "Reminder Frequency")}</Label>
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
								<form.Field name="intervalMinutes">
									{(field) => (
										<div className="space-y-2">
											<div className="flex items-center justify-between">
												<Label>{t("settings.wellness.customInterval", "Custom Interval")}</Label>
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
							<form.Field name="dailyGoal">
								{(field) => (
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<Label>{t("settings.wellness.dailyGoal", "Daily Goal")}</Label>
											<span className="text-sm font-medium">
												{field.state.value} {t("settings.wellness.glasses", "glasses")}
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
												{DAILY_GOAL_RANGE.min} {t("settings.wellness.glass", "glass")}
											</span>
											<span>
												{DAILY_GOAL_RANGE.max} {t("settings.wellness.glasses", "glasses")}
											</span>
										</div>
									</div>
								)}
							</form.Field>

							{/* Feature Info */}
							<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
								<h4 className="mb-1 text-sm font-medium text-blue-900 dark:text-blue-100">
									{t("settings.wellness.features", "What you'll get")}
								</h4>
								<ul className="space-y-1 text-xs text-blue-800 dark:text-blue-200">
									<li>
										{t("settings.wellness.feature1", "• Gentle reminders while clocked in")}
									</li>
									<li>{t("settings.wellness.feature2", "• Track your daily water intake")}</li>
									<li>
										{t(
											"settings.wellness.feature3",
											"• Build healthy streaks with gamification",
										)}
									</li>
									<li>
										{t("settings.wellness.feature4", "• Dashboard widget to track progress")}
									</li>
								</ul>
							</div>
						</div>
					)}

					{/* Save Button */}
					<Button type="submit" disabled={loading || !isDirty}>
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("common.saveChanges", "Save Changes")}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
