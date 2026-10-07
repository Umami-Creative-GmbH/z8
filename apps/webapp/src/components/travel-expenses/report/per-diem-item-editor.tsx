"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { savePerDiemDraftAction } from "@/app/[locale]/(app)/travel-expenses/per-diem-actions";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { withoutOverriddenRequirements } from "@/lib/travel-expenses/allowance-override";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import {
	emptyPerDiemItinerary,
	MAX_PER_DIEM_DAYS,
	PER_DIEM_MEALS,
	type PerDiemCalculation,
	type PerDiemDraftField,
	type PerDiemDraftInput,
	type PerDiemItinerary,
	type PerDiemMeal,
	type PerDiemRequirement,
	parsePerDiemDraft,
	perDiemMissingRequirements,
	samePerDiemItinerary,
	tripDays,
} from "@/lib/travel-expenses/per-diem";
import {
	perDiemLocationFields,
	perDiemLocationsNeeded,
} from "@/lib/travel-expenses/per-diem-location";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import { AllowanceOverrideNotice } from "./allowance-override-notice";
import { DraftSaveStatus } from "./draft-save-status";
import {
	dayLocationDraft,
	dayLocationForm,
	type DayLocationForm,
	NO_LOCATION,
	PerDiemDayLocationFields,
} from "./per-diem-day-location";
import { formatPlainDate } from "./format";
import { mealLabel, PerDiemBreakdown, perDiemExceptionLabel } from "./per-diem-breakdown";
import { RemoveExpenseButton } from "./receipt-item-editor";
import { useDraftSaver } from "./use-draft-saver";

type Translate = ReturnType<typeof useTranslate>["t"];
type MealForm = { provided: boolean; payment: string };
type DayMealsForm = Record<PerDiemMeal, MealForm>;
interface FormValues {
	startDate: string;
	startTime: string;
	startTimeZone: string;
	endDate: string;
	endTime: string;
	endTimeZone: string;
	overnight: string;
	prolongedWorkplace: boolean;
	/** Meal facts by date; kept when the travel dates move. */
	meals: Record<string, DayMealsForm>;
	/** Daily location answers by date (#611); kept when the travel dates move. */
	locations: Record<string, DayLocationForm>;
}

const NO_MEALS: DayMealsForm = {
	breakfast: { provided: false, payment: "" },
	lunch: { provided: false, payment: "" },
	dinner: { provided: false, payment: "" },
};

/** The entered per diem facts of a saved item. */
export function perDiemDraftOf(item: ReportItemView): PerDiemItinerary {
	return item.perDiem?.itinerary ?? emptyPerDiemItinerary(null);
}

/** Whether entered per diem facts equal the saved item, so its calculation applies to them. */
export function perDiemDraftMatches(draft: PerDiemItinerary, item: ReportItemView): boolean {
	return samePerDiemItinerary(draft, perDiemDraftOf(item));
}

/** The travel days of entered dates; empty while they are missing, reversed or too long. */
function travelDays(startDate: string, endDate: string): string[] {
	try {
		if (!startDate || !endDate) return [];
		if (comparePlainDates(parsePlainDate(endDate), parsePlainDate(startDate)) < 0) return [];
		const days = tripDays(startDate, endDate);
		return days.length > MAX_PER_DIEM_DAYS ? [] : days;
	} catch {
		return [];
	}
}

function toFormValues(itinerary: PerDiemItinerary): FormValues {
	return {
		startDate: itinerary.startDate ?? "",
		startTime: itinerary.startTime ?? "",
		startTimeZone: itinerary.startTimeZone ?? "",
		endDate: itinerary.endDate ?? "",
		endTime: itinerary.endTime ?? "",
		endTimeZone: itinerary.endTimeZone ?? "",
		overnight: itinerary.overnight ?? "",
		prolongedWorkplace: itinerary.prolongedWorkplace,
		meals: Object.fromEntries(
			itinerary.meals.map((day) => [
				day.date,
				Object.fromEntries(
					PER_DIEM_MEALS.map((meal) => [
						meal,
						{ provided: day[meal].provided, payment: day[meal].employeePayment ?? "" },
					]),
				) as DayMealsForm,
			]),
		),
		locations: Object.fromEntries(itinerary.meals.map((day) => [day.date, dayLocationForm(day)])),
	};
}

function blank(value: string): string | null {
	return value.trim() === "" ? null : value;
}

