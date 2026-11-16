"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

/** Safe task title while the independent batch admission/read is pending. */
export function PayslipBatchesHeading() {
	const { t } = useTranslate();
	return <PageHeader title={t("settings.personnelFiles.batch.pageTitle", "Payslip batches")} />;
}
