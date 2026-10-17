"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["vehicles", "use", "assignments"] as const;
type VehicleSettingsTab = (typeof TABS)[number];

export function VehicleSettingsTabs({
	panels,
}: {
	panels: Record<VehicleSettingsTab, ReactNode>;
}) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const active =
		TABS.find((tab) => tab === searchParams.get("tab")) ?? "vehicles";
	const [visited, setVisited] = useState(
		() => new Set<VehicleSettingsTab>([active]),
	);
	function select(value: unknown) {
		const selected = TABS.find((tab) => tab === value);
		if (!selected) return;
		setVisited((previous) => new Set([...previous, active, selected]));
		const url = new URL(window.location.href);
		url.searchParams.set("tab", selected);
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}
	const labels: Record<VehicleSettingsTab, string> = {
		vehicles: t("settings.vehicles.title", "Vehicles"),
		use: t("settings.vehicleUse.title", "Vehicle use"),
		assignments: t("settings.workPolicies.tab.assignments", "Assignments"),
	};
	return (
		<Tabs value={active} onValueChange={select} className="min-w-0 gap-4">
			<div className="max-w-full overflow-x-auto">
				<TabsList aria-label={t("settings.vehicles.title", "Vehicles")}>
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
	);
}
