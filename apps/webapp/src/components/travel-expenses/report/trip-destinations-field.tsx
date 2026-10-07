"use client";

import { IconMapPin, IconPlus, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TFormMessage } from "@/components/ui/tanstack-form";
import {
	MAX_DESTINATION_PLACE_LENGTH,
	MAX_TRIP_DESTINATIONS,
	TRIP_COUNTRY_CODES,
} from "@/lib/travel-expenses/trip-report";
import { formatCountry } from "./format";
import { newDestinationRow, type TripDetailsForm } from "./trip-details-form";

/** The places and countries a trip goes to, one editable row per destination. */
export function TripDestinationsField({
	form,
	reportId,
	error,
	onDestinationRemoved,
}: {
	form: TripDetailsForm;
	reportId: string;
	/** The message of malformed destinations, if any. */
	error: string | undefined;
	/** Removing a row is no field change, so the editor saves it explicitly. */
	onDestinationRemoved: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	// The destination row just added: its place input takes focus once it mounts.
	const focusDestination = useRef<number | null>(null);

	const countries = useMemo(
		() =>
			TRIP_COUNTRY_CODES.map((code) => ({ code, name: formatCountry(locale, code) })).sort(
				(left, right) => left.name.localeCompare(right.name, locale),
			),
		[locale],
	);

	return (
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
						{destinationsField.state.value.map((destination, index) => {
							const number = index + 1;
							return (
								<li key={destination.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
									<form.Field name={`destinations[${index}].place`}>
										{(field) => (
											<Input
												ref={(input) => {
													if (input && focusDestination.current === index) {
														focusDestination.current = null;
														input.focus();
													}
												}}
												id={`${reportId}-destination-${index}-place`}
												aria-label={t("travelExpenses.report.trip.fields.place", "Place {number}", {
													number,
												})}
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
											<SearchableSelect
												aria-label={t(
													"travelExpenses.report.trip.fields.country",
													"Country {number}",
													{ number },
												)}
												options={countries}
												value={field.state.value}
												onValueChange={field.handleChange}
												onOpenChange={(open) => {
													if (!open) field.handleBlur();
												}}
												placeholder={t(
													"travelExpenses.report.trip.fields.countryPlaceholder",
													"Country",
												)}
												searchPlaceholder={t(
													"travelExpenses.report.countrySearch",
													"Search countries",
												)}
												emptyText={t("travelExpenses.report.countryEmpty", "No country found")}
											/>
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
											onDestinationRemoved();
										}}
									>
										<IconX aria-hidden="true" className="size-4" />
									</Button>
								</li>
							);
						})}
					</ul>
					<TFormMessage>{error}</TFormMessage>
					{destinationsField.state.value.length < MAX_TRIP_DESTINATIONS && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								focusDestination.current = destinationsField.state.value.length;
								destinationsField.pushValue(newDestinationRow());
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
	);
}
