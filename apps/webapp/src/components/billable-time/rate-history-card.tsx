"use client";

import { IconCalendar, IconCircleDot, IconLoader2, IconPlus, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useDisplayContext } from "@/hooks/use-display-context";
import {
	formatBillableAmount,
	formatRateDate,
	formatRateInput,
	lastDayBefore,
	periodContains,
} from "@/lib/billable-time/format";
import { parseRate } from "@/lib/billable-time/money";
import type { BillableRatePeriodView } from "@/lib/billable-time/rate-target";
import { cn } from "@/lib/utils";

/** null on success, otherwise a message to show. */
export type RateChangeResult = string | null;

export interface RateHistoryCardProps {
	title: ReactNode;
	description?: ReactNode;
	/** The billable currency every rate is in. */
	currency: string;
	/** Newest first. */
	periods: readonly BillableRatePeriodView[];
	isLoading?: boolean;
	/**
	 * Why the history could not be read. Shown in place of the history, inside the
	 * card frame so its title stays; editing is unavailable meanwhile.
	 */
	loadError?: ReactNode;
	/** Reads the history again after a failure; shows a Retry button. */
	onRetry?: () => void;
	/** True while a retry is running. */
	isRetrying?: boolean;
	/** Shows the change form; the server still authorizes every change. */
	canEdit: boolean;
	onSetRate: (input: { effectiveFrom: string; rate: string }) => Promise<RateChangeResult>;
	onEndRate: (input: { effectiveFrom: string }) => Promise<RateChangeResult>;
	/** Text for an empty history, e.g. which rate level applies instead. */
	emptyText?: ReactNode;
	/** Render without the card frame, e.g. inside an action panel. */
	bare?: boolean;
	/** Overrides the help text of the set-rate form. */
	setRateHelp?: ReactNode;
	/**
	 * A starting value the form offers (e.g. an hourly employee's wage for a cost
	 * rate). Only filled in when the user picks it; never submitted on its own.
	 */
	suggestion?: { rate: string; label: (formattedRate: string) => string } | null;
}

type FormMode = "set" | "end";

/**
 * The rate in effect today and the history of one effective-dated rate series, with a
 * form to set a rate from a date (backdating allowed) or end it. Shared by
 * billable rates (#898) and cost rates (#899).
 */
