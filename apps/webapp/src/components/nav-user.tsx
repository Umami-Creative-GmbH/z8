"use client";

import {
	IconClock,
	IconDotsVertical,
	IconLanguage,
	IconLoader2,
	IconLogout,
	IconSettings,
	IconUserCircle,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { authClient } from "@/lib/auth-client";
import { usePathname, useRouter } from "@/navigation";
import { ALL_LANGUAGES } from "@/tolgee/shared";

const LANGUAGE_NAMES: Record<string, string> = {
	de: "Deutsch",
	en: "English",
};

export function NavUser({
	user,
	isLoading,
}: {
	user: {
		name: string;
		email: string;
		avatar?: string;
	};
	isLoading?: boolean;
}) {
	const { isMobile } = useSidebar();
	const { t } = useTranslate();
	const router = useRouter();
	const locale = useLocale();
	const pathname = usePathname();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [isPending, startTransition] = useTransition();
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [previousEmail, setPreviousEmail] = useState(user.email);

	// Debug: Log when isLoggingOut changes
	useEffect(() => {
		console.log("isLoggingOut changed to:", isLoggingOut);
	}, [isLoggingOut]);

	// Reset logout overlay when user logs back in
	// Only reset if user.email changes from empty to having a value
	useEffect(() => {
		if (!previousEmail && user.email && isLoggingOut) {
			// User logged back in, reset the overlay
			console.log("User logged back in, resetting overlay");
			setIsLoggingOut(false);
		}
		setPreviousEmail(user.email);
	}, [user.email, previousEmail, isLoggingOut]);

	const handleLogout = async () => {
		console.log("Logout clicked - closing dropdown");
		setDropdownOpen(false);
		console.log("Setting isLoggingOut to true");
		setIsLoggingOut(true);
		console.log("isLoggingOut state:", isLoggingOut);
		try {
			await authClient.signOut({
				fetchOptions: {
					onSuccess: () => {
						// Keep the overlay visible during navigation
						setTimeout(() => {
							router.push("/sign-in");
						}, 100);
					},
					onError: (error) => {
						console.error("Logout error:", error);
						setIsLoggingOut(false);
					},
				},
			});
		} catch (error) {
			console.error("Logout failed:", error);
			setIsLoggingOut(false);
		}
	};

	const handleLanguageChange = (newLocale: string) => {
		startTransition(() => {
			router.replace(pathname, { locale: newLocale });
		});
	};

	const initials = user.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: "?";

	// Show skeleton loader while session is loading
	if (isLoading) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg" disabled>
						<Skeleton className="h-8 w-8 rounded-lg" />
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
								<Avatar className="h-8 w-8 rounded-lg">
									<AvatarImage alt={user.name} src={user.avatar} />
									<AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
								</Avatar>
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
									<Avatar className="h-8 w-8 rounded-lg">
										<AvatarImage alt={user.name} src={user.avatar} />
										<AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
									</Avatar>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{user.name}</span>
										<span className="truncate text-muted-foreground text-xs">{user.email}</span>
									</div>
								</div>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem onClick={() => router.push("/settings/profile")}>
									<IconUserCircle />
									{t("user.profile", "Profile")}
								</DropdownMenuItem>
								<DropdownMenuItem>
									<IconClock />
									{t("user.time-settings", "Time Settings")}
								</DropdownMenuItem>
								<DropdownMenuItem>
									<IconSettings />
									{t("user.preferences", "Preferences")}
								</DropdownMenuItem>
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							<DropdownMenuSub>
								<DropdownMenuSubTrigger disabled={isPending}>
									<IconLanguage />
									{t("user.language", "Language")}
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									<DropdownMenuRadioGroup value={locale} onValueChange={handleLanguageChange}>
										{ALL_LANGUAGES.map((lang) => (
											<DropdownMenuRadioItem key={lang} value={lang}>
												{LANGUAGE_NAMES[lang] || lang}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={handleLogout}>
								<IconLogout />
								{t("user.log-out", "Log out")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarMenuItem>
			</SidebarMenu>

			{isLoggingOut && typeof document !== "undefined" ? (
				console.log("Rendering logout overlay portal"),
				createPortal(
					<div className="fixed inset-0 z-[9999] flex items-center justify-center">
						<div className="absolute inset-0 bg-black/20 backdrop-blur-md" />
						<div className="relative flex flex-col items-center justify-center gap-4 rounded-lg border bg-card/95 px-12 py-8 shadow-2xl backdrop-blur-sm">
							<IconLoader2 className="size-8 animate-spin text-primary" />
							<span className="font-medium text-sm">{t("user.logging-out", "Logging out...")}</span>
						</div>
					</div>,
					document.body,
				)
			) : null}
		</>
	);
}
