import { formatCountry } from "./country-name";
import type { PerDiemDayLocation } from "./per-diem";
import { listedPlaces } from "./per-diem-location";
import { foreignAreaKey } from "./statutory-foreign-per-diem";

/**
 * Per diem locations in the reader's language (#681). The BMF notice names
 * its entries in German, and those official names stay in the catalog, the
 * frozen facts and the export. German readers see them verbatim; everyone
 * else sees the country as `Intl` names it and the place by its translation
 * key. Frozen facts keep the codes, so old reports follow the reader too.
 */

/** Tolgee's translate: key, English default, interpolation values. */
export type PerDiemNameTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

/** Translation key and English name of each listed place, by area key ("FR:paris"). */
const PLACE_NAMES: Readonly<Record<string, readonly [key: string, english: string]>> = {
	"AU:canberra": ["travelExpenses.perDiemPlaces.AU.canberra", "Canberra"],
	"AU:sydney": ["travelExpenses.perDiemPlaces.AU.sydney", "Sydney"],
	"BR:brasilia": ["travelExpenses.perDiemPlaces.BR.brasilia", "Brasília"],
	"BR:rio-de-janeiro": ["travelExpenses.perDiemPlaces.BR.rio-de-janeiro", "Rio de Janeiro"],
	"BR:sao-paulo": ["travelExpenses.perDiemPlaces.BR.sao-paulo", "São Paulo"],
	"CN:hongkong": ["travelExpenses.perDiemPlaces.CN.hongkong", "Hong Kong"],
	"CN:peking": ["travelExpenses.perDiemPlaces.CN.peking", "Beijing"],
	"CN:shanghai": ["travelExpenses.perDiemPlaces.CN.shanghai", "Shanghai"],
	"FR:paris": ["travelExpenses.perDiemPlaces.FR.paris", "Paris and departments 77, 78, 91–95"],
	"GR:athen": ["travelExpenses.perDiemPlaces.GR.athen", "Athens"],
	"IN:bangalore": ["travelExpenses.perDiemPlaces.IN.bangalore", "Bengaluru"],
	"IN:chennai": ["travelExpenses.perDiemPlaces.IN.chennai", "Chennai"],
	"IN:kalkutta": ["travelExpenses.perDiemPlaces.IN.kalkutta", "Kolkata"],
	"IN:mumbai": ["travelExpenses.perDiemPlaces.IN.mumbai", "Mumbai"],
	"IN:neu-delhi": ["travelExpenses.perDiemPlaces.IN.neu-delhi", "New Delhi"],
	"IT:mailand": ["travelExpenses.perDiemPlaces.IT.mailand", "Milan"],
	"IT:rom": ["travelExpenses.perDiemPlaces.IT.rom", "Rome"],
	"JP:tokio": ["travelExpenses.perDiemPlaces.JP.tokio", "Tokyo"],
	"JP:osaka": ["travelExpenses.perDiemPlaces.JP.osaka", "Osaka"],
	"CA:ottawa": ["travelExpenses.perDiemPlaces.CA.ottawa", "Ottawa"],
	"CA:toronto": ["travelExpenses.perDiemPlaces.CA.toronto", "Toronto"],
	"CA:vancouver": ["travelExpenses.perDiemPlaces.CA.vancouver", "Vancouver"],
	"PL:breslau": ["travelExpenses.perDiemPlaces.PL.breslau", "Wrocław"],
	"PL:warschau": ["travelExpenses.perDiemPlaces.PL.warschau", "Warsaw"],
	"RU:moskau": ["travelExpenses.perDiemPlaces.RU.moskau", "Moscow"],
	"RU:st-petersburg": ["travelExpenses.perDiemPlaces.RU.st-petersburg", "Saint Petersburg"],
	"SA:djidda": ["travelExpenses.perDiemPlaces.SA.djidda", "Jeddah"],
	"SA:riad": ["travelExpenses.perDiemPlaces.SA.riad", "Riyadh"],
	"CH:bern": ["travelExpenses.perDiemPlaces.CH.bern", "Bern"],
	"CH:genf": ["travelExpenses.perDiemPlaces.CH.genf", "Geneva"],
	"ES:barcelona": ["travelExpenses.perDiemPlaces.ES.barcelona", "Barcelona"],
	"ES:kanarische-inseln": ["travelExpenses.perDiemPlaces.ES.kanarische-inseln", "Canary Islands"],
	"ES:madrid": ["travelExpenses.perDiemPlaces.ES.madrid", "Madrid"],
	"ES:palma-de-mallorca": [
		"travelExpenses.perDiemPlaces.ES.palma-de-mallorca",
		"Palma de Mallorca",
	],
	"ZA:kapstadt": ["travelExpenses.perDiemPlaces.ZA.kapstadt", "Cape Town"],
	"ZA:johannesburg": ["travelExpenses.perDiemPlaces.ZA.johannesburg", "Johannesburg"],
	"TR:ankara": ["travelExpenses.perDiemPlaces.TR.ankara", "Ankara"],
	"TR:izmir": ["travelExpenses.perDiemPlaces.TR.izmir", "Izmir"],
	"US:atlanta": ["travelExpenses.perDiemPlaces.US.atlanta", "Atlanta"],
	"US:boston": ["travelExpenses.perDiemPlaces.US.boston", "Boston"],
	"US:chicago": ["travelExpenses.perDiemPlaces.US.chicago", "Chicago"],
	"US:houston": ["travelExpenses.perDiemPlaces.US.houston", "Houston"],
	"US:los-angeles": ["travelExpenses.perDiemPlaces.US.los-angeles", "Los Angeles"],
	"US:miami": ["travelExpenses.perDiemPlaces.US.miami", "Miami"],
	"US:new-york-city": ["travelExpenses.perDiemPlaces.US.new-york-city", "New York City"],
	"US:san-francisco": ["travelExpenses.perDiemPlaces.US.san-francisco", "San Francisco"],
	"US:washington-dc": ["travelExpenses.perDiemPlaces.US.washington-dc", "Washington, D.C."],
	"GB:london": ["travelExpenses.perDiemPlaces.GB.london", "London"],
};

