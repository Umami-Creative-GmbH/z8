import AL from "country-flag-icons/react/3x2/AL";
import BA from "country-flag-icons/react/3x2/BA";
import CH from "country-flag-icons/react/3x2/CH";
import DE from "country-flag-icons/react/3x2/DE";
import ES from "country-flag-icons/react/3x2/ES";
import FR from "country-flag-icons/react/3x2/FR";
import GB from "country-flag-icons/react/3x2/GB";
import GR from "country-flag-icons/react/3x2/GR";
import HR from "country-flag-icons/react/3x2/HR";
import IT from "country-flag-icons/react/3x2/IT";
import NO from "country-flag-icons/react/3x2/NO";
import PL from "country-flag-icons/react/3x2/PL";
import PT from "country-flag-icons/react/3x2/PT";
import RO from "country-flag-icons/react/3x2/RO";
import SE from "country-flag-icons/react/3x2/SE";
import TR from "country-flag-icons/react/3x2/TR";
import UA from "country-flag-icons/react/3x2/UA";

export type FlagComponent = typeof DE;

export type LanguageDisplay = {
	/** The language's name in that language. */
	name: string;
	/** ISO 3166-1 alpha-2 code of the flag; omitted where no single country flag suits the speakers. */
	country?: string;
	Flag?: FlagComponent;
};

export const LANGUAGE_CONFIG: Record<string, LanguageDisplay> = {
	de: { name: "Deutsch", country: "DE", Flag: DE },
	en: { name: "English", country: "GB", Flag: GB },
	fr: { name: "Français", country: "FR", Flag: FR },
	es: { name: "Español", country: "ES", Flag: ES },
	it: { name: "Italiano", country: "IT", Flag: IT },
	pt: { name: "Português", country: "PT", Flag: PT },
	el: { name: "Ελληνικά", country: "GR", Flag: GR },
	pl: { name: "Polski", country: "PL", Flag: PL },
	tr: { name: "Türkçe", country: "TR", Flag: TR },
	gsw: { name: "Schweizerdeutsch", country: "CH", Flag: CH },
	no: { name: "Norsk", country: "NO", Flag: NO },
	sv: { name: "Svenska", country: "SE", Flag: SE },
	ro: { name: "Română", country: "RO", Flag: RO },
	hr: { name: "Hrvatski", country: "HR", Flag: HR },
	bs: { name: "Bosanski", country: "BA", Flag: BA },
	sq: { name: "Shqip", country: "AL", Flag: AL },
	uk: { name: "Українська", country: "UA", Flag: UA },
	// Russian-speaking staff come from many countries, so no single flag represents them.
	ru: { name: "Русский" },
};
