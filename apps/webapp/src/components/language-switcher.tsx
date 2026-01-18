"use client";

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
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { usePathname, useRouter } from "@/navigation";
import { ALL_LANGUAGES } from "@/tolgee/shared";

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
			<SelectTrigger className="w-[160px] bg-background">
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
