"use client";

import { usePathname } from "next/navigation";
import { useThemeTokens } from "@/components/theme/theme-context";
import { getLocalizedPath, isLocale, type Locale } from "@/i18n/locales";

const languageOptions: Array<{ locale: Locale; label: string; ariaLabel: string }> = [
	{ locale: "de", label: "DE", ariaLabel: "Zur deutschen Version wechseln" },
	{ locale: "en", label: "EN", ariaLabel: "Switch to English version" },
];

export function LanguageSwitcher() {
	const pathname = usePathname();
	const { t, dark } = useThemeTokens();
	const firstSegment = pathname.split("/").filter(Boolean)[0];
	const activeLocale: Locale = isLocale(firstSegment) ? firstSegment : "de";

	return (
		<nav
			aria-label="Language"
			className="hidden h-9 items-center rounded-lg p-0.5 text-[11px] font-bold tracking-[0.08em] sm:flex"
			style={{
				backgroundColor: dark ? "#1e1e1e" : "#f0f0f0",
				border: `1px solid ${dark ? "#252525" : "#e8e8e8"}`,
			}}
		>
			{languageOptions.map((option) => {
				const active = option.locale === activeLocale;

				return (
					<a
						key={option.locale}
						href={getLocalizedPath(pathname, option.locale)}
						aria-label={option.ariaLabel}
						aria-current={active ? "page" : undefined}
						className="flex h-7 min-w-8 items-center justify-center rounded-md px-2 transition-colors"
						style={{
							backgroundColor: active ? t.surface : "transparent",
							color: active ? t.surfaceText : t.textSecondary,
						}}
					>
						{option.label}
					</a>
				);
			})}
		</nav>
	);
}
