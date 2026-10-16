"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
		<div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				<p className="text-sm text-muted-foreground">
					{tabs.find((tab) => tab.value === active)?.description}
				</p>
			</div>
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
						className="min-w-0"
					>
						{active === tab.value || visited.has(tab.value) ? tab.panel : null}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
