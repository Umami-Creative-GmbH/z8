"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["work", "changes"] as const;
type WorkPolicySettingsTab = (typeof TABS)[number];

export function WorkPolicySettingsTabs({
	panels,
}: {
	panels: Record<WorkPolicySettingsTab, ReactNode>;
}) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const active = TABS.find((tab) => tab === searchParams.get("tab")) ?? "work";
	const [visited, setVisited] = useState(
		() => new Set<WorkPolicySettingsTab>([active]),
	);
	function select(value: unknown) {
		const selected = TABS.find((tab) => tab === value);
		if (!selected) return;
		setVisited((previous) => new Set([...previous, active, selected]));
		const url = new URL(window.location.href);
		url.searchParams.set("tab", selected);
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}
	const labels: Record<WorkPolicySettingsTab, string> = {
		work: t("settings.workPolicies.title", "Work Policies"),
		changes: t("settings.changePolicies.title", "Change Policies"),
	};
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.workPolicies.title", "Work Policies")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{active === "work"
						? t(
								"settings.workPolicies.description",
								"Manage work schedules, time limits, and break requirements for your organization",
							)
						: t(
								"settings.changePolicies.description",
								"Control when employees can edit their time tracking entries and when manager approval is required",
							)}
				</p>
			</div>
			<Tabs value={active} onValueChange={select} className="min-w-0 gap-4">
				<div className="max-w-full overflow-x-auto">
					<TabsList
						aria-label={t("settings.workPolicies.title", "Work Policies")}
					>
						{TABS.map((tab) => (
							<TabsTrigger key={tab} value={tab}>
								{labels[tab]}
							</TabsTrigger>
						))}
					</TabsList>
				</div>
				{TABS.map((tab) => (
					<TabsContent key={tab} value={tab} keepMounted className="min-w-0">
						{active === tab || visited.has(tab) ? panels[tab] : null}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