function toDraftInput(values: FormValues): PerDiemDraftInput {
	const days = travelDays(values.startDate, values.endDate);
	return {
		startDate: blank(values.startDate),
		startTime: blank(values.startTime),
		startTimeZone: blank(values.startTimeZone),
		endDate: blank(values.endDate),
		endTime: blank(values.endTime),
		endTimeZone: blank(values.endTimeZone),
		// Only a trip over more than one calendar day has nights to answer for.
		overnight: days.length > 1 ? blank(values.overnight) : null,
		prolongedWorkplace: values.prolongedWorkplace,
		meals: days.map((date, index) => {
			const day = values.meals[date] ?? NO_MEALS;
			const entry = (meal: PerDiemMeal) => ({
				provided: day[meal].provided,
				employeePayment: day[meal].provided ? blank(day[meal].payment) : null,
			});
			// Only the location questions this day asks (#611); stale answers are dropped.
			const location = dayLocationDraft(values.locations?.[date]);
			const asked = perDiemLocationFields(index, days.length, location);
			return {
				date,
				breakfast: entry("breakfast"),
				lunch: entry("lunch"),
				dinner: entry("dinner"),
				...(asked.includes("night") && location.night ? { night: location.night } : {}),
				...(asked.includes("activityAbroad") && location.activityAbroad
					? { activityAbroad: location.activityAbroad }
					: {}),
			};
		}),
	};
}

function fieldErrorMessage(t: Translate, code: string | undefined) {
	switch (code) {
		case undefined:
			return undefined;
		case "invalid_date":
			return t("travelExpenses.report.errors.expenseDate", "Enter a valid date.");
		case "invalid_time":
			return t("travelExpenses.report.perDiem.errors.time", "Enter a time as hours and minutes.");
		case "invalid_time_zone":
			return t("travelExpenses.report.trip.errors.timeZone", "Choose a listed time zone.");
		case "nonexistent_local_time":
			return t(
				"travelExpenses.report.perDiem.errors.clockChange",
				"This time does not exist on this day because the clocks are put forward. Enter a time outside the skipped hour.",
			);
		case "ambiguous_local_time":
			return t(
				"travelExpenses.report.perDiem.errors.clockChangeRepeated",
				"This time occurs twice on this day because the clocks are put back. Enter a time outside the repeated hour.",
			);
		case "end_before_start":
			return t(
				"travelExpenses.report.perDiem.errors.endBeforeStart",
				"Your return must be after your departure.",
			);
		case "invalid_location":
			return t(
				"travelExpenses.report.perDiem.errors.location",
				"Choose a listed location for each day.",
			);
		case "invalid_payment":
			return t(
				"travelExpenses.report.perDiem.errors.payment",
				"Enter what you paid as an amount with at most two decimals, e.g. 2.50.",
			);
		default:
			return t("travelExpenses.report.perDiem.errors.meals", "Check the meal entries.");
	}
}

export function perDiemRequirementLabel(
	t: Translate,
	requirement: PerDiemRequirement,
	context: { locale: string; calculation: PerDiemCalculation | null; currency: string },
) {
	switch (requirement) {
		case "per_diem_start":
			return t(
				"travelExpenses.report.perDiem.requirements.start",
				"Enter when you left home or your workplace.",
			);
		case "per_diem_end":
			return t(
				"travelExpenses.report.perDiem.requirements.end",
				"Enter when you were back home or at your workplace.",
			);
		case "per_diem_overnight":
			return t(
				"travelExpenses.report.perDiem.requirements.overnight",
				"Tell us whether you stayed overnight away from home.",
			);
		case "per_diem_trip_dates":
			return t(
				"travelExpenses.report.perDiem.requirements.tripDates",
				"Your departure and return days must be the trip's first and last travel day.",
			);
		case "per_diem_meals":
			return t(
				"travelExpenses.report.perDiem.requirements.meals",
				"Confirm the provided meals for every travel day.",
			);
		case "per_diem_locations":
			return t(
				"travelExpenses.report.perDiem.requirements.locations",
				"Tell us for every travel day where you were at midnight and where your last business activity abroad was.",
			);
		case "per_diem_exceptional":
			return t(
				"travelExpenses.report.perDiem.requirements.exceptional",
				"This itinerary needs a manual per diem calculation by an expense administrator. It is not calculated automatically.",
			);
		case "per_diem_policy_missing": {
			const missing =
				context.calculation?.status === "policy_missing" ? context.calculation.dates : [];
			return t(
				"travelExpenses.report.perDiem.requirements.policyMissing",
				"Your organization has no per diem rates for {dates}. Ask an expense administrator to add dated rates in the travel expense settings. Nothing is calculated until then.",
				{ dates: missing.map((date) => formatPlainDate(context.locale, date)).join(", ") },
			);
		}
		case "per_diem_currency":
			return t(
				"travelExpenses.report.perDiem.requirements.currency",
				"The per diem rates for these days are in {policyCurrency}, but this report is reimbursed in {currency}. Ask an expense administrator to add rates in {currency}.",
				{
					policyCurrency:
						context.calculation?.status === "currency_mismatch"
							? context.calculation.policyCurrency
							: "",
					currency: context.currency,
				},
			);
		default:
			return requirement;
	}
}

