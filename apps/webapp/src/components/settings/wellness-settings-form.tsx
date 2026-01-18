"use client";

import { IconDropletFilled, IconLoader2, IconMinus, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateWellnessSettings } from "@/app/[locale]/(app)/settings/wellness/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { WaterReminderSettings } from "@/lib/validations/wellness";
import { CUSTOM_INTERVAL_RANGE, DAILY_GOAL_RANGE } from "@/lib/wellness/water-presets";

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
	const [isDirty, setIsDirty] = useState(false);

	// Sync form state to component state for conditional rendering
	useEffect(() => {
		return form.store.subscribe(() => {
			const state = form.store.state;
			setIsEnabled(state.values.enabled);
			setIsDirty(state.isDirty);
		});
	}, [form.store]);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<Card>
				<CardHeader className="pb-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
								<IconDropletFilled className="size-5 text-blue-500" />
							</div>
							<div>
								<CardTitle>{t("settings.wellness.cardTitle", "Water Reminders")}</CardTitle>
								<CardDescription className="mt-0.5">
									{t("settings.wellness.cardDescShort", "Stay hydrated while you work")}
								</CardDescription>
							</div>
						</div>
						<form.Field name="enabled">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
								/>
							)}
						</form.Field>
					</div>
				</CardHeader>

				<CardContent
					className={`space-y-6 transition-opacity ${!isEnabled ? "opacity-40 pointer-events-none" : ""}`}
				>
					{/* Frequency */}
					<form.Field name="intervalMinutes">
						{(field) => {
							const value = field.state.value;
							const presetLabel =
								value === 30
									? "Active"
									: value === 45
										? "Moderate"
										: value === 60
											? "Light"
											: "Custom";
							const isRecommended = value === 45;

							return (
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<Label className="text-sm font-medium">
											{t("settings.wellness.reminderFrequency", "Reminder Frequency")}
										</Label>
										<div className="flex items-center gap-2">
											<span className="text-sm tabular-nums">{value} min</span>
											<span
												className={`rounded-full px-2 py-0.5 text-xs font-medium ${
													isRecommended
														? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
														: "bg-muted text-muted-foreground"
												}`}
											>
												{presetLabel}
											</span>
										</div>
									</div>
									<div className="relative pt-1 pb-6">
										<Slider
											value={[value]}
											onValueChange={(v) => {
												field.handleChange(v[0]);
												const newPreset =
													v[0] === 30
														? "active"
														: v[0] === 45
															? "moderate"
															: v[0] === 60
																? "light"
																: "custom";
												form.setFieldValue("preset", newPreset);
											}}
											min={CUSTOM_INTERVAL_RANGE.min}
											max={CUSTOM_INTERVAL_RANGE.max}
											step={5}
											disabled={loading || !isEnabled}
										/>
										{/* Markers */}
										<div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] text-muted-foreground">
											<span>{CUSTOM_INTERVAL_RANGE.min}m</span>
											{[30, 45, 60].map((val) => {
												const percent =
													((val - CUSTOM_INTERVAL_RANGE.min) /
														(CUSTOM_INTERVAL_RANGE.max - CUSTOM_INTERVAL_RANGE.min)) *
													100;
												return (
													<span
														key={val}
														className="absolute -translate-x-1/2"
														style={{ left: `${percent}%` }}
													>
														{val}m
													</span>
												);
											})}
											<span>{CUSTOM_INTERVAL_RANGE.max}m</span>
										</div>
									</div>
								</div>
							);
						}}
					</form.Field>

					<div className="h-px bg-border" />

					{/* Daily Goal */}
					<form.Field name="dailyGoal">
						{(field) => (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<Label className="text-sm font-medium">
										{t("settings.wellness.dailyGoal", "Daily Goal")}
									</Label>
									<span className="text-sm tabular-nums">
										{field.state.value} {t("settings.wellness.glasses", "glasses")}
									</span>
								</div>
								<div className="flex items-center gap-3">
									<Button
										type="button"
										variant="outline"
										size="icon"
										className="size-9 shrink-0 rounded-full"
										onClick={() =>
											field.handleChange(Math.max(DAILY_GOAL_RANGE.min, field.state.value - 1))
										}
										disabled={loading || !isEnabled || field.state.value <= DAILY_GOAL_RANGE.min}
									>
										<IconMinus className="size-4" />
									</Button>
									<div className="flex flex-wrap gap-1 flex-1 justify-center">
										{Array.from({ length: field.state.value }, (_, i) => (
											<IconDropletFilled key={i} className="size-5 text-blue-500" />
										))}
									</div>
									<Button
										type="button"
										variant="outline"
										size="icon"
										className="size-9 shrink-0 rounded-full"
										onClick={() =>
											field.handleChange(Math.min(DAILY_GOAL_RANGE.max, field.state.value + 1))
										}
										disabled={loading || !isEnabled || field.state.value >= DAILY_GOAL_RANGE.max}
									>
										<IconPlus className="size-4" />
									</Button>
								</div>
							</div>
						)}
					</form.Field>

					<div className="h-px bg-border" />

					{/* Save Button */}
					<Button type="submit" disabled={loading || !isDirty} className="w-full">
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("common.saveChanges", "Save Changes")}
					</Button>
				</CardContent>
			</Card>
		</form>
	);
}
