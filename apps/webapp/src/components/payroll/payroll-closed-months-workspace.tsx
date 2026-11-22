"use client";

import { useTranslate } from "@tolgee/react";
import type { ClosedMonthsOverview } from "@/app/[locale]/(app)/settings/closed-months/actions";
import { ClosedMonthsSettings } from "@/components/settings/closed-months/closed-months-settings";
import { PageHeader } from "@/components/ui/page-header";
import { PayrollWorkspaceTabs } from "./workspace/payroll-workspace-tabs";

/**
 * Restricted `/payroll` entry for custom-role holders who may close or reopen months
 * without org-admin status or an active payroll access grant (#1957). Lands directly
 * on the `Closed Months` tab without exposing restricted payroll totals, settlement,
 * or export tabs.
 */
export function PayrollClosedMonthsWorkspace({
	overview,
}: {
	overview: ClosedMonthsOverview;
}) {
	const { t } = useTranslate();

	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-4">
			<PageHeader
				title={t("payroll.title", "Payroll")}
				description={t(
					"settings.closedMonths.description",
					"Close months after payroll so their work and absences can no longer change",
				)}
			/>
			<PayrollWorkspaceTabs
				t={t}
				panels={{
					"closed-months": <ClosedMonthsSettings overview={overview} />,
				}}
			/>
		</div>
	);
}
