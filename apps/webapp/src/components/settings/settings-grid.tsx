"use client";

import { useCallback } from "react";
import { SettingsCard } from "@/components/settings/settings-card";
import {
	type FeatureFlag,
	getEntriesByGroup,
	type SettingsEntry,
	type SettingsGroupConfig,
} from "@/components/settings/settings-config";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

interface SettingsGridProps {
	visibleSettings: SettingsEntry[];
	visibleGroups: SettingsGroupConfig[];
}

export function SettingsGrid({ visibleSettings, visibleGroups }: SettingsGridProps) {
	const orgSettings = useOrganizationSettings();
	const isHydrated = orgSettings.isHydrated;

	// Memoize to prevent recreation on every render
	const isFeatureEnabled = useCallback(
		(feature: FeatureFlag | undefined): boolean => {
			if (!feature) return true;
			return orgSettings[feature] ?? false;
		},
		[orgSettings],
	);

	return (
		<div className="space-y-8">
			{visibleGroups.map((group) => {
				const groupEntries = getEntriesByGroup(visibleSettings, group.id);

				if (groupEntries.length === 0) return null;

				return (
					<section key={group.id}>
						<h2 className="text-lg font-medium mb-4">{group.labelDefault}</h2>
						<div className="grid gap-4 md:grid-cols-2">
							{groupEntries.map((entry) => {
								const hasFeatureFlag = !!entry.requiredFeature;
								const isLoading = hasFeatureFlag && !isHydrated;
								const isDisabled =
									hasFeatureFlag && isHydrated && !isFeatureEnabled(entry.requiredFeature);

								return (
									<SettingsCard
										key={entry.id}
										title={entry.titleDefault}
										description={entry.descriptionDefault}
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
