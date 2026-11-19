"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { normalizeAppPath } from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

export default function EmployeesError({ reset }: { reset: () => void }) {
	const { t } = useTranslate();
	const ownsHeading = normalizeAppPath(usePathname()) === "/settings/employees";
	return (
		<div className="page-frame space-y-6">
			{ownsHeading ? <PageHeader title={t("settings.employees.title", "Employees")} /> : null}
			<div role="alert" className="space-y-3 rounded-lg border p-4">
				<p>
					{t("settings.employees.directory.loadFailed", "Employee directory could not be loaded")}
				</p>
				<Button onClick={reset}>{t("common.retry", "Try again")}</Button>
			</div>
		</div>
	);
}
