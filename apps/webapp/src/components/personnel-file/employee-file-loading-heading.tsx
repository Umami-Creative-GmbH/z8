"use client";
import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

export function EmployeeFileLoadingHeading() {
	const { t } = useTranslate();
	return (
		<PageHeader
			title={t("settings.personnelFiles.panel.title", "Personnel file")}
		/>
	);
}
