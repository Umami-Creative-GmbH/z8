"use client";

import {
	IconAlertTriangle,
	IconInfoCircle,
	IconLoader2,
	IconScale,
	IconSchool,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getStatutorySettingsAction,
	updateStatutoryPreferencesAction,
} from "@/app/[locale]/(app)/settings/contracts/statutory-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import {
	formatMinuteOfDay,
	MINUTES_PER_DAY,
	WORKING_STUDENT_DAYTIME_STEP_MINUTES,
} from "@/lib/statutory/daytime-band";
import type { StatutoryPreferenceRefusal } from "@/lib/statutory/preferences";
import { invalidateOrganizationWorkingStudentFindings } from "./working-student-queries";
import type { StatutoryBaselineView } from "@/lib/statutory/settings-overview";
import type {
	StatutoryDomain,
	StatutoryThresholdKey,
	StatutoryThresholdUnit,
} from "@/lib/statutory/threshold-catalog";

type Translate = ReturnType<typeof useTranslate>["t"];

const PREFERENCE_REFUSALS = {
	statutory_percent_out_of_range: [
		"settings.contracts.statutory.preferences.percentRange",
		"Enter whole percentages from 1 to 100.",
	],
	statutory_warning_not_below_critical: [
		"settings.contracts.statutory.preferences.warningBelowCritical",
		"The warning percentage must be below the critical percentage.",
	],
	statutory_daytime_band_out_of_range: [
		"settings.contracts.statutory.preferences.daytimeBandRange",
		"Choose whole quarter hours from 00:00 to 24:00.",
	],
	statutory_daytime_band_start_not_before_end: [
		"settings.contracts.statutory.preferences.daytimeBandOrder",
		"The daytime band must start before it ends.",
	],
} satisfies RefusalMessages<StatutoryPreferenceRefusal>;

/** Quarter hours from 00:00 to 24:00. */
const QUARTER_HOURS = Array.from(
	{ length: MINUTES_PER_DAY / WORKING_STUDENT_DAYTIME_STEP_MINUTES + 1 },
	(_, index) => index * WORKING_STUDENT_DAYTIME_STEP_MINUTES,
);
const BAND_STARTS = QUARTER_HOURS.slice(0, -1);
const BAND_ENDS = QUARTER_HOURS.slice(1);

function domainLabel(domain: StatutoryDomain, t: Translate): string {
	switch (domain) {
		case "minijob":
			return t("settings.contracts.statutory.domain.minijob", "Minijob (§ 8 SGB IV)");
		case "short_term":
			return t("settings.contracts.statutory.domain.shortTerm", "Short-term employment");
		case "working_student":
			return t("settings.contracts.statutory.domain.workingStudent", "Working students");
		case "on_call":
			return t("settings.contracts.statutory.domain.onCall", "On-call work (§ 12 TzBfG)");
		case "youth_protection":
			return t(
				"settings.contracts.statutory.domain.youthProtection",
				"Youth protection (JArbSchG)",
			);
		case "apprenticeship":
			return t("settings.contracts.statutory.domain.apprenticeship", "Apprentices (BBiG)");
	}
}

