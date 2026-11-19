"use client";

import { IconBeach, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingRegion } from "@/components/ui/loading-region";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import type { OnboardingVacationPolicyFormValues } from "@/lib/validations/onboarding";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import { checkIsAdmin, createVacationPolicyOnboarding, skipVacationPolicySetup } from "./actions";
import { usePolicyArrival } from "./use-policy-arrival";

function VacationPolicyHeader({ t }: { t: (key: string, defaultValue: string) => string }) {
	return (
		<div className="onboarding-heading-panel mb-6 rounded-xl border border-white/30 bg-white/20 p-6 text-center shadow-xl shadow-black/5 backdrop-blur-[40px] sm:p-8 dark:border-white/10 dark:bg-slate-950/20 dark:shadow-black/30 [&_.text-muted-foreground]:text-foreground/75">
			<div className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-primary/10">
				<IconBeach aria-hidden="true" className="size-5 text-primary" />
			</div>
			<h1 className="mb-2 text-2xl font-semibold tracking-tight">
				{t("onboarding.vacationPolicy.title", "Set up vacation policy")}
			</h1>
			<p className="text-muted-foreground">
				{t(
					"onboarding.vacationPolicy.defaultsContext",
					"Set organization defaults for vacation. Individual allowances and balances are managed separately.",
				)}
			</p>
		</div>
	);
}

function VacationPolicyActions({
	loading,
	onSkip,
	t,
}: {
	loading: boolean;
	onSkip: () => void;
	t: (key: string, defaultValue: string) => string;
}) {
	return (
		<div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row">
			<Button
				type="button"
				variant="outline"
				onClick={onSkip}
				disabled={loading}
				className="flex-1"
			>
				{t("onboarding.vacationPolicy.skip", "Skip for now")}
			</Button>
			<Button type="submit" disabled={loading} className="flex-1">
				{loading && (
					<IconLoader2
						aria-hidden="true"
						className="mr-2 size-4 animate-spin motion-reduce:animate-none"
					/>
				)}
				{t("onboarding.vacationPolicy.saveContinue", "Save and continue")}
			</Button>
		</div>
	);
}

type Translate = ReturnType<typeof useTranslate>["t"];

function useVacationPolicyForm({
	onSubmit,
	t,
}: {
	onSubmit: (value: OnboardingVacationPolicyFormValues) => Promise<void>;
	t: Translate;
}) {
	return useForm({
		defaultValues: {
			name: t("onboarding.vacationPolicy.defaultName", "Standard"),
			defaultAnnualDays: 25,
			accrualType: "annual" as "annual" | "monthly" | "biweekly",
			allowCarryover: true,
			maxCarryoverDays: 5,
		},
		onSubmit: async ({ value }) => onSubmit(value),
	});
}

type VacationPolicyFormApi = ReturnType<typeof useVacationPolicyForm>;

