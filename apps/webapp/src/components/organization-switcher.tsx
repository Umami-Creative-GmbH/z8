"use client";

import {
	IconBuilding,
	IconCheck,
	IconChevronDown,
	IconLoader2,
	IconPlus,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { CreateOrganizationDialog } from "@/components/organization/create-organization-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
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
import type { UserOrganization } from "@/lib/auth-helpers";
import { useRouter } from "@/navigation";

interface OrganizationSwitcherProps {
	organizations: UserOrganization[];
	currentOrganization: UserOrganization | null;
}

export function OrganizationSwitcher({
	organizations,
	currentOrganization,
}: OrganizationSwitcherProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const { isMobile } = useSidebar();
	const [switching, setSwitching] = useState(false);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);

	const handleSwitchOrganization = async (organizationId: string) => {
		if (organizationId === currentOrganization?.id) return;

		setSwitching(true);

		try {
			const response = await fetch("/api/organizations/switch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ organizationId }),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || "Failed to switch organization");
			}

			const result = await response.json();

			if (!result.hasEmployeeRecord) {
				toast.warning(
					t(
						"organization.noEmployeeRecord",
						"You are not set up as an employee in this organization yet.",
					),
				);
			}

			// Refresh the page to update context
			router.refresh();
		} catch (error: any) {
			toast.error(error.message || t("organization.switchFailed", "Failed to switch organization"));
		} finally {
			setSwitching(false);
		}
	};

	if (organizations.length === 0) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg" className="opacity-50">
						<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
							<IconBuilding className="size-4" />
						</div>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-semibold">
								{t("organization.noOrganizations", "No Organizations")}
							</span>
							<span className="truncate text-xs">
								{t("organization.joinOrCreate", "Join or create one")}
							</span>
						</div>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	const activeOrg = currentOrganization || organizations[0];

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
							disabled={switching}
						>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								{activeOrg.logo ? (
									<img
										src={activeOrg.logo}
										alt={activeOrg.name}
										className="size-8 rounded-lg object-cover"
									/>
								) : (
									<IconBuilding className="size-4" />
								)}
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">{activeOrg.name}</span>
								<span className="truncate text-xs">
									{activeOrg.memberRole === "owner"
										? t("organization.role.owner", "Owner")
										: activeOrg.memberRole === "admin"
											? t("organization.role.admin", "Admin")
											: t("organization.role.member", "Member")}
								</span>
							</div>
							{switching ? (
								<IconLoader2 className="ml-auto size-4 animate-spin" />
							) : (
								<IconChevronDown className="ml-auto" />
							)}
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
						align="start"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						<DropdownMenuLabel className="text-xs text-muted-foreground">
							{t("organization.switchTo", "Switch Organization")}
						</DropdownMenuLabel>
						{organizations.map((org) => (
							<DropdownMenuItem
								key={org.id}
								onClick={() => handleSwitchOrganization(org.id)}
								className="gap-2 p-2"
								disabled={switching}
							>
								<div className="flex size-6 items-center justify-center rounded-sm border">
									{org.logo ? (
										<img src={org.logo} alt={org.name} className="size-6 rounded-sm object-cover" />
									) : (
										<IconBuilding className="size-4" />
									)}
								</div>
								<div className="flex-1">
									<div className="font-medium">{org.name}</div>
									<div className="text-xs text-muted-foreground">{org.memberRole}</div>
								</div>
								{org.id === activeOrg.id && <IconCheck className="size-4" />}
							</DropdownMenuItem>
						))}
						<DropdownMenuSeparator />
						<DropdownMenuItem className="gap-2 p-2" onClick={() => setCreateDialogOpen(true)}>
							<div className="flex size-6 items-center justify-center rounded-md border border-dashed">
								<IconPlus className="size-4" />
							</div>
							<div className="font-medium text-muted-foreground">
								{t("organization.create", "Create Organization")}
							</div>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>

				<CreateOrganizationDialog
					open={createDialogOpen}
					onOpenChange={setCreateDialogOpen}
					onSuccess={() => router.refresh()}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
