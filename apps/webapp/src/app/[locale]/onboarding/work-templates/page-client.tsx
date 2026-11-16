"use client";

import { IconClock, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { useSession } from "@/lib/auth-client";
import type {
	OnboardingOrganizationExpectation,
	OnboardingWorkTemplateFormValues,
} from "@/lib/validations/onboarding";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import { checkIsAdmin, createWorkTemplateOnboarding, skipWorkTemplateSetup } from "./actions";

const DAYS_OF_WEEK = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

// 2024-01-01 is a Monday, so index i in DAYS_OF_WEEK falls on January 1 + i.
function getShortWeekdayLabel(locale: string, dayIndex: number) {
	return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
		Date.UTC(2024, 0, 1 + dayIndex),
	);
}

type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

type Translate = ReturnType<typeof useTranslate>["t"];

type WorkTemplateCommand = {
	arrival: symbol;
	started: boolean;
	expected: OnboardingOrganizationExpectation;
};

function getFieldErrorMessage(error: unknown) {
	if (typeof error === "string") {
		return error;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String(error.message);
	}
	return undefined;
}

function TemplateNameField({
	disabled,
	error,
	onBlur,
	onChange,
	t,
	value,
}: {
	disabled: boolean;
	error?: string;
	onBlur: () => void;
	onChange: (value: string) => void;
	t: Translate;
	value: string;
}) {
	const hasError = Boolean(error);
	return (
		<TFormItem>
			<TFormLabel hasError={hasError}>
				{t("onboarding.workTemplates.name", "Template Name")}
			</TFormLabel>
			<TFormControl hasError={hasError}>
				<Input
					name="name"
					autoComplete="off"
					maxLength={100}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onBlur={onBlur}
					placeholder={t("onboarding.workTemplates.namePlaceholder", "e.g., Full-Time, Part-Time")}
					disabled={disabled}
				/>
			</TFormControl>
			<TFormDescription>
				{t("onboarding.workTemplates.nameDesc", "A name to identify this work schedule.")}
			</TFormDescription>
			<TFormMessage>{error}</TFormMessage>
		</TFormItem>
	);
}

function HoursPerWeekField({
	disabled,
	error,
	onBlur,
	onChange,
	t,
	value,
}: {
	disabled: boolean;
	error?: string;
	onBlur: () => void;
	onChange: (value: string) => void;
	t: Translate;
	value: string;
}) {
	const hasError = Boolean(error);
	return (
		<TFormItem>
			<TFormLabel hasError={hasError}>
				{t("onboarding.workTemplates.hoursPerWeek", "Hours per Week")}
			</TFormLabel>
			<TFormControl hasError={hasError}>
				<Input
					name="hoursPerWeek"
					inputMode="decimal"
					step="any"
					type="number"
					min={0}
					max={168}
					placeholder={t("onboarding.workTemplates.hoursPerWeekPlaceholder", "40")}
					disabled={disabled}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onBlur={onBlur}
				/>
			</TFormControl>
			<TFormDescription>
				{t(
					"onboarding.workTemplates.hoursPerWeekDesc",
					"Total working hours per week. Typical full-time is 40 hours.",
				)}
			</TFormDescription>
			<TFormMessage>{error}</TFormMessage>
		</TFormItem>
	);
}

function WorkingDaysSelector({
	disabled,
	onChange,
	t,
	value,
}: {
	disabled: boolean;
	onChange: (value: DayOfWeek[]) => void;
	t: Translate;
	value: DayOfWeek[];
}) {
	const locale = useLocale();
	return (
		<fieldset className="grid gap-2" aria-describedby="work-template-working-days-description">
			<legend className="mb-3 font-medium text-sm leading-none">
				{t("onboarding.workTemplates.workingDays", "Working Days")}
			</legend>
			<div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
				{DAYS_OF_WEEK.map((day, dayIndex) => {
					const id = `work-template-day-${day}`;
					return (
						<div
							key={day}
							className="relative flex min-h-16 flex-col items-center justify-center gap-2 rounded-lg border bg-background p-2 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5"
						>
							<Checkbox
								id={id}
								aria-describedby="work-template-working-days-description"
								aria-labelledby={`${id}-label`}
								checked={value.includes(day)}
								onCheckedChange={(checked) => {
									onChange(
										checked ? [...value, day] : value.filter((currentDay) => currentDay !== day),
									);
								}}
								disabled={disabled}
								className="size-6 [&_svg]:size-4"
							/>
							<Label
								id={`${id}-label`}
								htmlFor={id}
								className="text-sm font-normal after:absolute after:inset-0 after:content-['']"
							>
								{getShortWeekdayLabel(locale, dayIndex)}
							</Label>
						</div>
					);
				})}
			</div>
			<p id="work-template-working-days-description" className="text-sm text-muted-foreground">
				{t(
					"onboarding.workTemplates.workingDaysDesc",
					"Select which days are working days. Hours will be distributed evenly.",
				)}
			</p>
		</fieldset>
	);
}

