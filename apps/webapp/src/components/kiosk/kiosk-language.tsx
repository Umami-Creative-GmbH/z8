"use client";

import { IconLanguage } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useEffect, useEffectEvent } from "react";
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

/**
 * The kiosk page's language (#862). It follows the organization's default
 * language. Someone at the kiosk may switch to another one; that choice holds
 * until the kiosk returns home after an employee's turn, so the next person
 * starts in the organization's language again. The choice is remembered for
 * this browser tab only, because a language change reloads the page.
 */
const LANGUAGE_CHOICE_KEY = "z8.kiosk.languageChoice";

function readChoice(): string | null {
	try {
		return window.sessionStorage.getItem(LANGUAGE_CHOICE_KEY);
	} catch {
		return null;
	}
}

function writeChoice(language: string | null) {
	try {
		if (language) window.sessionStorage.setItem(LANGUAGE_CHOICE_KEY, language);
		else window.sessionStorage.removeItem(LANGUAGE_CHOICE_KEY);
	} catch {
		// Without storage the kiosk simply stays in the organization's language.
	}
}

export function useKioskLanguage(organizationLanguage: string) {
	const locale = useLocale();
	const router = useRouter();
	const pathname = usePathname();

	function show(language: string) {
		if (language !== locale) router.replace(pathname, { locale: language });
	}

	const followOrganization = useEffectEvent(() => {
		if (!readChoice()) show(organizationLanguage);
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: follow again when the organization's language changes
	useEffect(() => {
		followOrganization();
	}, [organizationLanguage]);

	return {
		locale,
		/** Someone at the kiosk picked a language. */
		choose(language: string) {
			writeChoice(language === organizationLanguage ? null : language);
			show(language);
		},
		/** The kiosk went home after an employee's turn: back to the organization's language. */
		reset() {
			if (!readChoice()) return;
			writeChoice(null);
			show(organizationLanguage);
		},
	};
}

export function KioskLanguageSwitch({
	locale,
	onChoose,
}: {
	locale: string;
	onChoose: (language: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<Select value={locale} onValueChange={onChoose}>
			<SelectTrigger
				aria-label={t("common.select-language", "Select language")}
				className="h-12 min-w-40 text-base"
			>
				<IconLanguage className="size-5" aria-hidden="true" />
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{ALL_LANGUAGES.map((language) => (
					<SelectItem key={language} value={language} className="h-12 text-base">
						{LANGUAGE_CONFIG[language]?.name ?? language}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
