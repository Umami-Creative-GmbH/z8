"use client";

import { useTranslate } from "@tolgee/react";
import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { normalizeAppPath } from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

function EmployeesLoadingHeading() {
	const { t } = useTranslate();
	const ownsHeading = normalizeAppPath(usePathname()) === "/settings/employees";

	return ownsHeading ? (
		<PageHeader
			title={t("settings.employees.title", "Employees")}
			className="px-4 pt-4 lg:px-6 lg:pt-6"
		/>
	) : null;
}

export default function EmployeesLoading() {
	return (
		<div data-testid="employees-shell" className="flex min-w-0 flex-1 flex-col overflow-hidden">
			<Suspense fallback={null}>
				<EmployeesLoadingHeading />
			</Suspense>
			<SettingsPageSkeleton
				variant="list"
				label={{
					labelKey: "common.loadingRegions.employees",
					labelDefault: "Loading employees",
				}}
			/>
		</div>
	);
}