function SchedulePreview({
	hoursPerDay,
	t,
	workingDayCount,
}: {
	hoursPerDay: string;
	t: Translate;
	workingDayCount: number;
}) {
	if (workingDayCount === 0) {
		return null;
	}

	return (
		<section
			aria-labelledby="schedule-preview-heading"
			className="rounded-xl border bg-muted/40 p-5"
			aria-live="polite"
			aria-atomic="true"
		>
			<h2 id="schedule-preview-heading" className="flex items-center gap-2 text-base font-semibold">
				<IconClock aria-hidden="true" className="size-5 text-primary" />
				{t("onboarding.workTemplates.preview", "Schedule Preview")}
			</h2>
			<p className="mt-3 text-sm text-muted-foreground tabular-nums">
				{t(
					"onboarding.workTemplates.previewText",
					"{days} working days, {hoursPerDay} hours per day",
					{ days: workingDayCount, hoursPerDay },
				)}
			</p>
			<p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
				{t(
					"onboarding.workTemplates.context",
					"This template configures working hours for your organization. It does not record time or change your personal display week.",
				)}
			</p>
		</section>
	);
}

function DefaultTemplateToggle({
	checked,
	disabled,
	onChange,
	t,
}: {
	checked: boolean;
	disabled: boolean;
	onChange: (checked: boolean) => void;
	t: Translate;
}) {
	return (
		<div className="flex flex-row items-center justify-between gap-4 rounded-lg border bg-background p-4">
			<div className="min-w-0 space-y-0.5">
				<Label htmlFor="work-template-default" className="text-base">
					{t("onboarding.workTemplates.setAsDefault", "Set as organization default")}
				</Label>
				<p id="work-template-default-description" className="text-sm text-muted-foreground">
					{t("onboarding.workTemplates.setAsDefaultDesc", "Apply this schedule to all employees.")}
				</p>
			</div>
			<Switch
				id="work-template-default"
				aria-describedby="work-template-default-description"
				checked={checked}
				onCheckedChange={onChange}
				disabled={disabled}
			/>
		</div>
	);
}

function WorkTemplateHeader({ t }: { t: (key: string, defaultValue: string) => string }) {
	return (
		<PageHeader
			className="onboarding-heading-panel mb-6 rounded-xl border bg-card p-6 sm:p-8"
			title={t("onboarding.workTemplates.title", "Create work schedule template")}
			description={t(
				"onboarding.workTemplates.subtitle",
				"Set up a work schedule template for your organization. This defines working hours for your team.",
			)}
		/>
	);
}

function WorkTemplateActions({
	loading,
	workingDays,
	onSkip,
	t,
}: {
	loading: boolean;
	workingDays: DayOfWeek[];
	onSkip: () => void;
	t: (key: string, defaultValue: string) => string;
}) {
	return (
		<div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end lg:col-span-2">
			<Button
				type="button"
				variant="outline"
				onClick={onSkip}
				disabled={loading}
				className="sm:min-w-36"
			>
				{t("onboarding.workTemplates.skip", "Skip for now")}
			</Button>
			<Button
				type="submit"
				disabled={loading || workingDays.length === 0}
				className="sm:min-w-48"
				aria-label={t("onboarding.workTemplates.saveContinue", "Save and continue")}
			>
				{loading && (
					<IconLoader2
						aria-hidden="true"
						className="size-4 animate-spin motion-reduce:animate-none"
					/>
				)}
				{t("onboarding.workTemplates.saveContinue", "Save and continue")}
			</Button>
		</div>
	);
}

export default function WorkTemplatesPage() {
	const { t } = useTranslate();
	const { data: session, isPending } = useSession();
	if (isPending || !session?.user.id) {
		return (
			<div className="mx-auto max-w-4xl">
				<WorkTemplateHeader t={t} />
				<LoadingRegion
					role="status"
					label={{
						labelKey: "onboarding.workTemplates.sessionLoading",
						labelDefault: "Loading your work template setup…",
					}}
				/>
			</div>
		);
	}
	return (
		<WorkTemplateSetup
			key={`${session.user.id}:${session.session.activeOrganizationId ?? "none"}`}
			expected={{
				userId: session.user.id,
				organizationId: session.session.activeOrganizationId ?? null,
			}}
		/>
	);
}

