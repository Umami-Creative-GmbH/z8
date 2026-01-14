"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import {
	type FeatureFlag,
	getEntriesByGroup,
	getVisibleGroups,
	getVisibleSettings,
} from "./settings-config";
import { SETTINGS_ICON_MAP } from "./settings-icons";

interface SettingsNavProps {
	isAdmin: boolean;
}

export function SettingsNav({ isAdmin }: SettingsNavProps) {
	const pathname = usePathname();
	const { t } = useTranslate();
	const orgSettings = useOrganizationSettings();
	const isHydrated = orgSettings.isHydrated;

	const visibleItems = getVisibleSettings(isAdmin);
	const visibleGroups = getVisibleGroups(isAdmin);

	const isFeatureEnabled = (feature: FeatureFlag | undefined): boolean => {
		if (!feature) return true;
		return orgSettings[feature] ?? false;
	};

	return (
		<>
			{visibleGroups.map((group) => {
				const groupEntries = getEntriesByGroup(visibleItems, group.id);

				if (groupEntries.length === 0) return null;

				return (
					<SidebarGroup key={group.id}>
						<SidebarGroupLabel>{t(group.labelKey, group.labelDefault)}</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{groupEntries.map((item) => {
									const isActive = pathname?.startsWith(item.href);
									const title = t(item.titleKey, item.titleDefault);
									const Icon = SETTINGS_ICON_MAP[item.icon];
									const hasFeatureFlag = !!item.requiredFeature;
									const isLoading = hasFeatureFlag && !isHydrated;
									const isDisabled =
										hasFeatureFlag && isHydrated && !isFeatureEnabled(item.requiredFeature);

									if (isLoading) {
										return (
											<SidebarMenuItem key={item.id}>
												<SidebarMenuButton disabled tooltip={title}>
													<IconLoader2 className="size-5 animate-spin" />
													<span>{title}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										);
									}

									if (isDisabled) {
										return (
											<SidebarMenuItem key={item.id}>
												<SidebarMenuButton
													disabled
													tooltip={`${title} (Disabled)`}
													className="cursor-not-allowed opacity-50"
												>
													<Icon className="size-5" />
													<span>{title}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										);
									}

									return (
										<SidebarMenuItem key={item.id}>
											<SidebarMenuButton asChild isActive={isActive} tooltip={title}>
												<Link href={item.href}>
													<Icon className="size-5" />
													<span>{title}</span>
												</Link>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				);
			})}
		</>
	);
}
