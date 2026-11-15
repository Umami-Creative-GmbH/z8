"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

/** Keep the task identifiable before the current employee is admitted. */
export function EmployeeBalanceLoadingHeading() {
	const { t } = useTranslate();
	return <PageHeader title={t("settings.employees.workBalance.title", "Work balance")} />;
}
