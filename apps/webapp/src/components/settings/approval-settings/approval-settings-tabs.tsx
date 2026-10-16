"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
	"policies",
	"groups",
	"escalation",
	"attention",
	"channels",
	"history",
] as const;
export type ApprovalSettingsTab = (typeof TABS)[number];

export function ApprovalSettingsTabs({
	panels,
}: {
	panels: Partial<Record<ApprovalSettingsTab, ReactNode>>;
}) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const tabs = TABS.filter((tab) => panels[tab] != null);
	const active = tabs.find((tab) => tab === searchParams.get("tab")) ?? tabs[0];

	const [visited, setVisited] = useState(() => new Set(active ? [active] : []));

	function select(value: unknown) {
		const selected = tabs.find((tab) => tab === value);
		if (!selected) return;
		setVisited(
			(previous) =>
				new Set([...previous, ...(active ? [active] : []), selected]),
		);
		const url = new URL(window.location.href);
		url.searchParams.set("tab", String(value));
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}

	const labels: Record<ApprovalSettingsTab, string> = {
		policies: t("settings.approvalPolicies.title", "Approval Policies"),
		groups: t("settings.employeeGroups.title", "Employee Groups"),
		escalation: t("settings.approvalEscalation.title", "Approval Escalation"),
		attention: t(
			"settings.approvalEscalation.attention.title",
			"Needs attention",
		),
		channels: t(
			"settings.approvalEscalation.channels.title",
			"Channel delivery preferences",
		),
		history: t("settings.approvalEscalation.revisions.title", "Policy history"),
	};

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("settings.approvalEscalation.attention.approvalType", "Approval")}
			</h1>
			<Tabs value={active} onValueChange={select} className="min-w-0 gap-4">
				<div className="max-w-full overflow-x-auto">
					<TabsList
						aria-label={t(
							"settings.approvalEscalation.attention.approvalType",
							"Approval",
						)}
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
						{active === tab || visited.has(tab) ? panels[tab] : null}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
