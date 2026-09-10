import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DemoDataWizard } from "@/components/settings/demo-data-wizard";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { assertDemoDataEnabledForOrganization, getOrganizationEmployees } from "./actions";

async function DemoSettingsContent() {
	const [t, { organizationId }] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);
	const [demoDataEnabled, employeesResult] = await Promise.all([
		assertDemoDataEnabledForOrganization(organizationId),
		getOrganizationEmployees(organizationId),
	]);

	if (!demoDataEnabled) {
		notFound();
	}

	const employees = employeesResult.success ? employeesResult.data : [];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">{t("settings.demo.title", "Demo Data")}</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.demo.description",
						"Generate sample data for testing or clear existing time-related data",
					)}
				</p>
			</div>

			<DemoDataWizard key={organizationId} organizationId={organizationId} employees={employees} />
		</div>
	);
}

function DemoSettingsLoading() {
	return <SettingsPageSkeleton label="Loading demo data settings" />;
}

export default function DemoSettingsPage() {
	return (
		<Suspense fallback={<DemoSettingsLoading />}>
			<DemoSettingsContent />
		</Suspense>
	);
}
