"use client";

import DE from "country-flag-icons/react/3x2/DE";
import ES from "country-flag-icons/react/3x2/ES";
import FR from "country-flag-icons/react/3x2/FR";
import GB from "country-flag-icons/react/3x2/GB";
import IT from "country-flag-icons/react/3x2/IT";
import PT from "country-flag-icons/react/3x2/PT";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePathname, useRouter } from "@/navigation";
import { ALL_LANGUAGES } from "@/tolgee/shared";

// Use inferred type from the flag library (FlagComponent type)
type FlagComponent = typeof DE;

const LANGUAGE_CONFIG: Record<string, { name: string; Flag: FlagComponent }> = {
	de: { name: "Deutsch", Flag: DE },
	en: { name: "English", Flag: GB },
	fr: { name: "Français", Flag: FR },
	es: { name: "Español", Flag: ES },
	it: { name: "Italiano", Flag: IT },
	pt: { name: "Português", Flag: PT },
};

export function LanguageSwitcher() {
	const { t } = useTranslate();
	const locale = useLocale();
	const router = useRouter();
	const pathname = usePathname();
	const [isPending, startTransition] = useTransition();

	const handleLanguageChange = (newLocale: string) => {
		startTransition(() => {
			router.replace(pathname, { locale: newLocale });
		});
	};

	const currentConfig = LANGUAGE_CONFIG[locale];
	const CurrentFlag = currentConfig?.Flag;

	return (
		<Select value={locale} onValueChange={handleLanguageChange} disabled={isPending}>
			<SelectTrigger className="w-[160px]">
				<SelectValue placeholder={t("common.select-language", "Select language")}>
					<span className="flex items-center gap-2">
						{CurrentFlag && <CurrentFlag className="h-4 w-auto" title={currentConfig.name} />}
						{currentConfig?.name ?? locale}
					</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{ALL_LANGUAGES.map((lang) => {
					const config = LANGUAGE_CONFIG[lang];
					const FlagIcon = config?.Flag;
					const name = config?.name ?? lang;
					return (
						<SelectItem key={lang} value={lang}>
							<span className="flex items-center gap-2">
								{FlagIcon && <FlagIcon className="h-4 w-auto" title={name} />}
								{name}
							</span>
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
}
