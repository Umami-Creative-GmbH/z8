"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { PerDiemDayLocation } from "@/lib/travel-expenses/per-diem";
import {
	decodePerDiemLocation,
	encodePerDiemLocation,
	isDomesticLocation,
	listedPlaces,
	type PerDiemSpecialLocation,
	perDiemLocationFields,
} from "@/lib/travel-expenses/per-diem-location";
import {
	perDiemLocationName,
	perDiemPlaceName,
} from "@/lib/travel-expenses/per-diem-location-name";
import { TRIP_COUNTRY_CODES } from "@/lib/travel-expenses/trip-report";
import { formatCountry } from "./format";
import { type DayLocationForm, dayLocationDraft } from "./per-diem-day-location-form";

type Translate = ReturnType<typeof useTranslate>["t"];

function specialLabel(t: Translate, special: PerDiemSpecialLocation) {
	switch (special) {
		case "in_flight":
			return t(
				"travelExpenses.report.perDiem.location.inFlight",
				"In flight all day (between take-off day and landing day)",
			);
		case "at_sea":
			return t(
				"travelExpenses.report.perDiem.location.atSea",
				"On board a ship all day (not embarking or disembarking)",
			);
		case "other":
			return t(
				"travelExpenses.report.perDiem.location.other",
				"Something else (needs a manual calculation)",
			);
	}
}

const ELSEWHERE = "__elsewhere";

/** One location answer: a country (or special situation) and, where listed, the place. */
function LocationSelect({
	id,
	label,
	value,
	onChange,
	countries,
	specials,
	noneLabel,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	countries: { code: string; name: string }[];
	specials: readonly PerDiemSpecialLocation[];
	/** For "last activity abroad": the label of Germany, meaning none abroad. */
	noneLabel?: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const location = decodePerDiemLocation(value);
	const country = location && "country" in location ? location.country : null;
	const places = country ? listedPlaces(country) : [];
	const countryValue = !location
		? null
		: "special" in location
			? `special:${location.special}`
			: location.country;
	return (
		<div className="space-y-1">
			<Label id={`${id}-label`} className="font-normal">
				{label}
			</Label>
			<div className="grid gap-2 sm:grid-cols-2">
				<Select value={countryValue} onValueChange={(next) => onChange(next ?? "")}>
					<SelectTrigger className="w-full" aria-labelledby={`${id}-label`}>
						<SelectValue
							placeholder={t("travelExpenses.report.perDiem.location.choose", "Choose a location")}
						/>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="DE">
							{noneLabel ?? t("travelExpenses.report.perDiem.location.germany", "Germany")}
						</SelectItem>
						{countries.map((entry) => (
							<SelectItem key={entry.code} value={entry.code}>
								{entry.name}
							</SelectItem>
						))}
						{specials.map((special) => (
							<SelectItem key={special} value={`special:${special}`}>
								{specialLabel(t, special)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{country && places.length > 0 && (
					<Select
						value={location && "country" in location ? (location.place ?? ELSEWHERE) : ELSEWHERE}
						onValueChange={(next) =>
							onChange(
								encodePerDiemLocation({
									country,
									place: next && next !== ELSEWHERE ? next : null,
								}),
							)
						}
					>
						<SelectTrigger
							className="w-full"
							aria-label={t("travelExpenses.report.perDiem.location.place", "Place in {country}", {
								country: formatCountry(locale, country),
							})}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ELSEWHERE}>
								{t("travelExpenses.report.perDiem.location.elsewhere", "Anywhere else")}
							</SelectItem>
							{places.map((place) => (
								<SelectItem key={place.key} value={place.key}>
									{perDiemPlaceName(country, place, locale, t)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>
		</div>
	);
}

/**
 * The location questions of one travel day of a trip abroad (#611), as
 * § 9 Abs. 4a Satz 5 EStG and Rz. 52 need them: where the employee was at
 * midnight, and the last place of business activity abroad when that place
 * is in Germany, on a single day, or on the way home.
 */
export function PerDiemDayLocationFields({
	id,
	index,
	count,
	value,
	previousNight,
	onChange,
}: {
	id: string;
	index: number;
	count: number;
	value: DayLocationForm;
	/** The previous day's midnight answer, which decides the last day's question. */
	previousNight: string;
	onChange: (next: DayLocationForm) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const countries = useMemo(
		() =>
			TRIP_COUNTRY_CODES.filter((code) => code !== "DE")
				.map((code) => ({ code, name: formatCountry(locale, code) }))
				.sort((left, right) => left.name.localeCompare(right.name, locale)),
		[locale],
	);
	const fields = perDiemLocationFields(index, count, dayLocationDraft(value));
	const interior = index > 0 && index < count - 1;
	const homeFromAbroad =
		count > 1 && index === count - 1 && !isDomesticLocation(decodePerDiemLocation(previousNight));
	return (
		<div className="mb-3 grid gap-3">
			{fields.includes("night") && (
				<LocationSelect
					id={`${id}-night`}
					label={t(
						"travelExpenses.report.perDiem.location.night",
						"Where were you at midnight? (the last place you reached before 24:00 local time; a country counts as reached when your plane lands)",
					)}
					value={value.night}
					onChange={(night) => onChange({ ...value, night })}
					countries={countries}
					specials={interior ? ["in_flight", "at_sea", "other"] : ["other"]}
				/>
			)}
			{fields.includes("activityAbroad") && (
				<LocationSelect
					id={`${id}-activity`}
					label={
						homeFromAbroad
							? t(
									"travelExpenses.report.perDiem.location.lastActivityTrip",
									"Where was your last business activity abroad on this trip?",
								)
							: t(
									"travelExpenses.report.perDiem.location.activityToday",
									"Where was your last business activity abroad on this day?",
								)
					}
					value={value.activityAbroad}
					onChange={(activityAbroad) => onChange({ ...value, activityAbroad })}
					countries={countries}
					specials={["other"]}
					noneLabel={t(
						"travelExpenses.report.perDiem.location.noActivityAbroad",
						"No business activity abroad",
					)}
				/>
			)}
		</div>
	);
}

/** The applied location of a calculated day, marking official fallbacks. */
export function PerDiemDayLocationLabel({ location }: { location: PerDiemDayLocation }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const name = perDiemLocationName(location, locale, t);
	const note = (() => {
		switch (location.rule) {
			case "luxembourg":
				return t(
					"travelExpenses.report.perDiem.location.fallbackLuxembourg",
					"Official fallback: not listed, Luxembourg amounts",
				);
			case "mother_country":
				return t(
					"travelExpenses.report.perDiem.location.fallbackMotherCountry",
					"Official fallback: territory, amounts of the mother country",
				);
			case "flight_austria":
				return t(
					"travelExpenses.report.perDiem.location.fallbackFlight",
					"Official rule: whole day in flight, Austrian amounts",
				);
			case "ship_luxembourg":
				return t(
					"travelExpenses.report.perDiem.location.fallbackShip",
					"Official rule: whole day at sea, Luxembourg amounts",
				);
			case "assigned":
				return t(
					"travelExpenses.report.perDiem.location.assigned",
					"Amounts the official notice assigns to this country",
				);
			default:
				return null;
		}
	})();
	return (
		// The official name of the notice stays at hand where it differs (#681).
		<span
			className="block font-medium"
			title={name === location.label ? undefined : location.label}
		>
			{name}
			{note && <span className="block text-xs font-normal text-muted-foreground">{note}</span>}
		</span>
	);
}
