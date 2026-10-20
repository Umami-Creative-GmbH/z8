"use client";

import { IconInfoCircle, IconSteeringWheel } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IntendedDriverAdminData } from "@/lib/organization/driving-licence/intended-driver-rules";
import type { DrivingLicenceSettingsVisibility } from "@/lib/organization/driving-licence/visibility-rules";
import { IntendedDriverSettings } from "./intended-driver-settings";
import { DrivingLicenceReassignmentAlert } from "./reassignment-alert";

/** `?tab=` values, in display order, so each tab can be linked to. */
export const DRIVING_LICENCE_SETTINGS_TABS = [
	"policy",
	"intended-drivers",
	"verifiers",
	"retention",
] as const;
export type DrivingLicenceSettingsTab = (typeof DRIVING_LICENCE_SETTINGS_TABS)[number];

/**
 * `/settings/driving-licence` (#1427), laid out like vehicle use settings. While control is
 * off (`retention_only`) only Retention & holds is offered, under the off notice; otherwise
 * open verifier-responsibility tasks show as an alert above the tabs. Panels mount on first
 * visit and stay mounted, so unsaved input survives switching tabs.
 */
export function DrivingLicenceSettingsTabs({
	settings,
	panels,
}: {
	settings: Exclude<DrivingLicenceSettingsVisibility, "hidden">;
	panels: Partial<Record<DrivingLicenceSettingsTab, ReactNode>>;
}) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const title = t("drivingLicence.title", "Driving licence control");
	const labels: Record<DrivingLicenceSettingsTab, string> = {
		policy: t("drivingLicence.settingsTabs.policy", "Policy"),
		"intended-drivers": t("drivingLicence.settingsTabs.intendedDrivers", "Intended drivers"),
		verifiers: t("drivingLicence.settingsTabs.verifiers", "Verifiers"),
		retention: t("drivingLicence.settingsTabs.retention", "Retention & holds"),
	};
	const descriptions: Record<DrivingLicenceSettingsTab, string> = {
		policy: t(
			"drivingLicence.settingsTabs.policyDescription",
			"The routine check interval, reminder lead times and the evidence retention period.",
		),
		"intended-drivers": t(
			"drivingLicence.settingsTabs.intendedDriversDescription",
			"Decide who needs original licence checks: the whole organization, a primary team or one employee.",
		),
		verifiers: t(
			"drivingLicence.settingsTabs.verifiersDescription",
			"Who checks whose licence, optionally until a set date.",
		),
		retention: t(
			"drivingLicence.settingsTabs.retentionDescription",
			"Retained check records, legal-case holds and evidence cleanup.",
		),
	};
	const tabs =
		settings === "retention_only" ? (["retention"] as const) : DRIVING_LICENCE_SETTINGS_TABS;
	const active = tabs.find((tab) => tab === searchParams.get("tab")) ?? tabs[0];
	const [visited, setVisited] = useState(() => new Set<DrivingLicenceSettingsTab>([active]));

	function select(value: unknown) {
		const selected = tabs.find((tab) => tab === value);
		if (!selected) return;
		setVisited((previous) => new Set([...previous, active, selected]));
		const url = new URL(window.location.href);
		url.searchParams.set("tab", selected);
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				<p className="text-sm text-muted-foreground">{descriptions[active]}</p>
			</div>
			{settings === "retention_only" ? (
				<Alert role="status">
					<IconInfoCircle aria-hidden="true" />
					<AlertTitle>{t("drivingLicence.off.title", "Driving licence control is off")}</AlertTitle>
					<AlertDescription>
						{t(
							"drivingLicence.off.description",
							"Nobody sees driving licence control and no reminders are sent. Intended drivers, verifier grants, check records and authorizations are kept, and evidence cleanup continues under the saved retention period. Only Retention & holds is available until it is switched on again.",
						)}
					</AlertDescription>
				</Alert>
			) : (
				<DrivingLicenceReassignmentAlert onAssign={() => select("verifiers")} />
			)}
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
						{active === tab || visited.has(tab) ? panels[tab] : null}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}

/**
 * The Intended drivers tab: the assignment cards, led by an explanation of the three
 * choices while nobody is assigned yet (where the first activation lands).
 */
export function DrivingLicenceIntendedDriversPanel({ data }: { data: IntendedDriverAdminData }) {
	const { t } = useTranslate();
	return (
		<div className="space-y-6">
			{data.assignments.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconSteeringWheel aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>
							{t(
								"drivingLicence.settingsTabs.intendedDriversEmpty.title",
								"Nobody is an intended driver yet",
							)}
						</EmptyTitle>
						<EmptyDescription>
							{t(
								"drivingLicence.settingsTabs.intendedDriversEmpty.description",
								"Set Required for the whole organization, for a primary team or for one employee. The most specific choice wins, and Not required excludes a team or employee from a broader one. Only intended drivers get checks, reminders and a driving status.",
							)}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			<IntendedDriverSettings data={data} />
		</div>
	);
}
