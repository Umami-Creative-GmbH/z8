"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Later slices of #767 add their tabs here (reminders #869, retention #870).
const TABS = ["access", "reminders", "retention"] as const;
type PersonnelFileSettingsTab = (typeof TABS)[number];

/** The tab named by `?tab=`; a missing or unknown value opens Access. */
function tabFromParam(value: string | null): PersonnelFileSettingsTab {
	return TABS.find((tab) => tab === value) ?? "access";
}

/**
 * The personnel file settings grouped into tabs, like the travel expense
 * settings (#689). The active tab lives in the `tab` search param; switching
 * replaces the history entry.
 */
export function PersonnelFileSettingsTabs(panels: Record<PersonnelFileSettingsTab, ReactNode>) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const active = tabFromParam(searchParams.get("tab"));

	function select(value: unknown) {
		const params = new URLSearchParams(window.location.search);
		params.set("tab", tabFromParam(typeof value === "string" ? value : null));
		window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
	}

	const labels: Record<PersonnelFileSettingsTab, string> = {
		access: t("settings.personnelFiles.tabs.access", "Access"),
		reminders: t("settings.personnelFiles.tabs.reminders", "Reminders"),
		retention: t("settings.personnelFiles.tabs.retention", "Retention"),
	};

	return (
		<Tabs value={active} onValueChange={select} className="gap-4">
			<div className="max-w-full overflow-x-auto">
				<TabsList>
					{TABS.map((tab) => (
						<TabsTrigger key={tab} value={tab}>
							{labels[tab]}
						</TabsTrigger>
					))}
				</TabsList>
			</div>
			{TABS.map((tab) => (
				<TabsContent key={tab} value={tab} className="flex flex-col gap-4">
					{panels[tab]}
				</TabsContent>
			))}
		</Tabs>
	);
}
