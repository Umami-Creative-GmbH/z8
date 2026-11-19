"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function SettingsTabbedPage<Tab extends string>({
	title,
	tabs,
	defaultTab,
}: {
	title: string;
	tabs: readonly {
		value: Tab;
		label: string;
		description: string;
		panel: ReactNode;
		/**
		 * Bounds a form or configuration panel at the settings measure. Leave it
		 * off for table-heavy panels, which use the full page frame.
		 */
		measure?: boolean;
	}[];
	defaultTab: Tab;
}) {
	const searchParams = useSearchParams();
	const active =
		tabs.find((tab) => tab.value === searchParams.get("tab"))?.value ??
		defaultTab;
	const [visited, setVisited] = useState(() => new Set<Tab>([active]));
	function select(value: unknown) {
		const selected = tabs.find((tab) => tab.value === value)?.value;
		if (!selected) return;
		setVisited((previous) => new Set([...previous, active, selected]));
		const url = new URL(window.location.href);
		url.searchParams.set("tab", selected);
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={title}
				description={tabs.find((tab) => tab.value === active)?.description}
			/>
			<Tabs value={active} onValueChange={select} className="min-w-0 gap-4">
				<div className="max-w-full overflow-x-auto">
					<TabsList aria-label={title}>
						{tabs.map((tab) => (
							<TabsTrigger key={tab.value} value={tab.value}>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</div>
				{tabs.map((tab) => (
					<TabsContent
						key={tab.value}
						value={tab.value}
						keepMounted
						className={cn("min-w-0", tab.measure && "page-measure")}
					>
						{active === tab.value || visited.has(tab.value) ? tab.panel : null}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
