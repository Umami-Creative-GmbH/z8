"use client";

import {
	IconDotsVertical,
	IconLoader2,
	IconLogout,
	IconShield,
	IconUserCircle,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { NavUserPreferences } from "@/components/nav-user-preferences";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
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
import { useRouter } from "@/navigation";

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
	const { push } = useRouter();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);

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
								className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
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
							className="w-(--anchor-width) min-w-56 rounded-lg"
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
							<NavUserPreferences />
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
								<span className="font-medium text-sm">{t("user.logging-out", "Logging out...")}</span>
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