/**
 * Autosaving editor of the trip's per diem (#609). The employee enters when
 * they left and came back (local date, time and zone), whether they stayed
 * overnight, and the meals provided on each travel day; the allowance is
 * always the server's daily calculation with the organization's dated rates.
 */
export function PerDiemItemEditor({
	reportId,
	item,
	reimbursementCurrency,
	trip,
	onSaved,
	onDraftChange,
	removal,
}: {
	reportId: string;
	/** The item as last loaded; later loads never reset entered values. */
	item: ReportItemView;
	reimbursementCurrency: string;
	/** The trip's travel dates as entered; the itinerary must match them. */
	trip: {
		startDate: string | null;
		endDate: string | null;
		timeZone: string;
		/** The trip's destinations; one abroad asks for daily locations (#611). */
		destinations?: readonly TripDestination[];
	};
	onSaved?: (item: ReportItemView) => void;
	onDraftChange?: (draft: PerDiemItinerary | null) => void;
	removal?: { label: string; remove: (expectedVersion: number) => Promise<boolean> };
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [removing, setRemoving] = useState(false);
	const [saved, setSaved] = useState(item);

	const { saver, state } = useDraftSaver<PerDiemDraftInput, ReportItemView>({
		version: item.version,
		onUnsavedAfterClose: () =>
			toast.error(
				t(
					"travelExpenses.report.save.unsavedAfterClose",
					"Your latest changes to an expense could not be saved. Open it again to check it.",
				),
			),
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<ReportItemView>> => {
			const parsed = parsePerDiemDraft(values);
			if (!parsed.ok) return { status: "invalid", errors: parsed.errors };
			const result = await savePerDiemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion,
				values,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					setSaved(result.data.item);
					onSaved?.(result.data.item);
					return { status: "saved", version: result.data.item.version };
				case "conflict":
					return { status: "conflict", version: result.data.item.version, item: result.data.item };
				case "invalid":
					return { status: "invalid", errors: result.data.errors };
			}
		},
	});

	const [defaultValues] = useState(() => {
		const values = toFormValues(perDiemDraftOf(item));
		// A new per diem starts on the trip's travel days and in its zone.
		return {
			...values,
			startDate: values.startDate || (trip.startDate ?? ""),
			endDate: values.endDate || (trip.endDate ?? ""),
			startTimeZone: values.startTimeZone || trip.timeZone,
			endTimeZone: values.endTimeZone || trip.timeZone,
		};
	});
	const form = useForm({
		defaultValues,
		listeners: {
			onChange: ({ formApi }) => {
				const values = toDraftInput(formApi.state.values);
				saver.change(values);
				const parsed = parsePerDiemDraft(values);
				onDraftChange?.(parsed.ok ? parsed.itinerary : null);
			},
		},
	});

	// A reload (e.g. after the trip's destinations changed) recalculates the same version.
	useEffect(() => {
		setSaved((current) => (item.version >= current.version ? item : current));
	}, [item]);

	// A new per diem is prefilled with the trip's days and zone: save that right away.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the first load
	useEffect(() => {
		const prefilled = toDraftInput(defaultValues);
		const parsed = parsePerDiemDraft(prefilled);
		if (parsed.ok && !perDiemDraftMatches(parsed.itinerary, item)) {
			saver.change(prefilled);
			onDraftChange?.(parsed.itinerary);
		}
	}, []);

	async function remove() {
		if (!removal) return;
		setRemoving(true);
		try {
			await saver.flush();
			if (await removal.remove(saver.getState().version)) saver.discard();
		} finally {
			setRemoving(false);
		}
	}

	const fieldError = (field: PerDiemDraftField) =>
		state.status === "invalid"
			? fieldErrorMessage(t, state.fieldErrors?.[field] as string | undefined)
			: undefined;

	const timeField = (
		dateName: "startDate" | "endDate",
		timeName: "startTime" | "endTime",
		zoneName: "startTimeZone" | "endTimeZone",
		labels: { date: string; time: string; zone: string },
	) => (
		<div className="grid gap-4 sm:grid-cols-3">
			<form.Field name={dateName}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!fieldError(dateName)}>{labels.date}</TFormLabel>
						<TFormControl hasError={!!fieldError(dateName)}>
							<DatePicker
								name={dateName}
								value={field.state.value}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage>{fieldError(dateName)}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name={timeName}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!fieldError(timeName)}>{labels.time}</TFormLabel>
						<TFormControl hasError={!!fieldError(timeName)}>
							<Input
								name={timeName}
								type="time"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage>{fieldError(timeName)}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name={zoneName}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!fieldError(zoneName)}>{labels.zone}</TFormLabel>
						<TFormControl hasError={!!fieldError(zoneName)}>
							<TimezonePicker value={field.state.value} onChange={field.handleChange} />
						</TFormControl>
						<TFormMessage>{fieldError(zoneName)}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
		</div>
	);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<DraftSaveStatus
						state={state}
						onRetry={() => saver.retry()}
						onKeepMine={() => saver.resolveConflict("keep_mine")}
						onUseTheirs={() => {
							const theirs = state.conflict?.item;
							saver.resolveConflict("use_theirs");
							if (theirs) {
								setSaved(theirs);
								form.reset(toFormValues(perDiemDraftOf(theirs)), { keepDefaultValues: true });
								onDraftChange?.(perDiemDraftOf(theirs));
							}
						}}
					/>
				</div>
				{removal && (
					<RemoveExpenseButton
						label={removal.label}
						busy={removing}
						onConfirm={() => void remove()}
					/>
				)}
			</div>

			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void saver.flush();
				}}
				className="grid gap-6"
			>
				<fieldset className="space-y-2">
					<legend className="text-sm font-semibold">
						{t("travelExpenses.report.perDiem.departure", "Departure")}
					</legend>
					{timeField("startDate", "startTime", "startTimeZone", {
						date: t("travelExpenses.report.perDiem.fields.startDate", "Day you left"),
						time: t("travelExpenses.report.perDiem.fields.startTime", "Time you left home or work"),
						zone: t("travelExpenses.report.perDiem.fields.timeZone", "Time zone"),
					})}
				</fieldset>
				<fieldset className="space-y-2">
					<legend className="text-sm font-semibold">
						{t("travelExpenses.report.perDiem.return", "Return")}
					</legend>
					{timeField("endDate", "endTime", "endTimeZone", {
						date: t("travelExpenses.report.perDiem.fields.endDate", "Day you came back"),
						time: t(
							"travelExpenses.report.perDiem.fields.endTime",
							"Time you were back home or at work",
						),
						zone: t("travelExpenses.report.perDiem.fields.timeZone", "Time zone"),
					})}
				</fieldset>

				<form.Subscribe
					selector={(formState) => [formState.values.startDate, formState.values.endDate]}
				>
					{([startDate = "", endDate = ""]) =>
						travelDays(startDate, endDate).length > 1 && (
							<form.Field name="overnight">
								{(field) => (
									<TFormItem>
										<RadioGroup
											aria-label={t(
												"travelExpenses.report.perDiem.fields.overnight",
												"Nights during the trip",
											)}
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value)}
											className="gap-2"
										>
											<p
												className="text-sm font-medium data-[error=true]:text-destructive"
												data-error={!!fieldError("overnight")}
											>
												{t(
													"travelExpenses.report.perDiem.fields.overnight",
													"Nights during the trip",
												)}
											</p>
											<Label className="flex items-center gap-2 font-normal">
												<RadioGroupItem value="away" />
												{t(
													"travelExpenses.report.perDiem.overnight.away",
													"I stayed overnight away from home every night",
												)}
											</Label>
											<Label className="flex items-center gap-2 font-normal">
												<RadioGroupItem value="none" />
												{t(
													"travelExpenses.report.perDiem.overnight.none",
													"I worked through the night without an overnight stay",
												)}
											</Label>
											<Label className="flex items-center gap-2 font-normal">
												<RadioGroupItem value="mixed" />
												{t(
													"travelExpenses.report.perDiem.overnight.mixed",
													"I spent some nights at home",
												)}
											</Label>
										</RadioGroup>
										<TFormMessage>{fieldError("overnight")}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
						)
					}
				</form.Subscribe>

				<form.Field name="prolongedWorkplace">
					{(field) => (
						<TFormItem>
							<Label className="flex items-start gap-2 font-normal">
								<Checkbox
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked === true)}
									className="mt-0.5"
								/>
								<span>
									{t(
										"travelExpenses.report.perDiem.fields.prolongedWorkplace",
										"I have been working at this same place for more than three months",
									)}
								</span>
							</Label>
							<TFormDescription>
								{t(
									"travelExpenses.report.perDiem.fields.prolongedWorkplaceDescription",
									"Per diem only applies to the first three months at the same workplace; such trips need a manual calculation.",
								)}
							</TFormDescription>
						</TFormItem>
					)}
				</form.Field>

				<form.Subscribe
					selector={(formState) => [formState.values.startDate, formState.values.endDate]}
				>
					{([startDate = "", endDate = ""]) => {
						const days = travelDays(startDate, endDate);
						return (
							<fieldset className="space-y-3">
								<legend className="text-sm font-semibold">
									{t(
										"travelExpenses.report.perDiem.fields.meals",
										"Meals provided by your employer",
									)}
								</legend>
								<p className="text-sm text-muted-foreground">
									{t(
										"travelExpenses.report.perDiem.fields.mealsDescription",
										"Tick each meal your employer, or a hotel or host on its behalf, provided, even if you skipped it. Enter what you paid for it, if anything.",
									)}
								</p>
								{days.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.report.perDiem.fields.mealsNeedDates",
											"Enter the departure and return days to list the travel days.",
										)}
									</p>
								) : (
									<form.Field name="meals">
										{(field) => (
											<ul className="space-y-3">
												{days.map((date) => {
													const day = field.state.value[date] ?? NO_MEALS;
													const update = (meal: PerDiemMeal, next: Partial<MealForm>) =>
														field.handleChange({
															...field.state.value,
															[date]: { ...day, [meal]: { ...day[meal], ...next } },
														});
													return (
														<li key={date} className="rounded-lg border p-3">
															<p className="mb-2 text-sm font-medium">
																{formatPlainDate(locale, date)}
															</p>
															{/* Daily locations of a trip abroad (#611). */}
															<form.Field name="locations">
																{(locationsField) => {
																	const all = locationsField.state.value ?? {};
																	const needed = perDiemLocationsNeeded(
																		days.map((other) => dayLocationDraft(all[other])),
																		trip.destinations ?? [],
																	);
																	if (!needed) return null;
																	const index = days.indexOf(date);
																	return (
																		<PerDiemDayLocationFields
																			id={`${item.id}-${date}`}
																			index={index}
																			count={days.length}
																			value={all[date] ?? NO_LOCATION}
																			previousNight={all[days[index - 1] ?? ""]?.night ?? ""}
																			onChange={(next) =>
																				locationsField.handleChange({ ...all, [date]: next })
																			}
																		/>
																	);
																}}
															</form.Field>
															<div className="grid gap-3 sm:grid-cols-3">
																{PER_DIEM_MEALS.map((meal) => (
																	<div key={meal} className="space-y-1">
																		<Label className="flex items-center gap-2 font-normal">
																			<Checkbox
																				checked={day[meal].provided}
																				onCheckedChange={(checked) =>
																					update(meal, { provided: checked === true })
																				}
																			/>
																			{mealLabel(t, meal)}
																		</Label>
																		{day[meal].provided && (
																			<Input
																				aria-label={t(
																					"travelExpenses.report.perDiem.fields.payment",
																					"What you paid for {meal} on {date}",
																					{
																						meal: mealLabel(t, meal),
																						date: formatPlainDate(locale, date),
																					},
																				)}
																				placeholder={t(
																					"travelExpenses.report.perDiem.fields.paymentPlaceholder",
																					"You paid (optional)",
																				)}
																				inputMode="decimal"
																				autoComplete="off"
																				value={day[meal].payment}
																				onChange={(event) =>
																					update(meal, { payment: event.target.value })
																				}
																			/>
																		)}
																	</div>
																))}
															</div>
														</li>
													);
												})}
											</ul>
										)}
									</form.Field>
								)}
								<TFormMessage>{fieldError("meals")}</TFormMessage>
							</fieldset>
						);
					}}
				</form.Subscribe>
			</form>

			<form.Subscribe selector={(formState) => formState.values}>
				{(values) => {
					const parsed = parsePerDiemDraft(toDraftInput(values));
					const draft = parsed.ok ? parsed.itinerary : null;
					const matches = draft !== null && perDiemDraftMatches(draft, saved);
					const calculation = matches ? (saved.perDiem?.calculation ?? null) : null;
					// An administrator's override (#610) applies to the saved facts only.
					const override = matches ? (saved.perDiem?.override ?? null) : null;
					const missing = draft
						? withoutOverriddenRequirements(
								perDiemMissingRequirements(draft, calculation ?? { status: "incomplete" }, trip),
								override,
							)
						: null;
					return (
						<div className="space-y-4">
							{override && (
								<AllowanceOverrideNotice
									override={override}
									ordinary={calculation?.status === "calculated" ? calculation : null}
								/>
							)}
							<PerDiemCalculationPanel
								id={item.id}
								calculation={calculation}
								pending={draft !== null && !matches}
								currency={reimbursementCurrency}
							/>
							<section
								aria-labelledby={`${item.id}-requirements`}
								className="space-y-2 rounded-lg border p-4"
							>
								<h3 id={`${item.id}-requirements`} className="text-base font-semibold">
									{t("travelExpenses.report.requirements.title", "Still needed")}
								</h3>
								{missing === null ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.report.requirements.fixFields",
											"Correct the highlighted fields first.",
										)}
									</p>
								) : missing.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.report.requirements.complete",
											"Everything for this expense is entered.",
										)}
									</p>
								) : (
									<ul className="list-disc space-y-1 pl-5 text-sm">
										{missing.map((requirement) => (
											<li key={requirement}>
												{perDiemRequirementLabel(t, requirement, {
													locale,
													calculation,
													currency: reimbursementCurrency,
												})}
											</li>
										))}
									</ul>
								)}
							</section>
						</div>
					);
				}}
			</form.Subscribe>
		</div>
	);
}

