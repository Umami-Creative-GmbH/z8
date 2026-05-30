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
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "@/navigation";
import { persistLocaleToDb, setLanguage } from "@/tolgee/language";
import { ALL_LANGUAGES } from "@/tolgee/shared";

type LanguageSwitcherProps = {
	variant?: "default" | "compact";
};

export function LanguageSwitcher({ variant = "default" }: LanguageSwitcherProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { replace } = useRouter();
	const pathname = usePathname();
	const [isPending, startTransition] = useTransition();
	const isCompact = variant === "compact";

	const handleLanguageChange = (newLocale: string) => {
		startTransition(async () => {
			await setLanguage(newLocale);
			await persistLocaleToDb(newLocale).catch(() => {});
			replace(pathname, { locale: newLocale });
		});
	};

	const currentConfig = LANGUAGE_CONFIG[locale];
	const CurrentFlag = currentConfig?.Flag;

	return (
		<Select value={locale} onValueChange={handleLanguageChange} disabled={isPending}>
			<SelectTrigger
				aria-label={t("common.select-language", "Select language")}
				className={cn("bg-background", isCompact ? "w-[88px]" : "w-[160px]")}
			>
				<SelectValue placeholder={t("common.select-language", "Select language")}>
					<span className="flex items-center gap-2">
						{CurrentFlag && (
							<CurrentFlag
								className="h-4 w-auto"
								title={isCompact ? undefined : currentConfig.name}
							/>
						)}
						{isCompact ? (
							<span className="font-medium text-foreground text-xs tracking-wide">
								{locale.toUpperCase()}
							</span>
						) : (
							(currentConfig?.name ?? locale)
						)}
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
