"use client";

import {
	IconChevronDown,
	IconClock,
	IconDeviceDesktop,
	IconLanguage,
	IconMoon,
	IconPalette,
	IconSun,
	IconTextSize,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { type ComponentType, type SVGProps, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useFontSizePreference } from "@/components/font-size-preference";
import { FONT_SIZE_OPTIONS, isFontSizePreference } from "@/components/font-size-preference-utils";
import { useTheme } from "@/components/theme-provider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { useRouter } from "@/navigation";
import { persistLocaleToDb, setLanguage } from "@/tolgee/language";
import { ALL_LANGUAGES } from "@/tolgee/shared";

type MobilePreferenceSection = "language" | "fontSize" | "theme";

export function NavUserPreferences() {
	const { isMobile } = useSidebar();
	const { t } = useTranslate();
	const { replace } = useRouter();
	const locale = useLocale();
	const { clearThemeError, setTheme, theme, themeError, timeThemeInfo } = useTheme();
	const { fontSize, setFontSize } = useFontSizePreference();
	const [isPending, startTransition] = useTransition();
	const [mobileOpenSection, setMobileOpenSection] = useState<MobilePreferenceSection | null>(null);
	const mobileRadioItemClassName =
		"pl-2 data-checked:bg-accent data-checked:text-accent-foreground [&>span:first-child]:hidden";

	useEffect(() => {
		if (themeError === "location-required") {
			toast.error(
				t("user.theme-location-required", "Location permission is required for time-based theme."),
				{
					description: t("user.theme-system", "System theme will be used instead."),
					duration: 6000,
					id: "theme-location-required",
				},
			);
		}
	}, [themeError, t]);

	const handleLanguageChange = (newLocale: string) => {
		startTransition(async () => {
			await setLanguage(newLocale);
			await persistLocaleToDb(newLocale).catch(() => {});
			const pathname = window.location.pathname.replace(`/${locale}`, "") || "/";
			replace(pathname, { locale: newLocale });
		});
	};

	const timeThemeDescription = timeThemeInfo
		? t(
				"user.theme-time-info",
				"Time based is using {currentMode} mode. Switches to {nextMode} at {time}.",
				{
					currentMode:
						timeThemeInfo.currentTheme === "dark"
							? t("user.theme-dark", "Dark")
							: t("user.theme-light", "Light"),
					nextMode:
						timeThemeInfo.nextTheme === "dark"
							? t("user.theme-dark", "Dark")
							: t("user.theme-light", "Light"),
					time: DateTime.fromJSDate(timeThemeInfo.nextSwitchAt)
						.setLocale(locale)
						.toLocaleString(DateTime.TIME_SIMPLE),
				},
			)
		: undefined;

	const preferenceControls = (mobile: boolean) => {
		const radioItemClassName = mobile ? mobileRadioItemClassName : undefined;

		return (
			<>
				<DropdownMenuRadioGroup value={locale} onValueChange={handleLanguageChange}>
					{ALL_LANGUAGES.map((lang) => {
						const config = LANGUAGE_CONFIG[lang];
						const FlagIcon = config?.Flag as ComponentType<SVGProps<SVGSVGElement>> | undefined;
						const name = config?.name ?? lang;
						return (
							<DropdownMenuRadioItem
								key={lang}
								className={radioItemClassName}
								value={lang}
								disabled={isPending}
							>
								<span className="flex items-center gap-2">
									{FlagIcon && <FlagIcon className="h-4 w-auto" />}
									{name}
								</span>
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</>
		);
	};

	const fontSizeControls = (mobile: boolean) => (
		<DropdownMenuRadioGroup
			value={fontSize}
			onValueChange={(value) => isFontSizePreference(value) && setFontSize(value)}
		>
			{FONT_SIZE_OPTIONS.map((option) => (
				<DropdownMenuRadioItem
					key={option.value}
					className={mobile ? mobileRadioItemClassName : undefined}
					value={option.value}
				>
					{t(option.labelKey, option.label)}
				</DropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	);

	const themeControls = (mobile: boolean) => (
		<>
			<DropdownMenuRadioGroup
				value={theme}
				onValueChange={(value) => {
					clearThemeError();
					setTheme(value);
				}}
			>
				<DropdownMenuRadioItem className={mobile ? mobileRadioItemClassName : undefined} value="light">
					<IconSun className="mr-2 size-4" />
					{t("user.theme-light", "Light")}
				</DropdownMenuRadioItem>
				<DropdownMenuRadioItem className={mobile ? mobileRadioItemClassName : undefined} value="dark">
					<IconMoon className="mr-2 size-4" />
					{t("user.theme-dark", "Dark")}
				</DropdownMenuRadioItem>
				<DropdownMenuRadioItem className={mobile ? mobileRadioItemClassName : undefined} value="time">
					<IconClock aria-hidden="true" className="mr-2 size-4" />
					{t("user.theme-time", "Time based")}
				</DropdownMenuRadioItem>
				<DropdownMenuRadioItem className={mobile ? mobileRadioItemClassName : undefined} value="system">
					<IconDeviceDesktop className="mr-2 size-4" />
					{t("user.theme-system", "System")}
				</DropdownMenuRadioItem>
			</DropdownMenuRadioGroup>
			{themeError === "location-required" && (
				<p className={mobile ? "px-2 py-1 text-muted-foreground text-xs" : "max-w-52 px-2 py-1 text-muted-foreground text-xs"} role="alert">
					{t("user.theme-location-required", "Location permission is required for time-based theme.")}
				</p>
			)}
			{theme === "time" && timeThemeDescription && (
				<p className={mobile ? "px-2 py-1 text-muted-foreground text-xs" : "max-w-52 px-2 py-1 text-muted-foreground text-xs"}>
					{timeThemeDescription}
				</p>
			)}
		</>
	);

	if (!isMobile) {
		return (
			<>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger disabled={isPending}>
						<IconLanguage className="mr-2 size-4" stroke={1.5} />
						{t("user.language", "Language")}
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>{preferenceControls(false)}</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<IconTextSize aria-hidden="true" className="mr-2 size-4" stroke={1.5} />
						{t("user.font-size", "Font size")}
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>{fontSizeControls(false)}</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<IconPalette className="mr-2 size-4" stroke={1.5} />
						{t("user.theme", "Theme")}
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>{themeControls(false)}</DropdownMenuSubContent>
				</DropdownMenuSub>
			</>
		);
	}

	const setMobileSectionOpen = (section: MobilePreferenceSection, open: boolean) => {
		setMobileOpenSection(open ? section : null);
	};
	const mobileItemClassName =
		"w-full data-[panel-open]:bg-accent data-[panel-open]:text-accent-foreground [&[data-panel-open]>svg:last-child]:rotate-180";

	return (
		<>
			<Collapsible open={mobileOpenSection === "language"} onOpenChange={(open) => setMobileSectionOpen("language", open)}>
				<CollapsibleTrigger asChild>
					<DropdownMenuItem className={mobileItemClassName} disabled={isPending} onSelect={(event) => event.preventDefault()}>
						<IconLanguage className="mr-2 size-4" stroke={1.5} />
						{t("user.language", "Language")}
						<IconChevronDown className="ml-auto size-4 transition-transform duration-200" />
					</DropdownMenuItem>
				</CollapsibleTrigger>
				<CollapsibleContent className="overflow-hidden pl-2 motion-safe:data-closed:animate-accordion-up motion-safe:data-open:animate-accordion-down">
					{preferenceControls(true)}
				</CollapsibleContent>
			</Collapsible>
			<DropdownMenuSeparator />
			<Collapsible open={mobileOpenSection === "fontSize"} onOpenChange={(open) => setMobileSectionOpen("fontSize", open)}>
				<CollapsibleTrigger asChild>
					<DropdownMenuItem className={mobileItemClassName} onSelect={(event) => event.preventDefault()}>
						<IconTextSize aria-hidden="true" className="mr-2 size-4" stroke={1.5} />
						{t("user.font-size", "Font size")}
						<IconChevronDown className="ml-auto size-4 transition-transform duration-200" />
					</DropdownMenuItem>
				</CollapsibleTrigger>
				<CollapsibleContent className="overflow-hidden pl-2 motion-safe:data-closed:animate-accordion-up motion-safe:data-open:animate-accordion-down">
					{fontSizeControls(true)}
				</CollapsibleContent>
			</Collapsible>
			<DropdownMenuSeparator />
			<Collapsible open={mobileOpenSection === "theme"} onOpenChange={(open) => setMobileSectionOpen("theme", open)}>
				<CollapsibleTrigger asChild>
					<DropdownMenuItem className={mobileItemClassName} onSelect={(event) => event.preventDefault()}>
						<IconPalette className="mr-2 size-4" stroke={1.5} />
						{t("user.theme", "Theme")}
						<IconChevronDown className="ml-auto size-4 transition-transform duration-200" />
					</DropdownMenuItem>
				</CollapsibleTrigger>
				<CollapsibleContent className="overflow-hidden pl-2 motion-safe:data-closed:animate-accordion-up motion-safe:data-open:animate-accordion-down">
					{themeControls(true)}
				</CollapsibleContent>
			</Collapsible>
		</>
	);
}
