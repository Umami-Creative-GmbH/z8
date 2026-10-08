"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePendingExceptionCount } from "./pending-exceptions";

const TABS = ["review", "currencies", "rates", "exceptions", "access"] as const;
type TravelExpenseSettingsTab = (typeof TABS)[number];

/** The tab named by `?tab=`; a missing or unknown value opens Review. */
function tabFromParam(value: string | null): TravelExpenseSettingsTab {
	return TABS.find((tab) => tab === value) ?? "review";
}

/** The Exceptions tab, with the count of waiting admin work while there is any. */
function ExceptionsTabTrigger({ label }: { label: string }) {
	const { t } = useTranslate();
	const pending = usePendingExceptionCount();
	return (
		<TabsTrigger
			value="exceptions"
			aria-label={
				pending > 0
					? t("travelExpenses.settings.tabs.exceptionsPending", "{label}, {count} pending", {
							label,
							count: pending,
						})
					: undefined
			}
		>
			{label}
			{pending > 0 && (
				<Badge aria-hidden="true" className="tabular-nums">
					{pending}
				</Badge>
			)}
		</TabsTrigger>
	);
}

/**
 * The travel expense settings cards grouped into tabs (#689). The active tab
 * lives in the `tab` search param; switching replaces the history entry, so
 * there is no navigation and no scroll jump.
 */
export function TravelExpenseSettingsTabs(panels: Record<TravelExpenseSettingsTab, ReactNode>) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const active = tabFromParam(searchParams.get("tab"));

	function select(value: unknown) {
		const params = new URLSearchParams(window.location.search);
		params.set("tab", tabFromParam(typeof value === "string" ? value : null));
		window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
	}

	const labels: Record<TravelExpenseSettingsTab, string> = {
		review: t("travelExpenses.settings.tabs.review", "Review"),
		currencies: t("travelExpenses.settings.tabs.currencies", "Currencies"),
		rates: t("travelExpenses.settings.tabs.rates", "Rates"),
		exceptions: t("travelExpenses.settings.tabs.exceptions", "Exceptions"),
		access: t("travelExpenses.settings.tabs.access", "Access"),
	};

	return (
		<Tabs value={active} onValueChange={select} className="gap-4">
			<div className="max-w-full overflow-x-auto">
				<TabsList>
					{TABS.map((tab) =>
						tab === "exceptions" ? (
							<ExceptionsTabTrigger key={tab} label={labels[tab]} />
						) : (
							<TabsTrigger key={tab} value={tab}>
								{labels[tab]}
							</TabsTrigger>
						),
					)}
				</TabsList>
			</div>
			{TABS.map((tab) => (
				<TabsContent key={tab} value={tab} className="flex flex-col gap-4">
					{panels[tab]}
				</TabsContent>
			))}
		</Tabs>
	);
}