function thresholdLabel(key: StatutoryThresholdKey, t: Translate): string {
	switch (key) {
		case "de_minijob_monthly_limit_cents":
			return t("settings.contracts.statutory.key.minijobMonthlyLimit", "Monthly earnings limit");
		case "de_minijob_max_unforeseeable_months_per_12m":
			return t(
				"settings.contracts.statutory.key.minijobUnforeseeableMonths",
				"Unforeseeable exceedance months per 12 months",
			);
		case "de_minijob_unforeseeable_multiplier":
			return t(
				"settings.contracts.statutory.key.minijobUnforeseeableMultiplier",
				"Maximum earnings in an exceedance month",
			);
		case "de_short_term_max_work_days_per_year":
			return t("settings.contracts.statutory.key.shortTermDays", "Working days per calendar year");
		case "de_short_term_max_months_per_year":
			return t("settings.contracts.statutory.key.shortTermMonths", "Months per calendar year");
		case "de_working_student_weekly_minutes":
			return t(
				"settings.contracts.statutory.key.workingStudentWeekly",
				"Weekly hours during lecture periods",
			);
		case "de_working_student_max_over_20h_weeks_per_12m":
			return t(
				"settings.contracts.statutory.key.workingStudentWeeks",
				"Weeks above 20 hours per 12 months",
			);
		case "de_working_student_max_over_20h_days_per_12m":
			return t(
				"settings.contracts.statutory.key.workingStudentDays",
				"Days above 20 hours per 12 months",
			);
		case "de_on_call_notice_full_days":
			return t("settings.contracts.statutory.key.onCallNotice", "Full days of call-in notice");
		case "de_on_call_min_call_minutes":
			return t("settings.contracts.statutory.key.onCallMinCall", "Minimum call duration");
		case "de_on_call_default_weekly_minutes":
			return t(
				"settings.contracts.statutory.key.onCallDefaultWeekly",
				"Weekly hours when none are agreed",
			);
		case "de_on_call_min_band_plus_pct":
			return t(
				"settings.contracts.statutory.key.onCallMinBand",
				"Extra call-off above an agreed minimum",
			);
		case "de_on_call_max_band_minus_pct":
			return t(
				"settings.contracts.statutory.key.onCallMaxBand",
				"Reduced call-off below an agreed maximum",
			);
		case "de_jarbschg_max_daily_minutes":
			return t("settings.contracts.statutory.key.youthDaily", "Daily working time");
		case "de_jarbschg_max_daily_compensatory_minutes":
			return t(
				"settings.contracts.statutory.key.youthDailyCompensatory",
				"Daily working time with compensation in the week",
			);
		case "de_jarbschg_max_weekly_minutes":
			return t("settings.contracts.statutory.key.youthWeekly", "Weekly working time");
		case "de_jarbschg_max_days_per_week":
			return t("settings.contracts.statutory.key.youthDays", "Working days per week");
		case "de_jarbschg_min_rest_minutes":
			return t("settings.contracts.statutory.key.youthRest", "Minimum daily rest");
		case "de_jarbschg_break_after_270_minutes":
			return t(
				"settings.contracts.statutory.key.youthBreak270",
				"Break for more than 4.5 up to 6 hours of work",
			);
		case "de_jarbschg_break_after_360_minutes":
			return t(
				"settings.contracts.statutory.key.youthBreak360",
				"Break for more than 6 hours of work",
			);
		case "de_jarbschg_min_break_segment_minutes":
			return t("settings.contracts.statutory.key.youthBreakSegment", "Shortest counted break");
		case "de_jarbschg_max_uninterrupted_minutes":
			return t(
				"settings.contracts.statutory.key.youthUninterrupted",
				"Longest work without a break",
			);
		case "de_jarbschg_night_start":
			return t("settings.contracts.statutory.key.youthNightStart", "Night rest starts");
		case "de_jarbschg_night_end":
			return t("settings.contracts.statutory.key.youthNightEnd", "Night rest ends");
	}
}

function formatValue(
	row: { value: number; unit: StatutoryThresholdUnit; currency: string | null },
	t: Translate,
	locale: string,
): string {
	const number = (value: number) =>
		new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
	switch (row.unit) {
		case "cents":
			return new Intl.NumberFormat(locale, {
				style: "currency",
				currency: row.currency ?? "EUR",
			}).format(row.value / 100);
		case "minutes":
			return t("settings.contracts.statutory.value.hours", "{hours} h", {
				hours: number(row.value / 60),
			});
		case "days":
			return t(
				"settings.contracts.statutory.value.days",
				"{count, plural, one {# day} other {# days}}",
				{ count: row.value },
			);
		case "weeks":
			return t(
				"settings.contracts.statutory.value.weeks",
				"{count, plural, one {# week} other {# weeks}}",
				{ count: row.value },
			);
		case "months":
			return t(
				"settings.contracts.statutory.value.months",
				"{count, plural, one {# month} other {# months}}",
				{ count: row.value },
			);
		case "percent":
			return t("settings.contracts.statutory.value.percent", "{value} %", {
				value: number(row.value),
			});
		case "multiplier":
			return t("settings.contracts.statutory.value.multiplier", "{value}× the monthly limit", {
				value: number(row.value),
			});
		case "minute_of_day":
			return formatMinuteOfDay(row.value);
	}
}