function useWorkTemplateSetup(expected: OnboardingOrganizationExpectation) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [loading, setLoading] = useState(false);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
	const [error, setError] = useState<string | null>(null);
	const arrival = useRef<symbol | null>(null);
	const running = useRef<WorkTemplateCommand | null>(null);
	const formElement = useRef<HTMLFormElement>(null);
	useLayoutEffect(() => {
		arrival.current = Symbol("work-template arrival");
		running.current = null;
		// react-doctor-disable-next-line react-hooks-js/set-state-in-effect -- Activity reconnect invalidates only transient pending state; the form draft survives.
		setLoading(false);
		// react-doctor-disable-next-line react-hooks-js/set-state-in-effect -- Reconnected Activity must recheck administrator authority before revealing its retained draft.
		setIsAdmin(null);
		return () => {
			arrival.current = null;
		};
	}, []);

	function reserveCommand() {
		const owner = arrival.current;
		if (!owner || running.current || isAdmin !== true) return null;
		const command = { arrival: owner, started: false, expected };
		running.current = command;
		return command;
	}

	function currentCommand(command: WorkTemplateCommand) {
		return arrival.current === command.arrival && running.current === command;
	}

	async function perform(
		kind: "save" | "skip",
		value?: OnboardingWorkTemplateFormValues,
		command = reserveCommand(),
	) {
		if (!command || !currentCommand(command) || isAdmin !== true) return;
		command.started = true;
		setError(null);
		const current = () => currentCommand(command);
		const fallback =
			kind === "save"
				? t("onboarding.workTemplates.error", "Failed to create work schedule template")
				: t("onboarding.workTemplates.skipError", "Failed to skip work schedule template setup");
		const fail = (message: string) => {
			if (current()) {
				setError(message);
				toast.error(message);
			}
		};
		await runOnboardingAction({
			action: () =>
				kind === "save" && value
					? createWorkTemplateOnboarding(value, command.expected)
					: skipWorkTemplateSetup(command.expected),
			onResult: (result) => {
				if (!current()) return true;
				if (!result.success) {
					fail(
						result.refusal === "work_template_default_exists"
							? t(
									"onboarding.workTemplates.defaultExists",
									"An organization default already exists. Create a non-default template or manage work policies in settings.",
								)
							: result.code === "DatabaseError"
								? fallback
								: result.error || fallback,
					);
					return;
				}
				if (kind === "save")
					toast.success(t("onboarding.workTemplates.success", "Work schedule template created!"));
				push("/onboarding/notifications");
				return true;
			},
			onRejected: () => fail(fallback),
			setLoading: (pending) => {
				if (current()) {
					setLoading(pending);
					if (!pending) running.current = null;
				}
			},
		});
	}

	const form = useForm({
		onSubmitMeta: { command: null as WorkTemplateCommand | null },
		defaultValues: {
			name: t("onboarding.workTemplates.defaultName", "Standard"),
			hoursPerWeek: "40",
			workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] as DayOfWeek[],
			setAsDefault: true,
		},
		onSubmit: async ({ value, meta }) => {
			if (value.workingDays.length > 0)
				await perform("save", { ...value, hoursPerWeek: Number(value.hoursPerWeek) }, meta.command);
		},
		onSubmitInvalid: () =>
			formElement.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
	});

	// Check if user is admin, redirect if not
	useEffect(() => {
		let cancelled = false;

		async function checkAdmin() {
			try {
				const result = await checkIsAdmin();
				if (cancelled) {
					return;
				}

				if (result.success) {
					setIsAdmin(result.data);
					if (!result.data) {
						push("/onboarding/notifications");
					}
				} else {
					push("/onboarding/notifications");
				}
			} catch {
				if (!cancelled) {
					push("/onboarding/notifications");
				}
			}
		}
		void checkAdmin();

		return () => {
			cancelled = true;
		};
	}, [push]);

	async function handleSkip() {
		await perform("skip");
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		event.stopPropagation();
		const command = reserveCommand();
		if (!command) return;
		try {
			await form.handleSubmit({ command });
		} catch {
			if (!currentCommand(command)) return;
			running.current = null;
			setLoading(false);
			const message = t(
				"onboarding.workTemplates.error",
				"Failed to create work schedule template",
			);
			setError(message);
			toast.error(message);
		}
		if (currentCommand(command) && !command.started) running.current = null;
	}

	return { t, form, formElement, loading, isAdmin, error, handleSubmit, handleSkip };
}

