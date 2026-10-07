"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { TimezonePicker } from "@/components/settings/timezone-picker";
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
import {
	PER_DIEM_MEALS,
	type PerDiemDraftField,
	type PerDiemMeal,
} from "@/lib/travel-expenses/per-diem";
import { perDiemLocationsNeeded } from "@/lib/travel-expenses/per-diem-location";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import { formatPlainDate } from "./format";
import { PerDiemDayLocationFields } from "./per-diem-day-location";
import { dayLocationDraft, NO_LOCATION } from "./per-diem-day-location-form";
import {
	type DayMealsForm,
	type MealForm,
	NO_MEALS,
	type PerDiemItemForm,
	travelDays,
} from "./per-diem-item-form";
import { mealLabel } from "./per-diem-labels";

type FieldError = (field: PerDiemDraftField) => string | undefined;

/** The entered facts of a per diem: departure, return, nights, workplace and meals. */
export function PerDiemItemFields({
	form,
	fieldError,
	itemId,
	destinations,
}: {
	form: PerDiemItemForm;
	/** The message of a malformed field, if any. */
	fieldError: FieldError;
	itemId: string;
	/** The trip's destinations; one abroad asks for daily locations (#611). */
	destinations?: readonly TripDestination[];
}) {
	const { t } = useTranslate();
	return (
		<>
			<fieldset className="space-y-2">
				<legend className="text-sm font-semibold">
					{t("travelExpenses.report.perDiem.departure", "Departure")}
				</legend>
				<PerDiemTimeFields
					form={form}
					fieldError={fieldError}
					dateName="startDate"
					timeName="startTime"
					zoneName="startTimeZone"
					labels={{
						date: t("travelExpenses.report.perDiem.fields.startDate", "Day you left"),
						time: t("travelExpenses.report.perDiem.fields.startTime", "Time you left home or work"),
						zone: t("travelExpenses.report.perDiem.fields.timeZone", "Time zone"),
					}}
				/>
			</fieldset>
			<fieldset className="space-y-2">
				<legend className="text-sm font-semibold">
					{t("travelExpenses.report.perDiem.return", "Return")}
				</legend>
				<PerDiemTimeFields
					form={form}
					fieldError={fieldError}
					dateName="endDate"
					timeName="endTime"
					zoneName="endTimeZone"
					labels={{
						date: t("travelExpenses.report.perDiem.fields.endDate", "Day you came back"),
						time: t(
							"travelExpenses.report.perDiem.fields.endTime",
							"Time you were back home or at work",
						),
						zone: t("travelExpenses.report.perDiem.fields.timeZone", "Time zone"),
					}}
				/>
			</fieldset>

			<PerDiemOvernightField form={form} fieldError={fieldError} />

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

			<PerDiemMealsFieldset
				form={form}
				fieldError={fieldError}
				itemId={itemId}
				destinations={destinations}
			/>
		</>
	);
}

/** The local date, time and zone of the departure or the return. */
function PerDiemTimeFields({
	form,
	fieldError,
	dateName,
	timeName,
	zoneName,
	labels,
}: {
	form: PerDiemItemForm;
	fieldError: FieldError;
	dateName: "startDate" | "endDate";
	timeName: "startTime" | "endTime";
	zoneName: "startTimeZone" | "endTimeZone";
	labels: { date: string; time: string; zone: string };
}) {
	return (
		// The zone gets its own row: its labels do not fit a third column of the editor card.
		<div className="grid gap-4 sm:grid-cols-2">
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
					<TFormItem className="sm:col-span-2">
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
}

/** How the nights were spent; asked only of a trip over more than one calendar day. */
function PerDiemOvernightField({
	form,
	fieldError,
}: {
	form: PerDiemItemForm;
	fieldError: FieldError;
}) {
	const { t } = useTranslate();
	return (
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
										{t("travelExpenses.report.perDiem.fields.overnight", "Nights during the trip")}
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
	);
}

/** The meals provided on each travel day, and the daily locations of a trip abroad. */
function PerDiemMealsFieldset({
	form,
	fieldError,
	itemId,
	destinations,
}: {
	form: PerDiemItemForm;
	fieldError: FieldError;
	itemId: string;
	destinations?: readonly TripDestination[];
}) {
	const { t } = useTranslate();
	return (
		<form.Subscribe
			selector={(formState) => [formState.values.startDate, formState.values.endDate]}
		>
			{([startDate = "", endDate = ""]) => {
				const days = travelDays(startDate, endDate);
				return (
					<fieldset className="space-y-3">
						<legend className="text-sm font-semibold">
							{t("travelExpenses.report.perDiem.fields.meals", "Meals provided by your employer")}
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
							<PerDiemTravelDays
								form={form}
								days={days}
								itemId={itemId}
								destinations={destinations}
							/>
						)}
						<TFormMessage>{fieldError("meals")}</TFormMessage>
					</fieldset>
				);
			}}
		</form.Subscribe>
	);
}

/** One entry per travel day: its date, daily locations and meals. */
function PerDiemTravelDays({
	form,
	days,
	itemId,
	destinations,
}: {
	form: PerDiemItemForm;
	days: string[];
	itemId: string;
	destinations?: readonly TripDestination[];
}) {
	const locale = useLocale();
	return (
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
								<p className="mb-2 text-sm font-medium">{formatPlainDate(locale, date)}</p>
								{/* Daily locations of a trip abroad (#611). */}
								<PerDiemDayLocations
									form={form}
									days={days}
									date={date}
									itemId={itemId}
									destinations={destinations}
								/>
								<PerDiemDayMeals date={date} day={day} onChange={update} />
							</li>
						);
					})}
				</ul>
			)}
		</form.Field>
	);
}

/** The location questions of one travel day, while the trip's destinations ask for them. */
function PerDiemDayLocations({
	form,
	days,
	date,
	itemId,
	destinations,
}: {
	form: PerDiemItemForm;
	days: string[];
	date: string;
	itemId: string;
	destinations?: readonly TripDestination[];
}) {
	return (
		<form.Field name="locations">
			{(locationsField) => {
				const all = locationsField.state.value ?? {};
				const needed = perDiemLocationsNeeded(
					days.map((other) => dayLocationDraft(all[other])),
					destinations ?? [],
				);
				if (!needed) return null;
				const index = days.indexOf(date);
				return (
					<PerDiemDayLocationFields
						id={`${itemId}-${date}`}
						index={index}
						count={days.length}
						value={all[date] ?? NO_LOCATION}
						previousNight={all[days[index - 1] ?? ""]?.night ?? ""}
						onChange={(next) => locationsField.handleChange({ ...all, [date]: next })}
					/>
				);
			}}
		</form.Field>
	);
}

/** Whether each meal of one travel day was provided, and what the employee paid for it. */
function PerDiemDayMeals({
	date,
	day,
	onChange,
}: {
	date: string;
	day: DayMealsForm;
	onChange: (meal: PerDiemMeal, next: Partial<MealForm>) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<div className="grid gap-3 sm:grid-cols-3">
			{PER_DIEM_MEALS.map((meal) => (
				<div key={meal} className="space-y-1">
					<Label className="flex items-center gap-2 font-normal">
						<Checkbox
							checked={day[meal].provided}
							onCheckedChange={(checked) => onChange(meal, { provided: checked === true })}
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
							onChange={(event) => onChange(meal, { payment: event.target.value })}
						/>
					)}
				</div>
			))}
		</div>
	);
}