function BaselinesCard({
	baselines,
	locale,
}: {
	baselines: readonly StatutoryBaselineView[];
	locale: string;
}) {
	const { t } = useTranslate();
	const [showHistory, setShowHistory] = useState(false);
	const visible = baselines.filter((row) => showHistory || row.status !== "past");
	const formatDate = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1.5">
						<CardTitle className="flex items-center gap-2">
							<IconScale className="size-5 text-primary" aria-hidden="true" />
							{t("settings.contracts.statutory.baselinesTitle", "German statutory baselines")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.contracts.statutory.baselinesDescription",
								"Z8 maintains these limits and their effective dates. Each day is judged against the values in force on that day; organizations cannot change them.",
							)}
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id="statutory-show-history"
							checked={showHistory}
							onCheckedChange={(checked) => setShowHistory(checked === true)}
						/>
						<Label htmlFor="statutory-show-history" className="text-xs">
							{t("settings.contracts.statutory.showHistory", "Show earlier values")}
						</Label>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.contracts.statutory.column.area", "Area")}</TableHead>
								<TableHead>{t("settings.contracts.statutory.column.limit", "Limit")}</TableHead>
								<TableHead className="text-right">
									{t("settings.contracts.statutory.column.value", "Value")}
								</TableHead>
								<TableHead>
									{t("settings.contracts.statutory.column.effective", "In force")}
								</TableHead>
								<TableHead>
									{t("settings.contracts.statutory.column.legalReference", "Legal basis")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{visible.map((row) => (
								<TableRow key={`${row.key}:${row.effectiveFromDate}`}>
									<TableCell className="text-muted-foreground text-xs">
										{domainLabel(row.domain, t)}
									</TableCell>
									<TableCell className="font-medium">{thresholdLabel(row.key, t)}</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatValue(row, t, locale)}
									</TableCell>
									<TableCell className="whitespace-nowrap text-xs tabular-nums">
										<div className="flex flex-wrap items-center gap-2">
											<span>
												{row.effectiveUntilDate
													? t("settings.contracts.statutory.effectiveRange", "{from} – {until}", {
															from: formatDate(row.effectiveFromDate),
															until: formatDate(
																parsePlainDate(row.effectiveUntilDate)
																	.subtract({ days: 1 })
																	.toString(),
															),
														})
													: t("settings.contracts.statutory.effectiveFrom", "From {from}", {
															from: formatDate(row.effectiveFromDate),
														})}
											</span>
											{row.status === "current" && (
												<Badge variant="secondary">
													{t("settings.contracts.statutory.status.current", "Current")}
												</Badge>
											)}
											{row.status === "upcoming" && (
												<Badge variant="outline" className="border-primary/40 text-primary">
													{t("settings.contracts.statutory.status.upcoming", "Upcoming")}
												</Badge>
											)}
										</div>
									</TableCell>
									<TableCell className="text-muted-foreground text-xs">
										{row.legalReference}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}

interface PreferencesFormValues {
	warningThresholdPercent: number;
	criticalThresholdPercent: number;
	blockJarbschgShiftPublish: boolean;
	workingStudentDaytimeStartMinute: number;
	workingStudentDaytimeEndMinute: number;
}

function PreferencesCard({
	organizationId,
	initial,
}: {
	organizationId: string;
	initial: PreferencesFormValues;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		mutationFn: async (value: PreferencesFormValues) => {
			const result = await updateStatutoryPreferencesAction(value);
			if (!result.success) {
				throw new Error(actionErrorMessage(t, result, PREFERENCE_REFUSALS));
			}
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.contracts.statutory.preferences.saved", "Warning settings saved"));
			void queryClient.invalidateQueries({
				queryKey: ["contracts", "statutory", organizationId],
			});
			// The tiers and the daytime band change findings: the views that show them judge anew.
			void invalidateOrganizationWorkingStudentFindings(queryClient, organizationId);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: t(
							"settings.contracts.statutory.preferences.saveFailed",
							"Could not save the settings.",
						),
			);
		},
	});

	const form = useForm({
		defaultValues: initial,
		onSubmit: async ({ value }) => {
			await saveMutation.mutateAsync(value);
		},
	});

	const percentError = (value: number) =>
		Number.isInteger(value) && value >= 1 && value <= 100
			? undefined
			: t(
					"settings.contracts.statutory.preferences.percentRange",
					"Enter whole percentages from 1 to 100.",
				);

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.contracts.statutory.preferences.title", "Statutory warning settings")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.statutory.preferences.description",
						"Decide when planners and HR are warned before a statutory limit is reached. Warnings never block clocking in or out.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					noValidate
					aria-busy={saveMutation.isPending}
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field
							name="warningThresholdPercent"
							validators={{
								onChange: ({ value }) => percentError(value),
								onChangeListenTo: ["criticalThresholdPercent"],
								onSubmit: ({ value, fieldApi }) =>
									percentError(value) ??
									(value >= fieldApi.form.getFieldValue("criticalThresholdPercent")
										? t(
												"settings.contracts.statutory.preferences.warningBelowCritical",
												"The warning percentage must be below the critical percentage.",
											)
										: undefined),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.contracts.statutory.preferences.warning", "Warning at")}
									</TFormLabel>
									<div className="flex items-center gap-2">
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												type="number"
												inputMode="numeric"
												min={1}
												max={100}
												step={1}
												className="w-28 tabular-nums"
												name={field.name}
												value={Number.isNaN(field.state.value) ? "" : field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => field.handleChange(event.target.valueAsNumber)}
											/>
										</TFormControl>
										<span className="text-muted-foreground text-sm" aria-hidden="true">
											%
										</span>
									</div>
									<TFormDescription>
										{t(
											"settings.contracts.statutory.preferences.warningHelp",
											"Share of a statutory limit that raises a warning.",
										)}
									</TFormDescription>
									<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="criticalThresholdPercent"
							validators={{
								onChange: ({ value }) => percentError(value),
								onSubmit: ({ value }) => percentError(value),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.contracts.statutory.preferences.critical", "Critical at")}
									</TFormLabel>
									<div className="flex items-center gap-2">
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												type="number"
												inputMode="numeric"
												min={1}
												max={100}
												step={1}
												className="w-28 tabular-nums"
												name={field.name}
												value={Number.isNaN(field.state.value) ? "" : field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => field.handleChange(event.target.valueAsNumber)}
											/>
										</TFormControl>
										<span className="text-muted-foreground text-sm" aria-hidden="true">
											%
										</span>
									</div>
									<TFormDescription>
										{t(
											"settings.contracts.statutory.preferences.criticalHelp",
											"Share of a statutory limit that raises an urgent warning.",
										)}
									</TFormDescription>
									<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
								</TFormItem>
							)}
						</form.Field>
					</div>

					<form.Field name="blockJarbschgShiftPublish">
						{(field) => (
							<div className="flex items-start justify-between gap-4 rounded-lg border p-4">
								<div className="space-y-1">
									<Label htmlFor="statutory-block-jarbschg" className="font-medium">
										{t(
											"settings.contracts.statutory.preferences.blockJarbschg",
											"Block publishing shifts that break youth protection limits",
										)}
									</Label>
									<p className="text-muted-foreground text-sm">
										{t(
											"settings.contracts.statutory.preferences.blockJarbschgHelp",
											"Shifts for employees under 18 cannot be published while they break a JArbSchG limit, unless a statutory exception is acknowledged. Recorded working time is never blocked.",
										)}
									</p>
								</div>
								<Switch
									id="statutory-block-jarbschg"
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked)}
								/>
							</div>
						)}
					</form.Field>

					<fieldset className="space-y-4 rounded-lg border p-4">
						<legend className="sr-only">
							{t(
								"settings.contracts.statutory.preferences.daytimeBand",
								"Working-student daytime band",
							)}
						</legend>
						<div className="space-y-1">
							<p className="flex items-center gap-2 font-medium text-sm" aria-hidden="true">
								<IconSchool className="size-4 text-primary" />
								{t(
									"settings.contracts.statutory.preferences.daytimeBand",
									"Working-student daytime band",
								)}
							</p>
							<p className="text-muted-foreground text-sm">
								{t(
									"settings.contracts.statutory.preferences.daytimeBandHelp",
									"Weekday work inside this band during lecture periods counts against the 20-hour rule for working students (§ 6 Abs. 1 Nr. 3 SGB V). Evening and night work outside it, weekends and lecture-free periods do not count.",
								)}
							</p>
							<p className="text-muted-foreground text-sm">
								{t(
									"settings.contracts.statutory.preferences.daytimeBandInsurer",
									"The law names no hours. Use the band your health insurer and payroll advisor accept.",
								)}
							</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field
								name="workingStudentDaytimeStartMinute"
								validators={{
									onChangeListenTo: ["workingStudentDaytimeEndMinute"],
									onSubmit: ({ value, fieldApi }) =>
										value < fieldApi.form.getFieldValue("workingStudentDaytimeEndMinute")
											? undefined
											: t(
													"settings.contracts.statutory.preferences.daytimeBandOrder",
													"The daytime band must start before it ends.",
												),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.contracts.statutory.preferences.daytimeStart", "Counts from")}
										</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => value !== null && field.handleChange(value)}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger className="w-28 tabular-nums">
													<SelectValue />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												{BAND_STARTS.map((minute) => (
													<SelectItem key={minute} value={minute} className="tabular-nums">
														{formatMinuteOfDay(minute)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
							<form.Field name="workingStudentDaytimeEndMinute">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t("settings.contracts.statutory.preferences.daytimeEnd", "Counts until")}
										</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => value !== null && field.handleChange(value)}
										>
											<TFormControl>
												<SelectTrigger className="w-28 tabular-nums">
													<SelectValue />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												{BAND_ENDS.map((minute) => (
													<SelectItem key={minute} value={minute} className="tabular-nums">
														{formatMinuteOfDay(minute)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</TFormItem>
								)}
							</form.Field>
						</div>
					</fieldset>

					<div className="flex justify-end">
						<form.Subscribe selector={(state) => state.isDirty}>
							{(isDirty) => (
								<Button type="submit" disabled={!isDirty || saveMutation.isPending}>
									{saveMutation.isPending && (
										<IconLoader2
											className="size-4 animate-spin motion-reduce:animate-none"
											aria-hidden="true"
										/>
									)}
									{t("settings.contracts.statutory.preferences.save", "Save warning settings")}
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

export interface ContractsStatutoryTabProps {
	organizationId: string;
}

export function ContractsStatutoryTab({ organizationId }: ContractsStatutoryTabProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";

	const overviewQuery = useQuery({
		queryKey: ["contracts", "statutory", organizationId],
		queryFn: async () => {
			const result = await getStatutorySettingsAction();
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		staleTime: 60 * 1000,
	});

	if (overviewQuery.isLoading) {
		return (
			<p className="text-muted-foreground text-sm" role="status">
				{t("common.loading", "Loading…")}
			</p>
		);
	}

	if (overviewQuery.isError || !overviewQuery.data) {
		return (
			<Alert variant="destructive">
				<IconAlertTriangle className="size-4" aria-hidden="true" />
				<AlertDescription>
					{t(
						"settings.contracts.statutory.loadFailed",
						"Could not load the statutory baselines. Try again.",
					)}
				</AlertDescription>
			</Alert>
		);
	}

	const { baselines, preferences } = overviewQuery.data;

	return (
		<div className="space-y-6">
			<PreferencesCard
				// Remount after a save so the form starts from the stored values.
				key={`${preferences.warningThresholdPercent}:${preferences.criticalThresholdPercent}:${preferences.blockJarbschgShiftPublish}:${preferences.workingStudentDaytimeStartMinute}:${preferences.workingStudentDaytimeEndMinute}`}
				organizationId={organizationId}
				initial={{
					warningThresholdPercent: preferences.warningThresholdPercent,
					criticalThresholdPercent: preferences.criticalThresholdPercent,
					blockJarbschgShiftPublish: preferences.blockJarbschgShiftPublish,
					workingStudentDaytimeStartMinute: preferences.workingStudentDaytimeStartMinute,
					workingStudentDaytimeEndMinute: preferences.workingStudentDaytimeEndMinute,
				}}
			/>
			{baselines.length === 0 ? (
				<div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
					<IconInfoCircle className="size-4" aria-hidden="true" />
					{t("settings.contracts.statutory.empty", "No statutory baselines are available.")}
				</div>
			) : (
				<BaselinesCard baselines={baselines} locale={locale} />
			)}
		</div>
	);
}
