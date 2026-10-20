"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { drivingLicenceRoles } from "@/lib/organization/driving-licence/visibility-rules";
import { useLinkedTabs } from "./use-linked-tabs";

type DrivingLicenceRoles = ReturnType<typeof drivingLicenceRoles>;

export type DrivingLicenceRoleTab = keyof DrivingLicenceRoles;
const ORDER: readonly DrivingLicenceRoleTab[] = ["myLicence", "checks", "planning"];
/** `?tab=` values, so a tab can be linked to. */
const PARAM: Record<DrivingLicenceRoleTab, string> = {
	myLicence: "my-licence",
	checks: "checks",
	planning: "planning",
};

/**
 * `/driving-licence` (#1428): one tab per role the visibility reader grants, in a fixed
 * order. A single role shows its content without a tab bar. Panels mount on first visit
 * and stay mounted, so unsaved input survives switching tabs.
 */
export function DrivingLicenceRoleTabs({
	roles,
	panels,
}: {
	roles: DrivingLicenceRoles;
	panels: Partial<Record<DrivingLicenceRoleTab, ReactNode>>;
}) {
	const { t } = useTranslate();
	const labels: Record<DrivingLicenceRoleTab, string> = {
		myLicence: t("drivingLicence.tabs.myLicence", "My licence"),
		checks: t("drivingLicence.tabs.checks", "Checks"),
		planning: t("drivingLicence.tabs.planning", "Planning"),
	};
	const title = t("drivingLicence.page.title", "Driving licence");
	const tabs = ORDER.filter((tab) => roles[tab]);
	const { active, select, mounted } = useLinkedTabs(tabs, (tab) => PARAM[tab]);

	return (
		<div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			{tabs.length === 1 ? (
				<div className="min-w-0">{panels[tabs[0]]}</div>
			) : tabs.length > 1 ? (
				<Tabs value={active} onValueChange={select} className="min-w-0 gap-4">
					<div className="max-w-full overflow-x-auto">
						<TabsList aria-label={title}>
							{tabs.map((tab) => (
								<TabsTrigger key={tab} value={tab}>
									{labels[tab]}
								</TabsTrigger>
							))}
						</TabsList>
					</div>
					{tabs.map((tab) => (
						<TabsContent key={tab} value={tab} keepMounted className="min-w-0">
							{mounted(tab) ? panels[tab] : null}
						</TabsContent>
					))}
				</Tabs>
			) : null}
		</div>
	);
}
