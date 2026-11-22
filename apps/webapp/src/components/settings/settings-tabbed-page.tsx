"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface SettingsTabbedPageTab<Tab extends string = string> {
	value: Tab;
	label: string;
	description?: ReactNode;
	panel: ReactNode;
	/**
	 * Bounds a form or configuration panel at the settings measure. Leave it
	 * off for table-heavy panels, which use the full page frame.
	 */
	measure?: boolean;
	/**
	 * Optional badge or count indicator rendered alongside the tab label.
	 * Positive numbers render a tabular count badge; zero or negative numbers
	 * render nothing. Custom ReactNodes render as provided.
	 */
	badge?: number | ReactNode;
	/**
	 * Optional accessible name for the tab trigger (for example,
	 * "Exceptions, 3 pending" when a decorative count badge is displayed).
	 */
	ariaLabel?: string;
	/**
	 * Optional classes applied to this tab's content panel container.
	 */
	panelClassName?: string;
	/**
	 * Excludes this tab from the rendered tab strip and panels when hidden by
	 * permissions or feature availability.
	 */
	hidden?: boolean;
}

export interface SettingsTabbedPageProps<Tab extends string> {
	title: string;
	/**
	 * Shared page-level description shown when the active tab does not define
	 * its own description.
	 */
	description?: ReactNode;
	tabs: readonly SettingsTabbedPageTab<Tab>[];
	/**
	 * Preferred initial tab when `?tab=` is absent or invalid. Falls back to
	 * the first visible tab when omitted or filtered out.
	 */
	defaultTab?: Tab;
	/**
	 * Bounds the entire tabbed surface (header, tab strip, and panels) at the
	 * settings measure inside `page-frame`.
	 */
	measure?: boolean;
}

function renderTabBadge(badge: number | ReactNode, hasAriaLabel: boolean): ReactNode {
	if (typeof badge === "number") {
		if (badge <= 0) return null;
		return (
			<Badge aria-hidden={hasAriaLabel || undefined} className="tabular-nums">
				{badge}
			</Badge>
		);
	}
	return badge ?? null;
}

export function SettingsTabbedPage<Tab extends string>({
	title,
	description,
	tabs,
	defaultTab,
	measure = false,
}: SettingsTabbedPageProps<Tab>) {
	const searchParams = useSearchParams();
	const visibleTabs = tabs.filter((tab) => !tab.hidden);
	const fallbackTab =
		(defaultTab !== undefined
			? visibleTabs.find((tab) => tab.value === defaultTab)?.value
			: undefined) ?? visibleTabs[0]?.value;
	const active =
		visibleTabs.find((tab) => tab.value === searchParams.get("tab"))?.value ?? fallbackTab;
	const [visited, setVisited] = useState(() => new Set<Tab>(active ? [active] : []));

	function select(value: unknown) {
		const selected = visibleTabs.find((tab) => tab.value === value)?.value;
		if (!selected) return;
		setVisited((previous) => new Set([...previous, ...(active ? [active] : []), selected]));
		const url = new URL(window.location.href);
		url.searchParams.set("tab", selected);
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}

	const activeTab = visibleTabs.find((tab) => tab.value === active);
	const headerDescription = activeTab?.description ?? description;

	const content = (
		<>
			<PageHeader title={title} description={headerDescription} />
			<Tabs value={active} onValueChange={select} className="min-w-0 flex-1 gap-4">
				<div className="max-w-full overflow-x-auto">
					<TabsList aria-label={title}>
						{visibleTabs.map((tab) => {
							const hasAriaLabel = Boolean(tab.ariaLabel);
							const badge = renderTabBadge(tab.badge, hasAriaLabel);
							return (
								<TabsTrigger key={tab.value} value={tab.value} aria-label={tab.ariaLabel}>
									{tab.label}
									{badge ? <> {badge}</> : null}
								</TabsTrigger>
							);
						})}
					</TabsList>
				</div>
				{visibleTabs.map((tab) => (
					<TabsContent
						key={tab.value}
						value={tab.value}
						keepMounted
						className={cn("min-w-0", !measure && tab.measure && "page-measure", tab.panelClassName)}
					>
						{active === tab.value || visited.has(tab.value) ? tab.panel : null}
					</TabsContent>
				))}
			</Tabs>
		</>
	);

	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			{measure ? (
				<div className="page-measure flex min-w-0 flex-1 flex-col gap-6">{content}</div>
			) : (
				content
			)}
		</div>
	);
}
