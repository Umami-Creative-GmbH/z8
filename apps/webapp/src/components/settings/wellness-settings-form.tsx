"use client";

import {
	IconDropletFilled,
	IconLoader2,
	IconMinus,
	IconPlus,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateWellnessSettings } from "@/app/[locale]/(app)/settings/wellness/actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { WaterReminderSettings } from "@/lib/validations/wellness";
import {
	CUSTOM_INTERVAL_RANGE,
	DAILY_GOAL_RANGE,
} from "@/lib/wellness/water-presets";
import { runWithBusyState } from "./run-with-busy-state";

const DAILY_GOAL_DROPLET_KEYS = Array.from(
	{ length: DAILY_GOAL_RANGE.max },
	(_, index) => `daily-goal-droplet-${index + 1}`,
);

/** The reminder preset a slider interval matches, as the save action derives it. */
function IntervalPresetLabel({ minutes }: { minutes: number }) {
	const { t } = useTranslate();
	switch (minutes) {
		case 30:
			return t("settings.wellness.presets.active", "Active");
		case 45:
			return t("settings.wellness.presets.moderate", "Moderate");
		case 60:
			return t("settings.wellness.presets.light", "Light");
		default:
			return t("settings.wellness.presets.custom", "Custom");
	}
}

interface WellnessSettingsFormProps {
	initialSettings: WaterReminderSettings;
}

export function WellnessSettingsForm({
	initialSettings,
}: WellnessSettingsFormProps) {
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
			await runWithBusyState(setLoading, async () => {
				try {
					const result = await updateWellnessSettings(value);

					if (result.success) {
						toast.success(
							t("settings.wellness.saved", "Wellness settings saved"),
						);
					} else {
						toast.error(
							actionErrorMessage(t, result, {}, [
								"settings.wellness.saveError",
								"Failed to save wellness settings",
							]),
						);
					}
				} catch {
					toast.error(
						t(
							"settings.wellness.saveError",
							"Failed to save wellness settings",
						),
					);
				}
			});
		},
	});

	// Track form values for conditional rendering
	const [isEnabled, setIsEnabled] = useState(initialSettings.enabled);
	const [isDirty, setIsDirty] = useState(false);

	// Sync form state to component state for conditional rendering
	useEffect(() => {
		const subscription = form.store.subscribe(() => {
			const state = form.store.state;
			setIsEnabled(state.values.enabled);
			setIsDirty(state.isDirty);
		});

		return () => {
			subscription.unsubscribe();
		};
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
					<div className="flex items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
								<IconDropletFilled
									className="size-5 text-primary"
									aria-hidden="true"
								/>
							</div>
							<div className="min-w-0">
								<CardTitle id="wellness-reminders-title">
									{t("settings.wellness.cardTitle", "Water Reminders")}
								</CardTitle>
								<CardDescription
									id="wellness-reminders-description"
									className="mt-0.5"
								>
									{t(
										"settings.wellness.cardDescShort",
										"Stay hydrated while you work",
									)}
								</CardDescription>
							</div>
						</div>
						<form.Field name="enabled">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="wellness-reminders-title"
									aria-describedby="wellness-reminders-description"
								/>
							)}
						</form.Field>
					</div>
				</CardHeader>

				<CardContent className="space-y-6">
					<div
						className={`space-y-6 transition-opacity ${!isEnabled ? "opacity-40" : ""}`}
					>
					{/* Frequency */}
					<form.Field name="intervalMinutes">
						{(field) => {
							const value = field.state.value;
							const isRecommended = value === 45;

							return (
								<div className="space-y-3">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<Label
											id="wellness-reminder-frequency-label"
											className="text-sm font-medium"
										>
											{t(
												"settings.wellness.reminderFrequency",
												"Reminder Frequency",
											)}
										</Label>
										<div className="flex items-center gap-2">
											<span className="text-sm tabular-nums">
												{t("common.durationMinutes", "{count} min", {
													count: value,
												})}
											</span>
											<span
												className={`rounded-full px-2 py-0.5 text-xs font-medium ${
													isRecommended
														? "bg-primary/10 text-primary"
														: "bg-muted text-muted-foreground"
												}`}
											>
												<IntervalPresetLabel minutes={value} />
											</span>
										</div>
									</div>
									<div className="relative pt-1 pb-6">
										<Slider
											aria-labelledby="wellness-reminder-frequency-label"
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
										<div
											aria-hidden="true"
											className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] tabular-nums text-muted-foreground"
										>
											<span>{CUSTOM_INTERVAL_RANGE.min}m</span>
											{[30, 45, 60].map((val) => {
												const percent =
													((val - CUSTOM_INTERVAL_RANGE.min) /
														(CUSTOM_INTERVAL_RANGE.max -
															CUSTOM_INTERVAL_RANGE.min)) *
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
							<div
								role="group"
								aria-labelledby="wellness-daily-goal-label"
								className="space-y-3"
							>
								<div className="flex items-center justify-between gap-2">
									<Label
										id="wellness-daily-goal-label"
										className="text-sm font-medium"
									>
										{t("settings.wellness.dailyGoal", "Daily Goal")}
									</Label>
									<span className="text-sm tabular-nums" aria-live="polite">
										{field.state.value}{" "}
										{t("settings.wellness.glasses", "glasses")}
									</span>
								</div>
								<div className="flex items-center gap-3">
									<Button
										type="button"
										aria-label={t(
											"settings.wellness.decreaseDailyGoal",
											"Decrease daily goal",
										)}
										variant="outline"
										size="icon"
										className="size-9 shrink-0 rounded-full"
										onClick={() =>
											field.handleChange(
												Math.max(DAILY_GOAL_RANGE.min, field.state.value - 1),
											)
										}
										disabled={
											loading ||
											!isEnabled ||
											field.state.value <= DAILY_GOAL_RANGE.min
										}
									>
										<IconMinus className="size-4" aria-hidden="true" />
									</Button>
									<div
										aria-hidden="true"
										className="flex min-w-0 flex-1 flex-wrap justify-center gap-1"
									>
										{DAILY_GOAL_DROPLET_KEYS.slice(0, field.state.value).map(
											(key) => (
												<IconDropletFilled
													key={key}
													className="size-5 text-primary"
												/>
											),
										)}
									</div>
									<Button
										type="button"
										aria-label={t(
											"settings.wellness.increaseDailyGoal",
											"Increase daily goal",
										)}
										variant="outline"
										size="icon"
										className="size-9 shrink-0 rounded-full"
										onClick={() =>
											field.handleChange(
												Math.min(DAILY_GOAL_RANGE.max, field.state.value + 1),
											)
										}
										disabled={
											loading ||
											!isEnabled ||
											field.state.value >= DAILY_GOAL_RANGE.max
										}
									>
										<IconPlus className="size-4" aria-hidden="true" />
									</Button>
								</div>
							</div>
						)}
					</form.Field>
					</div>

					<div className="h-px bg-border" />

					{/* Save stays operable while reminders are off, so turning them off can be saved. */}
					<Button
						type="submit"
						disabled={loading || !isDirty}
						className="w-full"
					>
						{loading && (
							<IconLoader2
								className="mr-2 size-4 animate-spin"
								aria-hidden="true"
							/>
						)}
						{t("common.saveChanges", "Save Changes")}
					</Button>
				</CardContent>
			</Card>
		</form>
	);
}
