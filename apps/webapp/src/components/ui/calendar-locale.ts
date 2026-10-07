import type { DayPickerLocale } from "@daypicker/react";
import { de } from "@daypicker/react/locale/de";
import { el } from "@daypicker/react/locale/el";
import { enUS } from "@daypicker/react/locale/en-US";
import { es } from "@daypicker/react/locale/es";
import { fr } from "@daypicker/react/locale/fr";
import { it } from "@daypicker/react/locale/it";
import { pl } from "@daypicker/react/locale/pl";
import { pt } from "@daypicker/react/locale/pt";
import { tr } from "@daypicker/react/locale/tr";

const DAY_PICKER_LOCALES: Readonly<Record<string, DayPickerLocale>> = {
	en: enUS,
	de,
	fr,
	es,
	it,
	pt,
	el,
	pl,
	tr,
	// No Swiss German locale exists; Swiss German writes dates in Standard German.
	gsw: de,
};

/** The DayPicker locale for an app language; English for anything unknown. */
export function dayPickerLocaleFor(language: string): DayPickerLocale {
	return DAY_PICKER_LOCALES[language] ?? enUS;
}