function VacationPolicyForm({
	allowCarryover,
	form,
	loading,
	onSave,
	onSkip,
	t,
}: {
	allowCarryover: boolean;
	form: VacationPolicyFormApi;
	loading: boolean;
	onSave: (element: HTMLFormElement) => void;
	onSkip: () => void;
	t: Translate;
}) {
	const dayCountSchema = z
		.number()
		.min(0, t("onboarding.vacationPolicy.validation.daysNegative", "Days cannot be negative"))
		.max(365, t("onboarding.vacationPolicy.validation.daysTooMany", "Days cannot exceed 365"));

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("onboarding.vacationPolicy.cardTitle", "Vacation Policy")}</CardTitle>
				<CardDescription>
					{t(
						"onboarding.vacationPolicy.cardDesc",
						"Configure vacation allowance for your team. You can customize this later in settings.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						onSave(event.currentTarget);
					}}
					aria-busy={loading}
					className="space-y-6"
				>
					<fieldset className="grid gap-6 sm:grid-cols-2" disabled={loading}>
						<legend className="mb-4 text-base font-semibold">
							{t("onboarding.vacationPolicy.allowanceSection", "Policy and annual allowance")}
						</legend>
						<form.Field
							name="name"
							validators={{
								onChange: z
									.string()
									.min(
										1,
										t(
											"onboarding.vacationPolicy.validation.nameRequired",
											"Policy name is required",
										),
									)
									.max(
										100,
										t(
											"onboarding.vacationPolicy.validation.nameTooLong",
											"Policy name must be 100 characters or fewer",
										),
									),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel htmlFor="vacation-policy-name">
										{t("onboarding.vacationPolicy.name", "Policy Name")}
									</TFormLabel>
									<Input
										id="vacation-policy-name"
										name={field.name}
										autoComplete="off"
										aria-invalid={field.state.meta.errors.length > 0}
										aria-describedby="vacation-policy-name-description vacation-policy-name-error"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"onboarding.vacationPolicy.namePlaceholder",
											"e.g., Standard, Senior",
										)}
										disabled={loading}
									/>
									<TFormDescription id="vacation-policy-name-description">
										{t("onboarding.vacationPolicy.nameDesc", "A name to identify this policy.")}
									</TFormDescription>
									<TFormMessage id="vacation-policy-name-error" field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="defaultAnnualDays" validators={{ onChange: dayCountSchema }}>
							{(field) => (
								<TFormItem>
									<TFormLabel htmlFor="vacation-policy-annual-days">
										{t("onboarding.vacationPolicy.annualDays", "Annual Vacation Days")}
									</TFormLabel>
									<Input
										id="vacation-policy-annual-days"
										name={field.name}
										className="tabular-nums"
										aria-invalid={field.state.meta.errors.length > 0}
										aria-describedby="vacation-policy-annual-days-description vacation-policy-annual-days-error"
										type="number"
										min={0}
										max={365}
										placeholder={t("onboarding.vacationPolicy.annualDaysPlaceholder", "25")}
										disabled={loading}
										value={field.state.value}
										onChange={(event) =>
											field.handleChange(Number.parseInt(event.target.value, 10) || 0)
										}
										onBlur={field.handleBlur}
									/>
									<TFormDescription id="vacation-policy-annual-days-description">
										{t(
											"onboarding.vacationPolicy.referenceDaysDesc",
											"Reference days for a five-day week. Employee allowances follow their schedule and policy.",
										)}
									</TFormDescription>
									<TFormMessage id="vacation-policy-annual-days-error" field={field} />
								</TFormItem>
							)}
						</form.Field>
					</fieldset>
					<fieldset className="space-y-4" disabled={loading}>
						<legend className="mb-4 w-full border-t pt-6 text-base font-semibold">
							{t("onboarding.vacationPolicy.accrualSection", "When days are granted")}
						</legend>
						<form.Field name="accrualType">
							{(field) => (
								<TFormItem>
									<TFormLabel htmlFor="vacation-policy-accrual-type">
										{t("onboarding.vacationPolicy.accrualType", "Accrual Type")}
									</TFormLabel>
									<Select
										onValueChange={(value) =>
											field.handleChange(value as "annual" | "monthly" | "biweekly")
										}
										value={field.state.value}
										disabled={loading}
									>
										<SelectTrigger
											aria-describedby="vacation-policy-accrual-description"
											id="vacation-policy-accrual-type"
											className="w-full"
										>
											<SelectValue
												placeholder={t(
													"onboarding.vacationPolicy.selectAccrualType",
													"Select accrual type",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="annual">
												{t("onboarding.vacationPolicy.annual", "Annual (all at once)")}
											</SelectItem>
											<SelectItem value="monthly">
												{t("onboarding.vacationPolicy.monthly", "Monthly accrual")}
											</SelectItem>
											<SelectItem value="biweekly">
												{t("onboarding.vacationPolicy.biweekly", "Biweekly accrual")}
											</SelectItem>
										</SelectContent>
									</Select>
									<TFormDescription id="vacation-policy-accrual-description">
										{t(
											"onboarding.vacationPolicy.accrualTypeDesc",
											"How vacation days are granted throughout the year.",
										)}
									</TFormDescription>
								</TFormItem>
							)}
						</form.Field>
					</fieldset>
					<fieldset className="space-y-4" disabled={loading}>
						<legend className="mb-4 w-full border-t pt-6 text-base font-semibold">
							{t("onboarding.vacationPolicy.carryoverSection", "Unused days at year end")}
						</legend>
						<form.Field name="allowCarryover">
							{(field) => (
								<TFormItem className="flex flex-row items-center justify-between gap-4">
									<div className="min-w-0 space-y-0.5">
										<TFormLabel htmlFor="vacation-policy-allow-carryover" className="text-base">
											{t("onboarding.vacationPolicy.allowCarryover", "Allow Carryover")}
										</TFormLabel>
										<TFormDescription
											id="vacation-policy-allow-carryover-description"
											className="text-sm text-muted-foreground"
										>
											{t(
												"onboarding.vacationPolicy.allowCarryoverDesc",
												"Allow unused days to be carried to next year.",
											)}
										</TFormDescription>
									</div>
									<Switch
										id="vacation-policy-allow-carryover"
										aria-describedby="vacation-policy-allow-carryover-description"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={loading}
									/>
								</TFormItem>
							)}
						</form.Field>

						{allowCarryover && (
							<form.Field name="maxCarryoverDays" validators={{ onChange: dayCountSchema }}>
								{(field) => (
									<TFormItem>
										<TFormLabel htmlFor="vacation-policy-max-carryover">
											{t("onboarding.vacationPolicy.maxCarryover", "Max Carryover Days")}
										</TFormLabel>
										<Input
											id="vacation-policy-max-carryover"
											name={field.name}
											className="tabular-nums"
											aria-invalid={field.state.meta.errors.length > 0}
											aria-describedby="vacation-policy-max-carryover-description vacation-policy-max-carryover-error"
											type="number"
											min={0}
											max={365}
											placeholder={t("onboarding.vacationPolicy.maxCarryoverPlaceholder", "5")}
											disabled={loading}
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(Number.parseInt(event.target.value, 10) || 0)
											}
											onBlur={field.handleBlur}
										/>
										<TFormDescription id="vacation-policy-max-carryover-description">
											{t(
												"onboarding.vacationPolicy.maxCarryoverDesc",
												"Maximum days that can be carried over.",
											)}
										</TFormDescription>
										<TFormMessage id="vacation-policy-max-carryover-error" field={field} />
									</TFormItem>
								)}
							</form.Field>
						)}
					</fieldset>
					{loading ? (
						<p role="status" className="text-sm text-muted-foreground">
							{t("onboarding.vacationPolicy.pending", "Updating vacation policy setup…")}
						</p>
					) : null}
					<VacationPolicyActions loading={loading} onSkip={onSkip} t={t} />
				</form>
			</CardContent>
		</Card>
	);
}

