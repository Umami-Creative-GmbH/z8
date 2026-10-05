"use client";

import { IconMapPin, IconPlus, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { saveTripDetailsDraftAction } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import type { TripDetailsView } from "@/lib/travel-expenses/report-store";
import {
	MAX_DESTINATION_PLACE_LENGTH,
	MAX_TRIP_DESTINATIONS,
	MAX_TRIP_PURPOSE_LENGTH,
	parseTripDetailsDraft,
	TRIP_COUNTRY_CODES,
	type TripDetailsDraft,
	type TripDetailsDraftInput,
	type TripDetailsFieldError,
} from "@/lib/travel-expenses/trip-report";
import { DraftSaveStatus } from "./draft-save-status";
import { formatCountry, formatPlainDateRange } from "./format";
import { useDraftSaver } from "./use-draft-saver";

type Translate = ReturnType<typeof useTranslate>["t"];
type FieldName = keyof TripDetailsDraft;
interface FormValues {
	purpose: string;
	startDate: string;
	endDate: string;
	timeZone: string;
	destinations: { place: string; countryCode: string }[];
}

function toFormValues(details: TripDetailsDraft): FormValues {
	return {
		purpose: details.purpose ?? "",
		startDate: details.startDate ?? "",
		endDate: details.endDate ?? "",
		timeZone: details.timeZone,
		destinations: details.destinations.map((destination) => ({
			place: destination.place ?? "",
			countryCode: destination.countryCode ?? "",
		})),
	};
}

function blankToNull(value: string) {
	return value.trim() === "" ? null : value;
}

function toDraftInput(values: FormValues): TripDetailsDraftInput {
	return {
		purpose: blankToNull(values.purpose),
		startDate: blankToNull(values.startDate),
		endDate: blankToNull(values.endDate),
		timeZone: blankToNull(values.timeZone),
		destinations: values.destinations.map((destination) => ({
			place: blankToNull(destination.place),
			countryCode: blankToNull(destination.countryCode),
		})),
	};
}

/** Replaces malformed fields with their last saved values. */
function withSavedValues(
	values: TripDetailsDraftInput,
	errors: Partial<Record<FieldName, TripDetailsFieldError>>,
	saved: TripDetailsDraftInput,
): TripDetailsDraftInput {
	const merged = { ...values };
	for (const field of Object.keys(errors) as FieldName[]) {
		// A return before departure is restored together with its departure.
		if (errors[field] === "end_before_start") merged.startDate = saved.startDate;
		Object.assign(merged, { [field]: saved[field] });
	}
	return merged;
}

function fieldErrorMessage(t: Translate, code: string | undefined) {
	switch (code) {
		case undefined:
			return undefined;
		case "invalid_date":
			return t("travelExpenses.report.errors.expenseDate", "Enter a valid date.");
		case "end_before_start":
			return t(
				"travelExpenses.report.trip.errors.endBeforeStart",
				"The last travel day cannot be before the first.",
			);
		case "invalid_time_zone":
			return t("travelExpenses.report.trip.errors.timeZone", "Choose a listed time zone.");
		case "invalid_destination":
			return t("travelExpenses.report.trip.errors.destination", "Choose a listed country.");
		case "too_many_destinations":
			return t(
				"travelExpenses.report.trip.errors.tooManyDestinations",
				"Enter at most {max} destinations.",
				{ max: MAX_TRIP_DESTINATIONS },
			);
		default:
			return t("travelExpenses.report.errors.tooLong", "This text is too long.");
	}
}

/** Autosaving editor of the travel details all expenses of a trip share. */
export function TripDetailsEditor({
	reportId,
	details,
	onDetailsChange,
	onSaved,
}: {
	reportId: string;
	/** The details as last loaded; later loads never reset entered values. */
	details: TripDetailsView;
	/** The entered details as they change; null while any of them is malformed. */
	onDetailsChange: (details: TripDetailsDraft | null) => void;
	onSaved?: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const lastSaved = useRef<TripDetailsDraftInput>(toDraftInput(toFormValues(details)));
	const [focusDestination, setFocusDestination] = useState<number | null>(null);

	const { saver, state } = useDraftSaver<TripDetailsDraftInput, TripDetailsView>({
		version: details.version,
		onUnsavedAfterClose: () =>
			toast.error(
				t(
					"travelExpenses.report.trip.unsavedAfterClose",
					"Your latest changes to the trip details could not be saved. Open the trip again to check them.",
				),
			),
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<TripDetailsView>> => {
			const parsed = parseTripDetailsDraft(values);
			const errors = parsed.ok ? null : parsed.errors;
			const saveable = errors ? withSavedValues(values, errors, lastSaved.current) : values;
			if (errors && !parseTripDetailsDraft(saveable).ok) return { status: "invalid", errors };
			const result = await saveTripDetailsDraftAction({
				reportId,
				expectedVersion,
				values: saveable,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					lastSaved.current = toDraftInput(toFormValues(result.data.details));
					onSaved?.();
					return errors
						? { status: "invalid", errors, version: result.data.details.version }
						: { status: "saved", version: result.data.details.version };
				case "conflict":
					return {
						status: "conflict",
						version: result.data.details.version,
						item: result.data.details,
					};
				case "invalid":
					return { status: "invalid", errors: result.data.errors };
			}
		},
	});

	const [defaultValues] = useState(() => toFormValues(details));
	const form = useForm({
		defaultValues,
		listeners: { onChange: () => changed() },
	});

	function changed() {
		const values = toDraftInput(form.state.values);
		saver.change(values);
		const parsed = parseTripDetailsDraft(values);
		onDetailsChange(parsed.ok ? parsed.draft : null);
	}

	useEffect(() => {
		if (focusDestination === null) return;
		document.getElementById(`${reportId}-destination-${focusDestination}-place`)?.focus();
		setFocusDestination(null);
	}, [focusDestination, reportId]);

	const countries = useMemo(
		() =>
			TRIP_COUNTRY_CODES.map((code) => ({ code, name: formatCountry(locale, code) })).sort(
				(left, right) => left.name.localeCompare(right.name, locale),
			),
		[locale],
	);

	const fieldError = (field: FieldName) =>
		state.status === "invalid" ? fieldErrorMessage(t, state.fieldErrors?.[field]) : undefined;

	return (
		<section aria-labelledby={`${reportId}-trip`} className="space-y-4">
			<div className="space-y-1">
				<h2 id={`${reportId}-trip`} className="text-lg font-semibold">
					{t("travelExpenses.report.trip.title", "Trip details")}
				</h2>
				<form.Subscribe selector={(formState) => formState.values}>
					{(values) => {
						const range = formatPlainDateRange(
							locale,
							values.startDate || null,
							values.endDate || null,
						);
						return range ? <p className="text-sm text-muted-foreground">{range}</p> : null;
					}}
				</form.Subscribe>
			</div>

			<DraftSaveStatus
				state={state}
				onRetry={() => saver.retry()}
				onKeepMine={() => saver.resolveConflict("keep_mine")}
				onUseTheirs={() => {
					const theirs = state.conflict?.item;
					saver.resolveConflict("use_theirs");
					if (theirs) {
						lastSaved.current = toDraftInput(toFormValues(theirs));
						form.reset(toFormValues(theirs), { keepDefaultValues: true });
						onDetailsChange(theirs);
					}
				}}
			/>

			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void saver.flush();
				}}
				className="grid gap-4"
			>
				<form.Field name="purpose">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("purpose")}>
								{t("travelExpenses.report.trip.fields.purpose", "Purpose of the trip")}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("purpose")}>
								<Input
									name="purpose"
									autoComplete="off"
									maxLength={MAX_TRIP_PURPOSE_LENGTH}
									placeholder={t(
										"travelExpenses.report.trip.fields.purposePlaceholder",
										"e.g. Customer workshop in Hamburg",
									)}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{fieldError("purpose")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>

				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="startDate">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!fieldError("startDate")}>
									{t("travelExpenses.report.trip.fields.startDate", "First travel day")}
								</TFormLabel>
								<TFormControl hasError={!!fieldError("startDate")}>
									<DatePicker
										name="startDate"
										value={field.state.value}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{fieldError("startDate")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
					<form.Subscribe selector={(formState) => formState.values.startDate}>
						{(startDate) => (
							<form.Field name="endDate">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={!!fieldError("endDate")}>
											{t("travelExpenses.report.trip.fields.endDate", "Last travel day")}
										</TFormLabel>
										<TFormControl hasError={!!fieldError("endDate")}>
											<DatePicker
												name="endDate"
												min={startDate || undefined}
												value={field.state.value}
												onChange={field.handleChange}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage>{fieldError("endDate")}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
						)}
					</form.Subscribe>
				</div>

				<form.Field name="timeZone">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("timeZone")}>
								{t("travelExpenses.report.trip.fields.timeZone", "Time zone of the travel dates")}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("timeZone")}>
								<TimezonePicker value={field.state.value} onChange={field.handleChange} />
							</TFormControl>
							<TFormDescription>
								{t(
									"travelExpenses.report.trip.fields.timeZoneDescription",
									"Travel dates are calendar days in {timeZone}. Reviewers see the same dates, wherever they are.",
									{ timeZone: field.state.value },
								)}
							</TFormDescription>
							<TFormMessage>{fieldError("timeZone")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>

				<form.Field name="destinations" mode="array">
					{(destinationsField) => (
						<fieldset className="space-y-3">
							<legend className="text-sm font-medium">
								{t("travelExpenses.report.trip.fields.destinations", "Destinations")}
							</legend>
							{destinationsField.state.value.length === 0 && (
								<p className="text-sm text-muted-foreground">
									{t(
										"travelExpenses.report.trip.fields.noDestinations",
										"Add the places you are traveling to.",
									)}
								</p>
							)}
							<ul className="space-y-3">
								{destinationsField.state.value.map((_destination, index) => {
									const number = index + 1;
									return (
										// Rows have no identity of their own; their order is their meaning.
										// biome-ignore lint/suspicious/noArrayIndexKey: see above
										<li key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
											<form.Field name={`destinations[${index}].place`}>
												{(field) => (
													<Input
														id={`${reportId}-destination-${index}-place`}
														aria-label={t(
															"travelExpenses.report.trip.fields.place",
															"Place {number}",
															{ number },
														)}
														autoComplete="off"
														maxLength={MAX_DESTINATION_PLACE_LENGTH}
														placeholder={t(
															"travelExpenses.report.trip.fields.placePlaceholder",
															"City or place",
														)}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
													/>
												)}
											</form.Field>
											<form.Field name={`destinations[${index}].countryCode`}>
												{(field) => (
													<Select
														value={field.state.value || null}
														onValueChange={(value) => field.handleChange(value ?? "")}
													>
														<SelectTrigger
															className="w-full"
															aria-label={t(
																"travelExpenses.report.trip.fields.country",
																"Country {number}",
																{ number },
															)}
														>
															<SelectValue
																placeholder={t(
																	"travelExpenses.report.trip.fields.countryPlaceholder",
																	"Country",
																)}
															/>
														</SelectTrigger>
														<SelectContent>
															{countries.map((country) => (
																<SelectItem key={country.code} value={country.code}>
																	{country.name}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												)}
											</form.Field>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												aria-label={t(
													"travelExpenses.report.trip.fields.removeDestination",
													"Remove destination {number}",
													{ number },
												)}
												onClick={() => {
													destinationsField.removeValue(index);
													changed();
												}}
											>
												<IconX aria-hidden="true" className="size-4" />
											</Button>
										</li>
									);
								})}
							</ul>
							<TFormMessage>{fieldError("destinations")}</TFormMessage>
							{destinationsField.state.value.length < MAX_TRIP_DESTINATIONS && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										const index = destinationsField.state.value.length;
										destinationsField.pushValue({ place: "", countryCode: "" });
										setFocusDestination(index);
									}}
								>
									{destinationsField.state.value.length === 0 ? (
										<IconMapPin aria-hidden="true" className="mr-2 size-4" />
									) : (
										<IconPlus aria-hidden="true" className="mr-2 size-4" />
									)}
									{t("travelExpenses.report.trip.fields.addDestination", "Add destination")}
								</Button>
							)}
						</fieldset>
					)}
				</form.Field>
			</form>
		</section>
	);
}
