"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { activeNavHref } from "@/components/nav-active";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import {
	resolveSettingsCapabilitiesInput,
	type SettingsCapabilities,
} from "@/lib/settings/capabilities";
import { Link, usePathname } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import {
	canReachFeatureSwitches,
	type FeatureFlag,
	getResolvedSettingsVisibility,
	isSettingFeatureBypassed,
} from "./settings-config";
import { SettingsFeatureOffNotice } from "./settings-feature-off-notice";
import { SETTINGS_ICON_MAP } from "./settings-icons";
import { SettingsSearch, SettingsSearchEmpty, useSettingsSearch } from "./settings-search";

export interface SettingsNavProps {
	settingsAccess: SettingsAccess | null;
	billingEnabled: boolean;
	settingsCapabilities?: Partial<SettingsCapabilities>;
}

export function SettingsNav({
	settingsAccess,
	billingEnabled,
	settingsCapabilities,
}: SettingsNavProps) {
	const pathname = usePathname();
	const { t } = useTranslate();
	const orgSettings = useOrganizationSettings();
	const isHydrated = orgSettings.isHydrated;
	const resolvedCapabilities = resolveSettingsCapabilitiesInput(settingsCapabilities);

	const { visibleSettings, visibleGroups } = getResolvedSettingsVisibility({
		settingsAccess,
		billingEnabled,
		featureFlags: isHydrated ? orgSettings : undefined,
		settingsCapabilities: resolvedCapabilities,
	});

	const { query, setQuery, matchingGroups } = useSettingsSearch(visibleSettings, visibleGroups);

	const activeHref = activeNavHref(
		pathname,
		visibleSettings.map((entry) => entry.href),
	);

	const isFeatureEnabled = (feature: FeatureFlag | undefined): boolean => {
		if (!feature) return true;
		return orgSettings[feature] ?? false;
	};

	return (
		<nav aria-label={t("settings.nav.label", "Settings navigation")}>
			<div className="p-3">
				<SettingsSearch value={query} onChange={setQuery} />
			</div>
			{matchingGroups.length === 0 ? (
				<SettingsSearchEmpty onClear={() => setQuery("")} className="px-4 py-3" />
			) : null}
			{matchingGroups.map((group) => {
				return (
					<SidebarGroup key={group.id} className="p-0">
						<SidebarGroupLabel className="sticky top-0 z-10 rounded-none bg-card px-4">
							{t(group.labelKey, group.labelDefault)}
						</SidebarGroupLabel>
						<SidebarGroupContent className="px-2 pb-2">
							<SidebarMenu>
								{group.entries.map((item) => {
									const isActive = activeHref === item.href;
									const title = t(item.titleKey, item.titleDefault);
									const Icon = SETTINGS_ICON_MAP[item.icon];
									const hasFeatureFlag = !!item.requiredFeature;
									const isFeatureBypassed = isSettingFeatureBypassed(item, resolvedCapabilities);
									const isLoading = hasFeatureFlag && !isFeatureBypassed && !isHydrated;
									const isDisabled =
										hasFeatureFlag &&
										!isFeatureBypassed &&
										isHydrated &&
										!isFeatureEnabled(item.requiredFeature);

									if (isLoading) {
										return (
											<SidebarMenuItem key={item.id}>
												<SidebarMenuButton disabled aria-busy="true" tooltip={title}>
													<IconLoader2
														className="size-5 animate-spin motion-reduce:animate-none"
														aria-hidden="true"
													/>
													<span>{title}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										);
									}

									if (isDisabled && item.requiredFeature) {
										return (
											<SidebarMenuItem key={item.id}>
												<SidebarMenuButton
													disabled
													tooltip={t("settings.nav.disabledEntry", "{title} (disabled)", {
														title,
													})}
													className="cursor-not-allowed opacity-50"
												>
													<Icon className="size-5" aria-hidden="true" />
													<span>{title}</span>
												</SidebarMenuButton>
												<SettingsFeatureOffNotice
													feature={item.requiredFeature}
													settingTitle={title}
													canChangeFeatures={canReachFeatureSwitches(settingsAccess)}
													compact
													className="pr-2 pb-1 pl-9"
												/>
											</SidebarMenuItem>
										);
									}

									return (
										<SidebarMenuItem key={item.id}>
											<SidebarMenuButton asChild isActive={isActive} tooltip={title}>
												<Link href={item.href} aria-current={isActive ? "page" : undefined}>
													<Icon className="size-5" aria-hidden="true" />
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
		</nav>
	);
}