export function RateHistoryCard({
	title,
	description,
	currency,
	periods,
	isLoading,
	loadError,
	onRetry,
	isRetrying = false,
	canEdit: canEditProp,
	onSetRate,
	onEndRate,
	emptyText,
	bare,
	setRateHelp,
	suggestion,
}: RateHistoryCardProps) {
	const { t } = useTranslate();
	const { locale, timezone } = useDisplayContext();
	const [mode, setMode] = useState<FormMode | null>(null);
	const canEdit = canEditProp && !loadError;
	const today = Temporal.Now.plainDateISO(timezone).toString();
	const inEffectToday = periods.find((period) => periodContains(period, today)) ?? null;

	const form = useForm({
		defaultValues: { effectiveFrom: today, rate: "" },
		onSubmit: async ({ value }) => {
			const error =
				mode === "end"
					? await onEndRate({ effectiveFrom: value.effectiveFrom })
					: await onSetRate({ effectiveFrom: value.effectiveFrom, rate: value.rate });
			if (error === null) {
				setMode(null);
				form.reset();
			}
		},
	});

	const header = (
		<div className="flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0 flex-[1_1_12rem] space-y-1 break-words">
				<div className="flex flex-wrap items-center gap-2 font-semibold">{title}</div>
				{description && <div className="text-sm text-muted-foreground">{description}</div>}
			</div>
			{canEdit && mode === null && (
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={() => setMode("set")}>
						<IconPlus aria-hidden="true" className="mr-2 size-4" />
						{t("settings.billableTime.rates.setRate", "Set rate")}
					</Button>
					{periods.length > 0 && (
						<Button size="sm" variant="outline" onClick={() => setMode("end")}>
							<IconX aria-hidden="true" className="mr-2 size-4" />
							{t("settings.billableTime.rates.endRate", "End rate")}
						</Button>
					)}
				</div>
			)}
		</div>
	);

	const changeForm = mode !== null && (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				// Enter in a field must not start a second change while one is saving.
				if (form.state.isSubmitting) return;
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border bg-muted/30 p-4"
		>
			<p className="text-sm text-muted-foreground">
				{mode === "set"
					? (setRateHelp ??
						t(
							"settings.billableTime.rates.setRateHelp",
							"The new rate applies from this date until the next rate change. Earlier dates reprice work that is not invoiced yet.",
						))
					: t(
							"settings.billableTime.rates.endRateHelp",
							"From this date, this rate no longer applies until the next rate change.",
						)}
			</p>
			<form.Field
				name="effectiveFrom"
				validators={{
					onSubmit: ({ value }) =>
						value
							? undefined
							: t("settings.billableTime.rates.dateRequired", "Choose the first day it applies"),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{mode === "set"
								? t("settings.billableTime.rates.effectiveFrom", "Applies from")
								: t("settings.billableTime.rates.endsFrom", "No longer applies from")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<DatePicker
								value={field.state.value}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			{mode === "set" && (
				<form.Field
					name="rate"
					validators={{
						onSubmit: ({ value }) =>
							parseRate(value).ok
								? undefined
								: t(
										"settings.billableTime.rates.rateInvalid",
										"Enter a positive hourly rate with at most two decimals",
									),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.billableTime.rates.hourlyRate", "Hourly rate")}
								{/* The unit suffix inside the input is visual; name it for assistive technology. */}
								<span className="sr-only">
									{" "}
									({t("settings.billableTime.rates.perHour", "{currency}/h", { currency })})
								</span>
							</TFormLabel>
							{/* The control (and so the label's target) is the input itself, not its wrapper. */}
							<div className="relative">
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										inputMode="decimal"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={formatRateInput(locale, inEffectToday?.hourlyRate ?? "0.00")}
										className="pr-16 tabular-nums"
									/>
								</TFormControl>
								<span
									aria-hidden="true"
									className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
								>
									{t("settings.billableTime.rates.perHour", "{currency}/h", { currency })}
								</span>
							</div>
							{inEffectToday && (
								<TFormDescription>
									{t("settings.billableTime.rates.inEffectTodayHint", "In effect today: {rate}", {
										rate: formatBillableAmount(locale, inEffectToday.hourlyRate, currency),
									})}
								</TFormDescription>
							)}
							{suggestion && (
								<Button
									type="button"
									variant="link"
									size="sm"
									className="h-auto px-0"
									onClick={() => field.handleChange(suggestion.rate)}
								>
									{suggestion.label(formatBillableAmount(locale, suggestion.rate, currency))}
								</Button>
							)}
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={isSubmitting}
							onClick={() => {
								setMode(null);
								form.reset();
							}}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 motion-safe:animate-spin" />
							)}
							{mode === "set"
								? t("settings.billableTime.rates.saveRate", "Save rate")
								: t("settings.billableTime.rates.saveEnd", "End rate")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);

	const history = loadError ? (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="text-sm text-destructive" role="alert">
				{loadError}
			</p>
			{onRetry && (
				<Button type="button" variant="outline" size="sm" disabled={isRetrying} onClick={onRetry}>
					{isRetrying && (
						<IconLoader2 aria-hidden="true" className="mr-2 size-4 motion-safe:animate-spin" />
					)}
					{t("common.retry", "Retry")}
				</Button>
			)}
		</div>
	) : isLoading ? (
		<div className="flex items-center justify-center p-4" role="status">
			<IconLoader2 aria-hidden="true" className="size-6 motion-safe:animate-spin text-muted-foreground" />
			<span className="sr-only">{t("common.loading", "Loading")}</span>
		</div>
	) : periods.length === 0 ? (
		<p className="text-sm text-muted-foreground">
			{emptyText ?? t("settings.billableTime.rates.empty", "No rate set yet")}
		</p>
	) : (
		<div className="relative pl-6">
			<div aria-hidden="true" className="absolute bottom-0 left-[11px] top-0 w-px bg-border" />
			<ol className="space-y-4">
				{periods.map((period) => {
					const isInEffectToday = period.id === inEffectToday?.id;
					const from = formatRateDate(locale, period.effectiveFrom);
					return (
						<li key={period.id} className="relative flex items-start gap-4">
							<div
								aria-hidden="true"
								className={cn(
									"absolute left-[-13px] flex size-6 items-center justify-center rounded-full",
									isInEffectToday ? "bg-primary text-primary-foreground" : "bg-muted",
								)}
							>
								<IconCircleDot className="size-4" />
							</div>
							<div className="ml-4 flex-1 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<span
										className={cn("font-medium tabular-nums", isInEffectToday && "text-primary")}
									>
										{t("settings.billableTime.rates.ratePerHour", "{rate}/h", {
											rate: formatBillableAmount(locale, period.hourlyRate, currency),
										})}
									</span>
									{isInEffectToday && (
										<Badge variant="default">
											{t("settings.billableTime.rates.inEffect", "In effect")}
										</Badge>
									)}
								</div>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<IconCalendar aria-hidden="true" className="size-3" />
									<span className="tabular-nums">
										{period.effectiveTo === null
											? t("settings.billableTime.rates.openPeriod", "From {from}", { from })
											: t("settings.billableTime.rates.closedPeriod", "{from} to {to}", {
													from,
													to: formatRateDate(locale, lastDayBefore(period.effectiveTo)),
												})}
									</span>
								</div>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);

	if (bare) {
		return (
			<div className="space-y-4">
				{header}
				{changeForm}
				{history}
			</div>
		);
	}

	return (
		<Card>
			<CardHeader>{header}</CardHeader>
			<CardContent className="space-y-4">
				{changeForm}
				{history}
			</CardContent>
		</Card>
	);
}
