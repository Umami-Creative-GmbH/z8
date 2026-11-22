"use client";

import { useTranslate } from "@tolgee/react";
import { SettingsCard } from "@/components/settings/settings-card";
import {
	type FeatureFlag,
	isSettingFeatureBypassed,
	type SettingsEntry,
	type SettingsGroupConfig,
} from "@/components/settings/settings-config";
import { PageHeader } from "@/components/ui/page-header";
import {
	resolveSettingsCapabilitiesInput,
	type SettingsCapabilities,
} from "@/lib/settings/capabilities";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { SettingsSearch, SettingsSearchEmpty, useSettingsSearch } from "./settings-search";

interface SettingsGridProps {
	visibleSettings: SettingsEntry[];
	visibleGroups: SettingsGroupConfig[];
	/** The viewer reaches Organization settings, where features are switched on. */
	canChangeFeatures?: boolean;
	settingsCapabilities?: Partial<SettingsCapabilities>;
}

export function SettingsGrid({
	visibleSettings,
	visibleGroups,
	canChangeFeatures = false,
	settingsCapabilities,
}: SettingsGridProps) {
	const { t } = useTranslate();
	const orgSettings = useOrganizationSettings();
	const isHydrated = orgSettings.isHydrated;
	const resolvedCapabilities = resolveSettingsCapabilitiesInput(settingsCapabilities);
	const { query, setQuery, matchingGroups } = useSettingsSearch(visibleSettings, visibleGroups);

	const isFeatureEnabled = (feature: FeatureFlag | undefined): boolean => {
		if (!feature) return true;
		return orgSettings[feature] ?? false;
	};

	return (
		<div className="space-y-6">
			<PageHeader title={t("settings.title", "Settings")} />
			<SettingsSearch value={query} onChange={setQuery} />
			{matchingGroups.length === 0 ? (
				<SettingsSearchEmpty onClear={() => setQuery("")} className="py-4" />
			) : null}
			<div className="space-y-8">
				{matchingGroups.map((group) => {
					return (
						<section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
							<h2
								id={`settings-group-${group.id}`}
								className="sticky top-0 z-10 -mx-1 mb-4 bg-background px-1 py-2 text-lg font-medium"
							>
								{t(group.labelKey, group.labelDefault)}
							</h2>
							<ul className="grid gap-4 md:grid-cols-2">
								{group.entries.map((entry) => {
									const hasFeatureFlag = !!entry.requiredFeature;
									const isFeatureBypassed = isSettingFeatureBypassed(entry, resolvedCapabilities);
									const isLoading = hasFeatureFlag && !isFeatureBypassed && !isHydrated;
									const isDisabled =
										hasFeatureFlag &&
										!isFeatureBypassed &&
										isHydrated &&
										!isFeatureEnabled(entry.requiredFeature);

									return (
										<li key={entry.id} className="min-w-0">
											<SettingsCard
												title={t(entry.titleKey, entry.titleDefault)}
												description={t(entry.descriptionKey, entry.descriptionDefault)}
												href={entry.href}
												icon={entry.icon}
												disabled={isDisabled}
												loading={isLoading}
												requiredFeature={entry.requiredFeature}
												canChangeFeatures={canChangeFeatures}
											/>
										</li>
									);
								})}
							</ul>
						</section>
					);
				})}
			</div>
		</div>
	);
}
