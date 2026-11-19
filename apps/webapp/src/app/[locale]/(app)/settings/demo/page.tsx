import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DemoDataWizard } from "@/components/settings/demo-data-wizard";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getOrganizationEmployees } from "./actions";
import { isDemoDataEnabledForOrganization } from "./demo-data-enabled";

async function DemoSettingsContent() {
	const [t, { organizationId }] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);
	const [demoDataEnabled, employeesResult] = await Promise.all([
		isDemoDataEnabledForOrganization(organizationId),
		getOrganizationEmployees(),
	]);

	if (!demoDataEnabled) {
		notFound();
	}

	// A failed read is not an empty organization: the wizard says so and blocks
	// generation, which targets these employees, until a retry loads them.
	const employeesLoadFailed = !employeesResult.success;
	const employees = employeesResult.success ? employeesResult.data : [];

	return (
		<div className="page-frame flex-1">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.demo.title", "Demo Data")}
					description={t(
						"settings.demo.description",
						"Generate sample data for testing or clear existing time-related data",
					)}
				/>

				<DemoDataWizard
					key={organizationId}
					employees={employees}
					employeesLoadFailed={employeesLoadFailed}
				/>
			</div>
		</div>
	);
}

function DemoSettingsLoading() {
	return (
		<SettingsPageSkeleton
			measure
			label={{
				labelKey: "common.loadingRegions.demoDataSettings",
				labelDefault: "Loading demo data settings",
			}}
		/>
	);
}

export default function DemoSettingsPage() {
	return (
		<Suspense fallback={<DemoSettingsLoading />}>
			<DemoSettingsContent />
		</Suspense>
	);
}
