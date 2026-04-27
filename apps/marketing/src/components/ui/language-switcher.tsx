"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useThemeTokens } from "@/components/theme/theme-context";
import { getLocalizedPath, isLocale, type Locale } from "@/i18n/locales";

const languageOptions: Array<{ locale: Locale; label: string; ariaLabel: string }> = [
	{ locale: "de", label: "DE", ariaLabel: "Zur deutschen Version wechseln" },
	{ locale: "en", label: "EN", ariaLabel: "Switch to English version" },
];

const languageControlClass =
	"flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 transition-colors sm:min-w-8 sm:px-2";

export function LanguageSwitcher() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [hash, setHash] = useState("");
	const { t, dark } = useThemeTokens();
	const firstSegment = pathname.split("/").filter(Boolean)[0];
	const activeLocale: Locale = isLocale(firstSegment) ? firstSegment : "de";
	const queryString = searchParams.toString();
	const urlSuffix = `${queryString ? `?${queryString}` : ""}${hash}`;

	useEffect(() => {
		const syncHash = () => setHash(window.location.hash);

		syncHash();
		window.addEventListener("hashchange", syncHash);

		return () => window.removeEventListener("hashchange", syncHash);
	}, []);

	return (
		<nav
			aria-label="Language"
			className="flex h-9 items-center rounded-lg p-0.5 text-[11px] font-bold tracking-[0.08em]"
			style={{
				backgroundColor: dark ? "#1e1e1e" : "#f0f0f0",
				border: `1px solid ${dark ? "#252525" : "#e8e8e8"}`,
			}}
		>
			{languageOptions.map((option) => {
				const active = option.locale === activeLocale;
				const style = {
					backgroundColor: active ? t.surface : "transparent",
					color: active ? t.surfaceText : t.textSecondary,
				};

				if (active) {
					return (
						<span
							key={option.locale}
							aria-current="page"
							className={languageControlClass}
							style={style}
						>
							{option.label}
						</span>
					);
				}

				return (
					<a
						key={option.locale}
						href={`${getLocalizedPath(pathname, option.locale)}${urlSuffix}`}
						aria-label={option.ariaLabel}
						className={languageControlClass}
						style={style}
					>
						{option.label}
					</a>
				);
			})}
		</nav>
	);
}
