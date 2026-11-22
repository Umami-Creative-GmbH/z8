"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PayrollTranslate } from "./state";

const PAYROLL_WORKSPACE_TABS = [
	"overview",
	"days",
	"absences",
	"settlement",
	"export",
	"closed-months",
] as const;
export type PayrollWorkspaceTab = (typeof PAYROLL_WORKSPACE_TABS)[number];

function parsePayrollTab(
	value: string | null | undefined,
	visibleTabs: readonly PayrollWorkspaceTab[],
): PayrollWorkspaceTab {
	const fallback = visibleTabs[0] ?? "overview";
	return visibleTabs.find((tab) => tab === value) ?? fallback;
}

/**
 * The selected tab, kept in the `tab` search param so a reload, browser back or a
 * shared link opens the same tab.
 */
function usePayrollTabParam(visibleTabs: readonly PayrollWorkspaceTab[]) {
	const searchParams = useSearchParams();
	const tabParam = searchParams?.get("tab");
	const defaultTab = visibleTabs[0] ?? "overview";
	const [active, setActive] = useState(() => parsePayrollTab(tabParam, visibleTabs));
	const [seenTabParam, setSeenTabParam] = useState(tabParam);

	// History navigation changes the param without a tab click.
	if (tabParam !== seenTabParam) {
		setSeenTabParam(tabParam);
		setActive(parsePayrollTab(tabParam, visibleTabs));
	}

	// Ensure active tab remains valid if visibleTabs changes.
	const resolvedActive = visibleTabs.includes(active) ? active : defaultTab;

	function select(value: unknown) {
		const next = visibleTabs.find((tab) => tab === value);
		if (!next) return;
		setActive(next);
		const params = new URLSearchParams(window.location.search);
		if (next === defaultTab && defaultTab === "overview") params.delete("tab");
		else params.set("tab", next);
		const search = params.toString();
		window.history.replaceState(
			window.history.state,
			"",
			`${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
		);
	}

	return { active: resolvedActive, select };
}

export function PayrollWorkspaceTabs({
	panels,
	t,
}: {
	panels: Partial<Record<PayrollWorkspaceTab, ReactNode>>;
	t: PayrollTranslate;
}) {
	const visibleTabs = PAYROLL_WORKSPACE_TABS.filter((tab) => panels[tab] !== undefined);
	const { active, select } = usePayrollTabParam(visibleTabs);
	// A tab renders on first visit and then stays mounted, so its queries and drafts survive.
	const [visited, setVisited] = useState(() => new Set<PayrollWorkspaceTab>([active]));
	if (!visited.has(active)) setVisited(new Set([...visited, active]));

	const labels: Record<PayrollWorkspaceTab, string> = {
		overview: t("payroll.tabs.overview", "Overview"),
		days: t("payroll.tabs.days", "Days"),
		absences: t("payroll.tabs.absences", "Absences"),
		settlement: t("payroll.tabs.settlement", "Settlement"),
		export: t("payroll.tabs.export", "Export"),
		"closed-months": t("settings.closedMonths.title", "Closed months"),
	};

	return (
		<Tabs value={active} onValueChange={select} className="min-w-0 gap-4">
			<TabsList
				aria-label={t("payroll.tabs.label", "Payroll workspace sections")}
				className="w-full sm:w-fit"
			>
				{visibleTabs.map((tab) => (
					<TabsTrigger key={tab} value={tab}>
						{labels[tab]}
					</TabsTrigger>
				))}
			</TabsList>
			{visibleTabs.map((tab) => (
				<TabsContent key={tab} value={tab} keepMounted className="min-w-0">
					{active === tab || visited.has(tab) ? panels[tab] : null}
				</TabsContent>
			))}
		</Tabs>
	);
}

/** An empty tab, filled in by a later ticket. */
export function PayrollPlaceholderTab({ description }: { description: string }) {
	return (
		<div className="rounded-lg border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">
			{description}
		</div>
	);
}