function WorkTemplateSetup({ expected }: { expected: OnboardingOrganizationExpectation }) {
	const { t, form, formElement, loading, isAdmin, error, handleSubmit, handleSkip } =
		useWorkTemplateSetup(expected);
	const formValues = useStore(form.store, (state) => state.values);
	const workingDays = formValues.workingDays;
	const hoursPerWeek = Number(formValues.hoursPerWeek);

	// Show loading while checking admin status
	if (isAdmin !== true) {
		return (
			<div className="mx-auto max-w-4xl">
				<WorkTemplateHeader t={t} />
				<LoadingRegion
					role="status"
					label={{
						labelKey: "onboarding.workTemplates.checking",
						labelDefault: "Checking organization administrator access…",
					}}
				/>
			</div>
		);
	}

	// Calculate hours per day
	const hoursPerDay = workingDays.length > 0 ? (hoursPerWeek / workingDays.length).toFixed(1) : "0";

	return (
		<>
			<div className="mx-auto mb-6 max-w-4xl rounded-xl border bg-card px-4 pt-6 [&>div]:mb-6">
				<ProgressIndicator currentStep="work_templates" />
			</div>

			<div className="mx-auto max-w-4xl [&_[data-slot=card]]:!border-border [&_[data-slot=card]]:!bg-card [&_[data-slot=card-header]]:!border-border [&_[data-slot=card-header]]:!bg-card">
				<WorkTemplateHeader t={t} />

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
							ref={formElement}
							onSubmit={handleSubmit}
							noValidate
							aria-busy={loading}
							className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] lg:gap-8"
						>
							<div className="min-w-0 space-y-6">
								{/* Template Name */}
								<form.Field
									name="name"
									validators={{
										onChange: z
											.string()
											.min(
												1,
												t(
													"onboarding.workTemplates.validation.nameRequired",
													"Template name is required",
												),
											)
											.max(
												100,
												t(
													"onboarding.workTemplates.validation.nameTooLong",
													"Template name must be 100 characters or fewer",
												),
											),
									}}
								>
									{(field) => (
										<TemplateNameField
											disabled={loading}
											error={getFieldErrorMessage(field.state.meta.errors[0])}
											onBlur={field.handleBlur}
											onChange={field.handleChange}
											t={t}
											value={field.state.value}
										/>
									)}
								</form.Field>

								{/* Hours Per Week */}
								<form.Field
									name="hoursPerWeek"
									validators={{
										onChange: z.coerce
											.number<string>()
											.min(
												0,
												t(
													"onboarding.workTemplates.validation.hoursNegative",
													"Hours cannot be negative",
												),
											)
											.max(
												168,
												t(
													"onboarding.workTemplates.validation.hoursTooMany",
													"A week has at most 168 hours",
												),
											),
									}}
								>
									{(field) => (
										<HoursPerWeekField
											disabled={loading}
											error={getFieldErrorMessage(field.state.meta.errors[0])}
											onBlur={field.handleBlur}
											onChange={field.handleChange}
											t={t}
											value={field.state.value}
										/>
									)}
								</form.Field>

								{/* Working Days */}
								<form.Field name="workingDays">
									{(field) => (
										<WorkingDaysSelector
											disabled={loading}
											onChange={field.handleChange}
											t={t}
											value={field.state.value}
										/>
									)}
								</form.Field>

								{/* Set as Default */}
								<form.Field name="setAsDefault">
									{(field) => (
										<DefaultTemplateToggle
											checked={field.state.value}
											disabled={loading}
											onChange={field.handleChange}
											t={t}
										/>
									)}
								</form.Field>
							</div>
							<div className="min-w-0">
								<SchedulePreview
									hoursPerDay={hoursPerDay}
									t={t}
									workingDayCount={workingDays.length}
								/>
								{workingDays.length === 0 && (
									<p role="status" className="rounded-xl border p-5 text-sm text-muted-foreground">
										{t(
											"onboarding.workTemplates.chooseDay",
											"Select at least one working day to preview and save the template.",
										)}
									</p>
								)}
							</div>
							{error && (
								<p
									role="alert"
									className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive lg:col-span-2"
								>
									{error}
								</p>
							)}
							<WorkTemplateActions
								loading={loading}
								workingDays={workingDays}
								onSkip={handleSkip}
								t={t}
							/>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