/** The server's daily calculation of the saved entries, or why there is none. */
function PerDiemCalculationPanel({
	id,
	calculation,
	pending,
	currency,
}: {
	id: string;
	calculation: PerDiemCalculation | null;
	pending: boolean;
	currency: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const headingId = `${id}-per-diem-calculation`;
	return (
		<section
			aria-labelledby={headingId}
			aria-live="polite"
			className="space-y-2 rounded-lg border p-4"
		>
			<h3 id={headingId} className="text-base font-semibold">
				{t("travelExpenses.report.perDiem.calculationTitle", "Calculated per diem")}
			</h3>
			{pending ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.perDiem.pending",
						"Calculated with your organization's dated rates once your changes are saved.",
					)}
				</p>
			) : calculation?.status === "calculated" ? (
				<PerDiemBreakdown facts={calculation} />
			) : calculation?.status === "exceptional" ? (
				<Alert>
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>
						{t("travelExpenses.report.perDiem.exceptionalTitle", "Needs a manual calculation")}
					</AlertTitle>
					<AlertDescription>
						<ul className="list-disc space-y-1 pl-5">
							{calculation.reasons.map((reason) => (
								<li key={reason}>
									{perDiemExceptionLabel(t, reason)}
									{reason === "overlapping_days" &&
										` (${calculation.overlappingDays
											.map((date) => formatPlainDate(locale, date))
											.join(", ")})`}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : calculation?.status === "policy_missing" ||
				calculation?.status === "currency_mismatch" ? (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>
						{t("travelExpenses.report.perDiem.noRateTitle", "No per diem rate applies")}
					</AlertTitle>
					<AlertDescription>
						{calculation.status === "policy_missing"
							? t(
									"travelExpenses.report.perDiem.noRate",
									"No rate is invented: this expense stays in draft until an expense administrator adds per diem rates covering its days.",
								)
							: t(
									"travelExpenses.report.perDiem.otherCurrency",
									"The rates for these days are not in {currency}; per diem is never converted.",
									{ currency },
								)}
					</AlertDescription>
				</Alert>
			) : (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.perDiem.enterFacts",
						"Enter your departure, return and meals to see the daily allowances.",
					)}
				</p>
			)}
		</section>
	);
}
