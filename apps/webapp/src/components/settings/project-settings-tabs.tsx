"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["projects", "templates"] as const;
type ProjectSettingsTab = (typeof TABS)[number];

/** The tab named by `?tab=`; a missing or unknown value opens Projects. */
function tabFromParam(value: string | null): ProjectSettingsTab {
	return TABS.find((tab) => tab === value) ?? "projects";
}

/**
 * The project settings for org owners and admins (#878): projects, and the
 * project templates only they manage. The active tab lives in the `tab`
 * search param; switching replaces the history entry.
 */
export function ProjectSettingsTabs(panels: Record<ProjectSettingsTab, ReactNode>) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const active = tabFromParam(searchParams.get("tab"));

	function select(value: unknown) {
		const params = new URLSearchParams(window.location.search);
		params.set("tab", tabFromParam(typeof value === "string" ? value : null));
		window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
	}

	const labels: Record<ProjectSettingsTab, string> = {
		projects: t("settings.projects.tabs.projects", "Projects"),
		templates: t("settings.projects.tabs.templates", "Templates"),
	};

	return (
		<Tabs value={active} onValueChange={select} className="flex flex-1 flex-col gap-0">
			<div className="max-w-full overflow-x-auto px-4 pt-4">
				<TabsList>
					{TABS.map((tab) => (
						<TabsTrigger key={tab} value={tab}>
							{labels[tab]}
						</TabsTrigger>
					))}
				</TabsList>
			</div>
			{TABS.map((tab) => (
				<TabsContent key={tab} value={tab} className="flex flex-1 flex-col">
					{panels[tab]}
				</TabsContent>
			))}
		</Tabs>
	);
}
