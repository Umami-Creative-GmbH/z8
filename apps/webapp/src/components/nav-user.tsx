"use client";

import {
	IconChevronDown,
	IconClock,
	IconDeviceDesktop,
	IconDotsVertical,
	IconLanguage,
	IconLoader2,
	IconLogout,
	IconMoon,
	IconPalette,
	IconShield,
	IconSun,
	IconTextSize,
	IconUserCircle,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useFontSizePreference } from "@/components/font-size-preference";
import { FONT_SIZE_OPTIONS, isFontSizePreference } from "@/components/font-size-preference-utils";
import { useTheme } from "@/components/theme-provider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { authClient } from "@/lib/auth-client";
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { usePathname, useRouter } from "@/navigation";
import { persistLocaleToDb, setLanguage } from "@/tolgee/language";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export function NavUser({
	user,
	isLoading,
}: {
	user: {
		id: string;
		name: string;
		email: string;
		avatar?: string;
	};
	isLoading?: boolean;
}) {
	const { isMobile } = useSidebar();
	const { t } = useTranslate();
	const { push, replace } = useRouter();
	const locale = useLocale();
	const pathname = usePathname();
	const { clearThemeError, setTheme, theme, themeError, timeThemeInfo } = useTheme();
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
	const { fontSize, setFontSize } = useFontSizePreference();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [isPending, startTransition] = useTransition();
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [mobileOpenSection, setMobileOpenSection] = useState<
		"language" | "fontSize" | "theme" | null
	>(null);
	const mobileRadioItemClassName =
		"pl-2 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground [&>span:first-child]:hidden";

	const handleLogout = async () => {
		setDropdownOpen(false);
		setIsLoggingOut(true);
		const showLogoutError = () => {
			toast.error(t("user.log-out-failed", "Could not log out. Please try again."), {
				id: "logout-failed",
			});
		};
		try {
			await authClient.signOut({
				fetchOptions: {
					onSuccess: () => {
						// Keep the overlay visible during navigation
						setTimeout(() => {
							push("/sign-in");
						}, 100);
					},
					onError: (error) => {
						void error;
						setIsLoggingOut(false);
						showLogoutError();
					},
				},
			});
		} catch (error) {
			void error;
			setIsLoggingOut(false);
			showLogoutError();
		}
	};

	const handleLanguageChange = (newLocale: string) => {
		startTransition(async () => {
			await setLanguage(newLocale);
			await persistLocaleToDb(newLocale).catch(() => {});
			replace(pathname, { locale: newLocale });
		});
	};

	const handleFontSizeChange = (value: string) => {
		if (isFontSizePreference(value)) {
			setFontSize(value);
		}
	};

	const handleThemeChange = (value: string) => {
		clearThemeError();
		setTheme(value);
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

	const setMobileSectionOpen = (section: "language" | "fontSize" | "theme", open: boolean) => {
		setMobileOpenSection(open ? section : null);
	};

	// Show skeleton loader while session is loading
	if (isLoading) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg" disabled>
						<Skeleton className="size-8 rounded-lg" />
						<div className="grid flex-1 gap-1.5 text-left text-sm leading-tight">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-3 w-32" />
						</div>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	return (
		<>
			<SidebarMenu>
				<SidebarMenuItem>
					<DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
						<DropdownMenuTrigger asChild>
							<SidebarMenuButton
								className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
								size="lg"
							>
								<UserAvatar
									seed={user.id}
									image={user.avatar}
									name={user.name}
									size="sm"
									shape="rounded"
									clockStatus="unknown"
								/>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user.name}</span>
									<span className="truncate text-muted-foreground text-xs">{user.email}</span>
								</div>
								<IconDotsVertical className="ml-auto size-4" />
							</SidebarMenuButton>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
							side={isMobile ? "bottom" : "right"}
							sideOffset={4}
						>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<UserAvatar
										seed={user.id}
										image={user.avatar}
										name={user.name}
										size="sm"
										shape="rounded"
										clockStatus="unknown"
									/>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{user.name}</span>
										<span className="truncate text-muted-foreground text-xs">{user.email}</span>
									</div>
								</div>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem onClick={() => push("/settings/profile")}>
									<IconUserCircle />
									{t("user.profile", "Profile")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => push("/settings/security")}>
									<IconShield />
									{t("user.security", "Security")}
								</DropdownMenuItem>
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							{isMobile ? (
								<>
									<Collapsible
										open={mobileOpenSection === "language"}
										onOpenChange={(open) => setMobileSectionOpen("language", open)}
									>
										<CollapsibleTrigger asChild>
											<DropdownMenuItem
												className="w-full data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&[data-state=open]>svg:last-child]:rotate-180"
												disabled={isPending}
												onSelect={(event) => event.preventDefault()}
											>
												<IconLanguage className="mr-2 size-4" stroke={1.5} />
												{t("user.language", "Language")}
												<IconChevronDown className="ml-auto size-4 transition-transform duration-200" />
											</DropdownMenuItem>
										</CollapsibleTrigger>
										<CollapsibleContent className="overflow-hidden pl-2 motion-safe:data-[state=closed]:animate-accordion-up motion-safe:data-[state=open]:animate-accordion-down">
											<DropdownMenuRadioGroup value={locale} onValueChange={handleLanguageChange}>
												{ALL_LANGUAGES.map((lang) => {
													const config = LANGUAGE_CONFIG[lang];
													const FlagIcon = config?.Flag;
													const name = config?.name ?? lang;
													return (
														<DropdownMenuRadioItem
															key={lang}
															className={mobileRadioItemClassName}
															value={lang}
															disabled={isPending}
														>
															<span className="flex items-center gap-2">
																{FlagIcon && <FlagIcon className="h-4 w-auto" title={name} />}
																{name}
															</span>
														</DropdownMenuRadioItem>
													);
												})}
											</DropdownMenuRadioGroup>
										</CollapsibleContent>
									</Collapsible>
									<DropdownMenuSeparator />
									<Collapsible
										open={mobileOpenSection === "fontSize"}
										onOpenChange={(open) => setMobileSectionOpen("fontSize", open)}
									>
										<CollapsibleTrigger asChild>
											<DropdownMenuItem
												className="w-full data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&[data-state=open]>svg:last-child]:rotate-180"
												onSelect={(event) => event.preventDefault()}
											>
												<IconTextSize aria-hidden="true" className="mr-2 size-4" stroke={1.5} />
												{t("user.font-size", "Font size")}
												<IconChevronDown className="ml-auto size-4 transition-transform duration-200" />
											</DropdownMenuItem>
										</CollapsibleTrigger>
										<CollapsibleContent className="overflow-hidden pl-2 motion-safe:data-[state=closed]:animate-accordion-up motion-safe:data-[state=open]:animate-accordion-down">
											<DropdownMenuRadioGroup value={fontSize} onValueChange={handleFontSizeChange}>
												{FONT_SIZE_OPTIONS.map((option) => (
													<DropdownMenuRadioItem
														key={option.value}
														className={mobileRadioItemClassName}
														value={option.value}
													>
														{t(option.labelKey, option.label)}
													</DropdownMenuRadioItem>
												))}
											</DropdownMenuRadioGroup>
										</CollapsibleContent>
									</Collapsible>
									<DropdownMenuSeparator />
									<Collapsible
										open={mobileOpenSection === "theme"}
										onOpenChange={(open) => setMobileSectionOpen("theme", open)}
									>
										<CollapsibleTrigger asChild>
											<DropdownMenuItem
												className="w-full data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&[data-state=open]>svg:last-child]:rotate-180"
												onSelect={(event) => event.preventDefault()}
											>
												<IconPalette className="mr-2 size-4" stroke={1.5} />
												{t("user.theme", "Theme")}
												<IconChevronDown className="ml-auto size-4 transition-transform duration-200" />
											</DropdownMenuItem>
										</CollapsibleTrigger>
										<CollapsibleContent className="overflow-hidden pl-2 motion-safe:data-[state=closed]:animate-accordion-up motion-safe:data-[state=open]:animate-accordion-down">
											<DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
												<DropdownMenuRadioItem className={mobileRadioItemClassName} value="light">
													<IconSun className="mr-2 size-4" />
													{t("user.theme-light", "Light")}
												</DropdownMenuRadioItem>
												<DropdownMenuRadioItem className={mobileRadioItemClassName} value="dark">
													<IconMoon className="mr-2 size-4" />
													{t("user.theme-dark", "Dark")}
												</DropdownMenuRadioItem>
												<DropdownMenuRadioItem className={mobileRadioItemClassName} value="time">
													<IconClock aria-hidden="true" className="mr-2 size-4" />
													{t("user.theme-time", "Time based")}
												</DropdownMenuRadioItem>
												<DropdownMenuRadioItem className={mobileRadioItemClassName} value="system">
													<IconDeviceDesktop className="mr-2 size-4" />
													{t("user.theme-system", "System")}
												</DropdownMenuRadioItem>
											</DropdownMenuRadioGroup>
											{themeError === "location-required" && (
												<p className="px-2 py-1 text-muted-foreground text-xs" role="alert">
													{t(
														"user.theme-location-required",
														"Location permission is required for time-based theme.",
													)}
												</p>
											)}
											{theme === "time" && timeThemeDescription && (
												<p className="px-2 py-1 text-muted-foreground text-xs">
													{timeThemeDescription}
												</p>
											)}
										</CollapsibleContent>
									</Collapsible>
								</>
							) : (
								<>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger disabled={isPending}>
											<IconLanguage className="mr-2 size-4" stroke={1.5} />
											{t("user.language", "Language")}
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>
											<DropdownMenuRadioGroup value={locale} onValueChange={handleLanguageChange}>
												{ALL_LANGUAGES.map((lang) => {
													const config = LANGUAGE_CONFIG[lang];
													const FlagIcon = config?.Flag;
													const name = config?.name ?? lang;
													return (
														<DropdownMenuRadioItem key={lang} value={lang}>
															<span className="flex items-center gap-2">
																{FlagIcon && <FlagIcon className="h-4 w-auto" title={name} />}
																{name}
															</span>
														</DropdownMenuRadioItem>
													);
												})}
											</DropdownMenuRadioGroup>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger>
											<IconTextSize aria-hidden="true" className="mr-2 size-4" stroke={1.5} />
											{t("user.font-size", "Font size")}
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>
											<DropdownMenuRadioGroup value={fontSize} onValueChange={handleFontSizeChange}>
												{FONT_SIZE_OPTIONS.map((option) => (
													<DropdownMenuRadioItem key={option.value} value={option.value}>
														{t(option.labelKey, option.label)}
													</DropdownMenuRadioItem>
												))}
											</DropdownMenuRadioGroup>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger>
											<IconPalette className="mr-2 size-4" stroke={1.5} />
											{t("user.theme", "Theme")}
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>
											<DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
												<DropdownMenuRadioItem value="light">
													<IconSun className="mr-2 size-4" />
													{t("user.theme-light", "Light")}
												</DropdownMenuRadioItem>
												<DropdownMenuRadioItem value="dark">
													<IconMoon className="mr-2 size-4" />
													{t("user.theme-dark", "Dark")}
												</DropdownMenuRadioItem>
												<DropdownMenuRadioItem value="time">
													<IconClock aria-hidden="true" className="mr-2 size-4" />
													{t("user.theme-time", "Time based")}
												</DropdownMenuRadioItem>
												<DropdownMenuRadioItem value="system">
													<IconDeviceDesktop className="mr-2 size-4" />
													{t("user.theme-system", "System")}
												</DropdownMenuRadioItem>
											</DropdownMenuRadioGroup>
											{themeError === "location-required" && (
												<p
													className="max-w-52 px-2 py-1 text-muted-foreground text-xs"
													role="alert"
												>
													{t(
														"user.theme-location-required",
														"Location permission is required for time-based theme.",
													)}
												</p>
											)}
											{theme === "time" && timeThemeDescription && (
												<p className="max-w-52 px-2 py-1 text-muted-foreground text-xs">
													{timeThemeDescription}
												</p>
											)}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								</>
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={handleLogout}>
								<IconLogout />
								{t("user.log-out", "Log out")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarMenuItem>
			</SidebarMenu>

			{isLoggingOut && typeof document !== "undefined"
				? createPortal(
						<div className="fixed inset-0 z-[9999] flex items-center justify-center">
							<div className="absolute inset-0 bg-black/20 backdrop-blur-md" />
							<div className="relative flex flex-col items-center justify-center gap-4 rounded-lg border bg-card/95 px-12 py-8 shadow-2xl backdrop-blur-sm">
								<IconLoader2 className="size-8 animate-spin text-primary" />
								<span className="font-medium text-sm">
									{t("user.logging-out", "Logging out...")}
								</span>
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
