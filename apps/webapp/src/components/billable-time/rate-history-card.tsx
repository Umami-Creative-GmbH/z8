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
	/** Shows the change form; the server still authorizes every change. */
	canEdit: boolean;
	onSetRate: (input: { effectiveFrom: string; rate: string }) => Promise<RateChangeResult>;
	onEndRate: (input: { effectiveFrom: string }) => Promise<RateChangeResult>;
	/** Text for an empty history, e.g. which rate level applies instead. */
	emptyText?: ReactNode;
	/** Render without the card frame, e.g. inside an action panel. */
	bare?: boolean;
}

type FormMode = "set" | "end";

/**
 * The current rate and the history of one effective-dated rate series, with a
 * form to set a rate from a date (backdating allowed) or end it. Shared by
 * billable rates (#898) and cost rates (#899).
 */
export function RateHistoryCard({
	title,
	description,
	currency,
	periods,
	isLoading,
	canEdit,
	onSetRate,
	onEndRate,
	emptyText,
	bare,
}: RateHistoryCardProps) {
	const { t } = useTranslate();
	const { locale, timezone } = useDisplayContext();
	const [mode, setMode] = useState<FormMode | null>(null);
	const today = Temporal.Now.plainDateISO(timezone).toString();
	const current = periods.find((period) => periodContains(period, today)) ?? null;

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
			<div className="space-y-1">
				<div className="flex items-center gap-2 font-semibold">{title}</div>
				{description && <div className="text-sm text-muted-foreground">{description}</div>}
			</div>
			{canEdit && mode === null && (
				<div className="flex gap-2">
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
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border bg-muted/30 p-4"
		>
			<p className="text-sm text-muted-foreground">
				{mode === "set"
					? t(
							"settings.billableTime.rates.setRateHelp",
							"The new rate applies from this date until the next rate change. Earlier dates reprice work that is not invoiced yet.",
						)
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
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<div className="relative">
									<Input
										inputMode="decimal"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={current?.hourlyRate ?? "0.00"}
										className="pr-16"
									/>
									<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
										{t("settings.billableTime.rates.perHour", "{currency}/h", { currency })}
									</span>
								</div>
							</TFormControl>
							{current && (
								<TFormDescription>
									{t("settings.billableTime.rates.currentRateHint", "Current rate: {rate}", {
										rate: formatBillableAmount(locale, current.hourlyRate, currency),
									})}
								</TFormDescription>
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
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
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

	const history = isLoading ? (
		<div className="flex items-center justify-center p-4">
			<IconLoader2
				aria-label={t("common.loading", "Loading")}
				className="size-6 animate-spin text-muted-foreground"
			/>
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
					const isCurrent = period.id === current?.id;
					const from = formatRateDate(locale, period.effectiveFrom);
					return (
						<li key={period.id} className="relative flex items-start gap-4">
							<div
								aria-hidden="true"
								className={cn(
									"absolute left-[-13px] flex size-6 items-center justify-center rounded-full",
									isCurrent ? "bg-primary text-primary-foreground" : "bg-muted",
								)}
							>
								<IconCircleDot className="size-4" />
							</div>
							<div className="ml-4 flex-1 space-y-1">
								<div className="flex items-center gap-2">
									<span className={cn("font-medium tabular-nums", isCurrent && "text-primary")}>
										{t("settings.billableTime.rates.ratePerHour", "{rate}/h", {
											rate: formatBillableAmount(locale, period.hourlyRate, currency),
										})}
									</span>
									{isCurrent && (
										<Badge variant="default">
											{t("settings.billableTime.rates.current", "Current")}
										</Badge>
									)}
								</div>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<IconCalendar aria-hidden="true" className="size-3" />
									<span>
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
