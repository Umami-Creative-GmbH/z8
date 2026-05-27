import CH from "country-flag-icons/react/3x2/CH";
import DE from "country-flag-icons/react/3x2/DE";
import ES from "country-flag-icons/react/3x2/ES";
import FR from "country-flag-icons/react/3x2/FR";
import GB from "country-flag-icons/react/3x2/GB";
import GR from "country-flag-icons/react/3x2/GR";
import IT from "country-flag-icons/react/3x2/IT";
import PL from "country-flag-icons/react/3x2/PL";
import PT from "country-flag-icons/react/3x2/PT";
import TR from "country-flag-icons/react/3x2/TR";

export type FlagComponent = typeof DE;

export const LANGUAGE_CONFIG: Record<string, { name: string; Flag: FlagComponent }> = {
	de: { name: "Deutsch", Flag: DE },
	en: { name: "English", Flag: GB },
	fr: { name: "Français", Flag: FR },
	es: { name: "Español", Flag: ES },
	it: { name: "Italiano", Flag: IT },
	pt: { name: "Português", Flag: PT },
	el: { name: "Ελληνικά", Flag: GR },
	pl: { name: "Polski", Flag: PL },
	tr: { name: "Türkçe", Flag: TR },
	gsw: { name: "Schweizerdeutsch", Flag: CH },
};
