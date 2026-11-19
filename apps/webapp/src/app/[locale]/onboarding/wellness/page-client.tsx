"use client";

import { IconDroplet, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
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
import { useSession } from "@/lib/auth-client";
import type { OnboardingWellnessFormValues } from "@/lib/validations/wellness";
import {
	CUSTOM_INTERVAL_RANGE,
	DAILY_GOAL_RANGE,
	WATER_PRESETS,
	type WaterReminderPreset,
} from "@/lib/wellness/water-presets";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import { configureWellnessOnboarding, skipWellnessSetup } from "./actions";

type Translate = ReturnType<typeof useTranslate>["t"];
const defaultSubmitMeta: { arrival: object | null } = { arrival: null };

// The /onboarding route only loads the common and onboarding namespaces, so the
// settings.wellness.presets.* keys on WATER_PRESETS would render in English here.
const WATER_PRESET_COPY: Record<
	WaterReminderPreset,
	{
		labelKey: string;
		labelDefault: string;
		descriptionKey: string;
		descriptionDefault: string;
	}
> = {
	light: {
		labelKey: "onboarding.wellness.presets.light.label",
		labelDefault: "Light",
		descriptionKey: "onboarding.wellness.presets.light.description",
		descriptionDefault: "Every 60 minutes - for low activity",
	},
	moderate: {
		labelKey: "onboarding.wellness.presets.moderate.label",
		labelDefault: "Moderate",
		descriptionKey: "onboarding.wellness.presets.moderate.description",
		descriptionDefault: "Every 45 minutes - recommended for most people",
	},
	active: {
		labelKey: "onboarding.wellness.presets.active.label",
		labelDefault: "Active",
		descriptionKey: "onboarding.wellness.presets.active.description",
		descriptionDefault: "Every 30 minutes - for high activity or hot environments",
	},
	custom: {
		labelKey: "onboarding.wellness.presets.custom.label",
		labelDefault: "Custom",
		descriptionKey: "onboarding.wellness.presets.custom.description",
		descriptionDefault: "Set your own interval (15-120 minutes)",
	},
};

function WellnessHeader({ t }: { t: Translate }) {
	return (
		<header className="space-y-3 border-b px-5 py-6 sm:px-8">
			<div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
				<IconDroplet aria-hidden="true" className="size-5" />
			</div>
			<h1 className="text-balance text-2xl font-semibold tracking-tight">
				{t("onboarding.wellness.title", "Stay Hydrated")}
			</h1>
			<p className="text-muted-foreground">
				{t(
					"onboarding.wellness.subtitle",
					"Set up water reminders to stay healthy during your workday. You'll receive gentle notifications to drink water while clocked in.",
				)}
			</p>
		</header>
	);
}

function useWellnessForm({
	push,
	t,
	draft,
	arrival,
	defaultValues,
	setError,
}: {
	push: ReturnType<typeof useRouter>["push"];
	t: Translate;
	draft: PersonalDraft;
	arrival: RefObject<object | null>;
	defaultValues: OnboardingWellnessFormValues;
	setError: (error: string | null) => void;
}) {
	return useForm({
		defaultValues,
		onSubmitMeta: defaultSubmitMeta,
		onSubmit: async ({ value, meta }) => {
			if (!meta.arrival || arrival.current !== meta.arrival || !draft.tryStart()) return;
			setError(null);
			const submittedArrival = meta.arrival;
			await runOnboardingAction({
				action: () => configureWellnessOnboarding(value),
				onResult: (result) => {
					if (arrival.current !== submittedArrival) return;
					if (result.success) {
						if (value.enableWaterReminder) {
							toast.success(t("onboarding.wellness.success", "Water reminder enabled!"));
						}
						draft.continueNavigation();
						push("/onboarding/notifications");
						return true;
					}
					const message =
						result.error || t("onboarding.wellness.error", "Failed to save wellness settings");
					setError(message);
					toast.error(message);
				},
				onRejected: () => {
					if (arrival.current !== submittedArrival) return;
					setError(t("onboarding.wellness.error", "Failed to save wellness settings"));
					toast.error(t("onboarding.wellness.error", "Failed to save wellness settings"));
				},
				setLoading: draft.setPending,
			});
		},
	});
}

type WellnessFormApi = ReturnType<typeof useWellnessForm>;

function WellnessSettings({
	form,
	isCustom,
	loading,
	onPresetChange,
	selectedPreset,
	t,
}: {
	form: WellnessFormApi;
	isCustom: boolean;
	loading: boolean;
	onPresetChange: (preset: WaterReminderPreset) => void;
	selectedPreset: WaterReminderPreset;
	t: Translate;
}) {
	return (
		<div className="space-y-6 border-t pt-6">
			<div className="space-y-2">
				<Label htmlFor="wellness-reminder-frequency">
					{t("onboarding.wellness.reminderFrequency", "Reminder Frequency")}
				</Label>
				<Select value={selectedPreset} onValueChange={onPresetChange} disabled={loading}>
					<SelectTrigger
						id="wellness-reminder-frequency"
						aria-describedby="wellness-reminder-frequency-description"
						className="w-full"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.values(WATER_PRESETS).map((preset) => (
							<SelectItem key={preset.id} value={preset.id}>
								<span className="flex items-center gap-2">
									{t(
										WATER_PRESET_COPY[preset.id].labelKey,
										WATER_PRESET_COPY[preset.id].labelDefault,
									)}
									{preset.recommended && (
										<span className="text-xs text-primary">
											{t("onboarding.wellness.recommended", "(Recommended)")}
										</span>
									)}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p id="wellness-reminder-frequency-description" className="text-sm text-muted-foreground">
					{t(
						WATER_PRESET_COPY[selectedPreset].descriptionKey,
						WATER_PRESET_COPY[selectedPreset].descriptionDefault,
					)}
				</p>
			</div>

			{isCustom && (
				<form.Field name="waterReminderIntervalMinutes">
					{(field) => (
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<Label id="wellness-custom-interval-label">
									{t("onboarding.wellness.customInterval", "Custom Interval")}
								</Label>
								<span className="shrink-0 text-sm font-semibold tabular-nums">
									{t("common.durationMinutes", "{count} min", {
										count: field.state.value,
									})}
								</span>
							</div>
							<Slider
								aria-labelledby="wellness-custom-interval-label"
								format={{ style: "unit", unit: "minute", unitDisplay: "long" }}
								value={[field.state.value]}
								onValueChange={(value) => field.handleChange(value[0])}
								min={CUSTOM_INTERVAL_RANGE.min}
								max={CUSTOM_INTERVAL_RANGE.max}
								step={5}
								disabled={loading}
							/>
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>
									{t("common.durationMinutes", "{count} min", {
										count: CUSTOM_INTERVAL_RANGE.min,
									})}
								</span>
								<span>
									{t("common.durationMinutes", "{count} min", {
										count: CUSTOM_INTERVAL_RANGE.max,
									})}
								</span>
							</div>
						</div>
					)}
				</form.Field>
			)}

			<form.Field name="waterReminderDailyGoal">
				{(field) => (
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label id="wellness-daily-goal-label">
								{t("onboarding.wellness.dailyGoal", "Daily Goal")}
							</Label>
							<span className="shrink-0 text-sm font-semibold tabular-nums">
								{field.state.value} {t("onboarding.wellness.glasses", "glasses")}
							</span>
						</div>
						<Slider
							aria-labelledby="wellness-daily-goal-label"
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

			<form.Subscribe selector={(state) => state.values.waterReminderIntervalMinutes}>
				{(minutes) => (
					<p
						id="wellness-cadence"
						className="rounded-lg bg-primary/5 px-4 py-3 text-sm text-foreground"
					>
						{t(
							"onboarding.wellness.cadence",
							"A reminder every {minutes} minutes while clocked in.",
							{ minutes },
						)}
					</p>
				)}
			</form.Subscribe>
			<div className="border-t pt-4">
				<h3 className="mb-2 text-sm font-medium">
					{t("onboarding.wellness.features", "What you'll get")}
				</h3>
				<ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
					<li>{t("onboarding.wellness.feature1", "Gentle reminders while clocked in")}</li>
					<li>{t("onboarding.wellness.feature2", "Track your daily water intake")}</li>
					<li>{t("onboarding.wellness.feature3", "Build healthy streaks with gamification")}</li>
					<li>{t("onboarding.wellness.feature4", "Dashboard widget to track progress")}</li>
				</ul>
			</div>
		</div>
	);
}

const DEFAULT_VALUES: OnboardingWellnessFormValues = {
	enableWaterReminder: true,
	waterReminderPreset: "moderate",
	waterReminderIntervalMinutes: 45,
	waterReminderDailyGoal: 8,
};

// A page-lifetime external store: personal writes may outlive the mounted
// account/organization arrival. It never persists or authorizes workspace access.
function createPersonalDraft() {
	let values = { ...DEFAULT_VALUES };
	let pending = false;
	let continuing = false;
	const listeners = new Set<() => void>();
	const setPending = (next: boolean) => {
		pending = next;
		for (const notify of listeners) notify();
	};
	return {
		getValues: () => values,
		remember: (next: OnboardingWellnessFormValues) => {
			values = { ...next };
		},
		isPending: () => pending,
		setPending,
		continueNavigation: () => {
			continuing = true;
		},
		leave: () => {
			if (continuing) {
				continuing = false;
				setPending(false);
			}
		},
		tryStart: () => {
			if (pending) return false;
			setPending(true);
			return true;
		},
		subscribe: (notify: () => void) => {
			listeners.add(notify);
			return () => {
				listeners.delete(notify);
			};
		},
	};
}
type PersonalDraft = ReturnType<typeof createPersonalDraft>;
const idleSnapshot = () => false;

export default function WellnessPage() {
	const { data: session, isPending } = useSession();
	// Drafts belong to an account, while continuation belongs to one arrival.
	// Keep these owners separate across organization and account round trips.
	const [drafts] = useState(() => new Map<string, PersonalDraft>());
	const { t } = useTranslate();
	if (!session?.user.id || isPending) {
		return (
			<>
				<ProgressIndicator currentStep="wellness" />
				<section className="mx-auto max-w-2xl overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
					<WellnessHeader t={t} />
					<p role="status" aria-busy="true" className="p-5 text-sm text-muted-foreground sm:p-8">
						{t("common.loading", "Loading...")}
					</p>
				</section>
			</>
		);
	}
	return (
		<WellnessStep
			key={JSON.stringify([session.user.id, session.session.activeOrganizationId])}
			userId={session.user.id}
			organizationId={session.session.activeOrganizationId ?? null}
			drafts={drafts}
		/>
	);
}

function WellnessStep({
	userId,
	organizationId,
	drafts,
}: {
	userId: string;
	organizationId: string | null;
	drafts: Map<string, PersonalDraft>;
}) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [draft] = useState(() => {
		const retained = drafts.get(userId);
		if (retained) return retained;
		const created = createPersonalDraft();
		drafts.set(userId, created);
		return created;
	});
	const loading = useSyncExternalStore(draft.subscribe, draft.isPending, idleSnapshot);
	const [error, setError] = useState<string | null>(null);
	const arrival = useRef<object | null>(null);
	useLayoutEffect(() => {
		arrival.current = { organizationId };
		return () => {
			arrival.current = null;
			draft.leave();
		};
	}, [draft, organizationId]);

	const form = useWellnessForm({
		push,
		t,
		draft,
		arrival,
		setError,
		defaultValues: draft.getValues(),
	});
	useEffect(() => {
		const remember = () => {
			draft.remember(form.store.state.values);
		};
		const subscription = form.store.subscribe(remember);
		return () => {
			remember();
			subscription.unsubscribe();
		};
	}, [draft, form.store]);

	async function handleSkip() {
		if (!arrival.current || !draft.tryStart()) return;
		setError(null);
		const submittedArrival = arrival.current;
		await runOnboardingAction({
			action: skipWellnessSetup,
			onResult: (result) => {
				if (arrival.current !== submittedArrival) return;
				if (result.success) {
					draft.continueNavigation();
					push("/onboarding/notifications");
					return true;
				} else {
					setError(
						result.error || t("onboarding.wellness.skipError", "Failed to skip wellness setup"),
					);
					toast.error(
						result.error || t("onboarding.wellness.skipError", "Failed to skip wellness setup"),
					);
				}
			},
			onRejected: () => {
				if (arrival.current !== submittedArrival) return;
				setError(t("onboarding.wellness.skipError", "Failed to skip wellness setup"));
				toast.error(t("onboarding.wellness.skipError", "Failed to skip wellness setup"));
			},
			setLoading: draft.setPending,
		});
	}

	const isEnabled = useStore(form.store, (state) => state.values.enableWaterReminder);
	const selectedPreset = useStore(form.store, (state) => state.values.waterReminderPreset);
	const isCustom = selectedPreset === "custom";

	function handlePresetChange(preset: WaterReminderPreset) {
		form.setFieldValue("waterReminderPreset", preset);
		if (preset !== "custom") {
			form.setFieldValue("waterReminderIntervalMinutes", WATER_PRESETS[preset].intervalMinutes);
		}
	}

	return (
		<>
			<ProgressIndicator currentStep="wellness" />

			<section className="mx-auto max-w-2xl overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
				<WellnessHeader t={t} />

				<div className="px-5 pt-6 sm:px-8">
					<h2 className="font-semibold">{t("onboarding.wellness.cardTitle", "Water Reminders")}</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{t(
							"onboarding.wellness.cardDesc",
							"Enable optional hydration reminders while you work. You can always adjust these settings later.",
						)}
					</p>
				</div>
				<div className="p-5 sm:px-8 sm:pb-8">
					<form
						action={() => {
							if (!draft.isPending()) void form.handleSubmit({ arrival: arrival.current });
						}}
						aria-busy={loading}
						className="space-y-6"
					>
						{/* Enable Toggle */}
						<form.Field name="enableWaterReminder">
							{(field) => (
								<div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
									<div className="min-w-0 space-y-0.5">
										<Label htmlFor="wellness-enable-reminder" className="text-base">
											{t("onboarding.wellness.enableReminder", "Enable Water Reminders")}
										</Label>
										<p
											id="wellness-enable-reminder-description"
											className="text-sm text-muted-foreground"
										>
											{t(
												"onboarding.wellness.enableReminderDesc",
												"Receive gentle reminders to drink water during work hours.",
											)}
										</p>
									</div>
									<Switch
										id="wellness-enable-reminder"
										aria-describedby="wellness-enable-reminder-description"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={loading}
									/>
								</div>
							)}
						</form.Field>

						{isEnabled && (
							<WellnessSettings
								form={form}
								isCustom={isCustom}
								loading={loading}
								onPresetChange={handlePresetChange}
								selectedPreset={selectedPreset}
								t={t}
							/>
						)}

						{error && (
							<p
								role="alert"
								className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
							>
								{error}
							</p>
						)}
						<div role="status" className="sr-only">
							{loading ? t("common.saving", "Saving...") : null}
						</div>
						<div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row">
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
				</div>
			</section>
		</>
	);
}
