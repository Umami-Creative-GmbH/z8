"use client";

import { useTranslate } from "@tolgee/react";
import { SettingsCard } from "@/components/settings/settings-card";
import type {
	FeatureFlag,
	SettingsEntry,
	SettingsGroupConfig,
} from "@/components/settings/settings-config";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { SettingsSearch, useSettingsSearch } from "./settings-search";

interface SettingsGridProps {
	visibleSettings: SettingsEntry[];
	visibleGroups: SettingsGroupConfig[];
}

export function SettingsGrid({ visibleSettings, visibleGroups }: SettingsGridProps) {
	const { t } = useTranslate();
	const orgSettings = useOrganizationSettings();
	const isHydrated = orgSettings.isHydrated;
	const { query, setQuery, matchingGroups } = useSettingsSearch(visibleSettings, visibleGroups);

	const isFeatureEnabled = (feature: FeatureFlag | undefined): boolean => {
		if (!feature) return true;
		return orgSettings[feature] ?? false;
	};

	return (
		<div className="space-y-8">
			<SettingsSearch value={query} onChange={setQuery} />
			{matchingGroups.length === 0 ? (
				<p role="status" className="py-8 text-center text-sm text-muted-foreground">
					{t("settings.search.noResults", "No settings found. Try a different search.")}
				</p>
			) : null}
			{matchingGroups.map((group) => {
				return (
					<section key={group.id}>
						<h2 className="sticky top-0 z-10 -mx-1 mb-4 bg-background px-1 py-2 text-lg font-medium">
							{t(group.labelKey, group.labelDefault)}
						</h2>
						<div className="grid gap-4 md:grid-cols-2">
							{group.entries.map((entry) => {
								const hasFeatureFlag = !!entry.requiredFeature;
								const isLoading = hasFeatureFlag && !isHydrated;
								const isDisabled =
									hasFeatureFlag && isHydrated && !isFeatureEnabled(entry.requiredFeature);

								return (
									<SettingsCard
										key={entry.id}
										title={t(entry.titleKey, entry.titleDefault)}
										description={t(entry.descriptionKey, entry.descriptionDefault)}
										href={entry.href}
										icon={entry.icon}
										disabled={isDisabled}
										loading={isLoading}
									/>
								);
							})}
						</div>
					</section>
				);
			})}
		</div>
	);
}
