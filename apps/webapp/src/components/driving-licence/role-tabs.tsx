"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DrivingLicenceRoles } from "@/lib/organization/driving-licence/visibility-rules";
import { DrivingLicencePageTitle } from "./page-scope";
import { useLinkedTabs } from "./use-linked-tabs";

/** The team roles: My driving licence has its own page (#1937). */
export type DrivingLicenceTeamTab = Exclude<keyof DrivingLicenceRoles, "myLicence">;
const ORDER: readonly DrivingLicenceTeamTab[] = ["checks", "planning"];

/**
 * `/team/driving-licence` (#1428, #1937): one tab per team role the visibility reader grants,
 * Checks before Planning. `?tab=checks|planning` links to a tab. A single role shows its content
 * without a tab bar. Panels mount on first visit and stay mounted, so unsaved input survives
 * switching tabs.
 */
export function DrivingLicenceTeamTabs({
	roles,
	panels,
}: {
	roles: Pick<DrivingLicenceRoles, DrivingLicenceTeamTab>;
	panels: Partial<Record<DrivingLicenceTeamTab, ReactNode>>;
}) {
	const { t } = useTranslate();
	const labels: Record<DrivingLicenceTeamTab, string> = {
		checks: t("drivingLicence.tabs.checks", "Checks"),
		planning: t("drivingLicence.tabs.planning", "Planning"),
	};
	const tabs = ORDER.filter((tab) => roles[tab]);
	const { active, select, mounted } = useLinkedTabs(tabs);

	return (
		<div className="page-frame flex min-w-0 flex-col gap-6">
			<PageHeader
				title={<DrivingLicencePageTitle kind="team" />}
				description={t(
					"drivingLicence.teamPage.scope",
					"Original licence checks for the intended drivers you verify, and driving status for planning. Each view follows your current access.",
				)}
			/>
			{tabs.length === 1 ? (
				<div className="min-w-0">{panels[tabs[0]]}</div>
			) : tabs.length > 1 ? (
				<Tabs value={active} onValueChange={select} className="min-w-0 gap-4">
					<div className="max-w-full overflow-x-auto">
						<TabsList
							aria-label={t("drivingLicence.teamPage.title", "Driving licences")}
						>
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
