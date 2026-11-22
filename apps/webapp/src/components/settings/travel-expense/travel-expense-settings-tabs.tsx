"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { usePendingExceptionCount } from "./pending-exceptions";

type TravelExpenseSettingsTab = "review" | "currencies" | "rates" | "exceptions" | "access";

/**
 * The travel expense settings cards grouped into tabs (#689), rendered through
 * `SettingsTabbedPage` while attaching the live pending-exceptions badge count.
 */
export function TravelExpenseSettingsTabs(panels: Record<TravelExpenseSettingsTab, ReactNode>) {
	const { t } = useTranslate();
	const pending = usePendingExceptionCount();
	const exceptionsLabel = t("travelExpenses.settings.tabs.exceptions", "Exceptions");

	return (
		<SettingsTabbedPage
			title={t("settings.travelExpenses.title", "Travel Expense Policies")}
			description={t(
				"settings.travelExpenses.pageDescription",
				"Choose who reviews expense reports, how missing receipts and foreign currencies are handled, which mileage and per diem rates apply, and which exceptions are authorized.",
			)}
			measure
			defaultTab="review"
			tabs={[
				{
					value: "review",
					label: t("travelExpenses.settings.tabs.review", "Review"),
					panel: <div className="flex flex-col gap-4">{panels.review}</div>,
				},
				{
					value: "currencies",
					label: t("travelExpenses.settings.tabs.currencies", "Currencies"),
					panel: <div className="flex flex-col gap-4">{panels.currencies}</div>,
				},
				{
					value: "rates",
					label: t("travelExpenses.settings.tabs.rates", "Rates"),
					panel: <div className="flex flex-col gap-4">{panels.rates}</div>,
				},
				{
					value: "exceptions",
					label: exceptionsLabel,
					badge: pending,
					ariaLabel:
						pending > 0
							? t("travelExpenses.settings.tabs.exceptionsPending", "{label}, {count} pending", {
									label: exceptionsLabel,
									count: pending,
								})
							: undefined,
					panel: <div className="flex flex-col gap-4">{panels.exceptions}</div>,
				},
				{
					value: "access",
					label: t("travelExpenses.settings.tabs.access", "Access"),
					panel: <div className="flex flex-col gap-4">{panels.access}</div>,
				},
			]}
		/>
	);
}