/** German and Swiss German readers see the official names of the notice. */
function readsOfficialNames(locale: string): boolean {
	const language = locale.split(/[-_]/)[0]?.toLowerCase();
	return language === "de" || language === "gsw";
}

/** A listed place; a place without an English name keeps its official one. */
function placeName(country: string, place: string, t: PerDiemNameTranslate): string {
	const entry = PLACE_NAMES[foreignAreaKey(country, place)];
	if (entry) return t(entry[0], entry[1]);
	return listedPlaces(country).find((listed) => listed.key === place)?.label ?? place;
}

/** A listed place of `country` ("paris"), as the place select offers it. */
export function perDiemPlaceName(
	country: string,
	place: { key: string; label: string },
	locale: string,
	t: PerDiemNameTranslate,
): string {
	if (readsOfficialNames(locale)) return place.label;
	return placeName(country, place.key, t);
}

/** The applied location of a calculated per diem day. */
export function perDiemLocationName(
	location: Pick<PerDiemDayLocation, "country" | "place" | "label">,
	locale: string,
	t: PerDiemNameTranslate,
): string {
	if (readsOfficialNames(locale)) return location.label;
	const country = formatCountry(locale, location.country);
	if (location.place) {
		return t("travelExpenses.report.perDiem.location.countryPlace", "{country} – {place}", {
			country,
			place: placeName(location.country, location.place, t),
		});
	}
	// The notice names the rest of a country with listed places "im Übrigen".
	if (listedPlaces(location.country).length > 0) {
		return t("travelExpenses.report.perDiem.location.countryElsewhere", "{country} – elsewhere", {
			country,
		});
	}
	return country;
}
