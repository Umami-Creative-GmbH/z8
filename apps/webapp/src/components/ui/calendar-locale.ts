import type { DayPickerLocale } from "@daypicker/react";
import { bs } from "@daypicker/react/locale/bs";
import { de } from "@daypicker/react/locale/de";
import { el } from "@daypicker/react/locale/el";
import { enUS } from "@daypicker/react/locale/en-US";
import { es } from "@daypicker/react/locale/es";
import { fr } from "@daypicker/react/locale/fr";
import { hr } from "@daypicker/react/locale/hr";
import { it } from "@daypicker/react/locale/it";
import { nb } from "@daypicker/react/locale/nb";
import { pl } from "@daypicker/react/locale/pl";
import { pt } from "@daypicker/react/locale/pt";
import { ro } from "@daypicker/react/locale/ro";
import { ru } from "@daypicker/react/locale/ru";
import { sq } from "@daypicker/react/locale/sq";
import { sv } from "@daypicker/react/locale/sv";
import { tr } from "@daypicker/react/locale/tr";
import { uk } from "@daypicker/react/locale/uk";

// Every app language maps explicitly; `language-coverage.test.ts` fails when one is missing.
export const DAY_PICKER_LOCALES: Readonly<Record<string, DayPickerLocale>> = {
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
	// The app tag `no` is written Bokmål, which date-fns names `nb`.
	no: nb,
	sv,
	ro,
	hr,
	bs,
	sq,
	uk,
	ru,
};

/** The DayPicker locale for an app language; English for anything unknown. */
export function dayPickerLocaleFor(language: string): DayPickerLocale {
	return DAY_PICKER_LOCALES[language] ?? enUS;
}
