"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";
import { normalizeAppPath } from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

export default function LoadingEmployees() {
	const { t } = useTranslate();
	const ownsHeading = normalizeAppPath(usePathname()) === "/settings/employees";
	return (
		<div className="space-y-6 p-4 lg:p-6">
			{ownsHeading ? <PageHeader title={t("settings.employees.title", "Employees")} /> : null}
			<p role="status">{t("settings.employees.directory.loading", "Loading employees...")}</p>
		</div>
	);
}
