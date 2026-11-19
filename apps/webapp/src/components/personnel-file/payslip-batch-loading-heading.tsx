"use client";

import { useTranslate } from "@tolgee/react";

export function PayslipBatchLoadingHeading() {
	const { t } = useTranslate();
	return (
		<h1 className="text-2xl font-semibold tracking-tight">
			{t("settings.personnelFiles.batch.title", "Payslip batch")}
		</h1>
	);
}