export default function VacationPolicyPage() {
	const arrival = usePolicyArrival();
	if (!arrival.ready) return <PolicyAccessLoading />;
	return <VacationPolicyArrival key={arrival.key} epoch={arrival.epoch} />;
}

function PolicyAccessLoading() {
	return (
		<LoadingRegion
			className="flex min-h-[50vh] items-center justify-center"
			label={{ labelKey: "common.loading", labelDefault: "Loading…" }}
		>
			<IconLoader2 aria-hidden="true" className="size-6 animate-spin motion-reduce:animate-none" />
		</LoadingRegion>
	);
}

function VacationPolicyArrival({ epoch }: { epoch: RefObject<number> }) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [loading, setLoading] = useState(false);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
	const active = useRef(false);
	const busy = useRef(false);
	const saveStarted = useRef(false);
	const saveIntent = useRef<{ request: number; arrival: number } | null>(null);
	const sequence = useRef(0);

	useEffect(() => {
		active.current = true;
		busy.current = false;
		// Cached Activity re-entry revokes earlier admission before the next read.
		// react-doctor-disable-next-line react-hooks-js/set-state-in-effect
		setIsAdmin(null);
		const request = ++sequence.current;
		const arrival = epoch.current;
		const current = () =>
			active.current && sequence.current === request && epoch.current === arrival;
		void checkIsAdmin()
			.then((result) => {
				if (!current()) return;
				if (result.success && result.data) {
					setLoading(false);
					setIsAdmin(true);
				} else push("/onboarding/notifications");
			})
			.catch(() => {
				if (current()) push("/onboarding/notifications");
			});
		return () => {
			active.current = false;
			saveIntent.current = null;
			sequence.current += 1;
		};
	}, [epoch, push]);

	async function runPolicyAction(value?: OnboardingVacationPolicyFormValues) {
		if (!active.current || isAdmin !== true || (!value && busy.current)) return;
		if (
			value &&
			(saveIntent.current?.request !== sequence.current ||
				saveIntent.current?.arrival !== epoch.current)
		)
			return;
		busy.current = true;
		if (value) saveStarted.current = true;
		const request = sequence.current;
		const arrival = epoch.current;
		const current = () =>
			active.current && sequence.current === request && epoch.current === arrival;
		const failed = (error?: string) => {
			if (!current()) return;
			toast.error(
				error ||
					(value
						? t("onboarding.vacationPolicy.error", "Failed to create vacation policy")
						: t("onboarding.vacationPolicy.skipError", "Failed to skip vacation policy setup")),
			);
		};
		await runOnboardingAction({
			action: () => (value ? createVacationPolicyOnboarding(value) : skipVacationPolicySetup()),
			onResult: (result) => {
				if (!current()) return;
				if (!result.success) {
					failed(result.error);
					return;
				}
				if (value)
					toast.success(t("onboarding.vacationPolicy.success", "Vacation policy created!"));
				push("/onboarding/work-templates");
				return true;
			},
			onRejected: () => failed(),
			setLoading: (pending) => {
				if (current()) {
					busy.current = pending;
					setLoading(pending);
				}
			},
		});
	}

	const form = useVacationPolicyForm({ onSubmit: runPolicyAction, t });
	async function handleSave(element: HTMLFormElement) {
		if (!active.current || isAdmin !== true || busy.current) return;
		busy.current = true;
		saveStarted.current = false;
		setLoading(true);
		const request = sequence.current;
		const arrival = epoch.current;
		saveIntent.current = { request, arrival };
		await form
			.handleSubmit()
			.catch(() => {
				if (active.current && sequence.current === request && epoch.current === arrival) {
					saveStarted.current = false;
					toast.error(t("onboarding.vacationPolicy.error", "Failed to create vacation policy"));
				}
			})
			.finally(() => {
				if (
					active.current &&
					sequence.current === request &&
					epoch.current === arrival &&
					!saveStarted.current
				) {
					busy.current = false;
					// This reset is already in finally, guarded against a retired arrival.
					// react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
					setLoading(false);
					// Wait until React has re-enabled controls after validation.
					setTimeout(() => {
						if (active.current && sequence.current === request && epoch.current === arrival) {
							element.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
						}
					}, 0);
				}
			});
	}
	const allowCarryover = useStore(form.store, (state) => state.values.allowCarryover);
	if (isAdmin !== true) return <PolicyAccessLoading />;
	return (
		<>
			<ProgressIndicator currentStep="vacation_policy" />
			<div className="mx-auto w-full max-w-2xl min-w-0">
				<VacationPolicyHeader t={t} />
				<VacationPolicyForm
					allowCarryover={allowCarryover}
					form={form}
					loading={loading}
					onSave={(element) => {
						void handleSave(element);
					}}
					onSkip={() => {
						void runPolicyAction();
					}}
					t={t}
				/>
			</div>
		</>
	);
}
