import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { AuditConfigForm } from "@/components/settings/audit-export/audit-config-form";
import { AuditPackGeneratorCard } from "@/components/settings/audit-export/audit-pack-generator-card";
import { AuditPackagesTable } from "@/components/settings/audit-export/audit-packages-table";
import { KeyManagement } from "@/components/settings/audit-export/key-management";
import { AuditLogViewer } from "@/components/settings/audit-log-viewer";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getAuditConfigAction, getAuditPackagesAction } from "./actions";

export const metadata = {
	title: "Audit Settings",
	description:
		"Configure GoBD-compliant audit export hardening with cryptographic proofs",
};

async function AuditExportSettingsContent() {
	// Parallelize all initial fetches to avoid waterfalls
	const [t, orgAccess] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);
	const { organizationId } = orgAccess;
	const ownedOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});
	const organizationTimezone = ownedOrganization?.timezone ?? "UTC";

	const [configResult, packagesResult] = await Promise.all([
		getAuditConfigAction(organizationId),
		getAuditPackagesAction(organizationId),
	]);

	const config = configResult.success ? configResult.data : null;
	const packages = packagesResult.success ? packagesResult.data : [];

	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.navigation.audit.title", "Audit")}
			defaultTab="activity"
			tabs={[
				{
					value: "activity",
					label: t("settings.navigation.audit.activity", "Activity"),
					description: t(
						"settings.auditLog.description",
						"View and search all actions performed in your organization",
					),
					panel: (
						<AuditLogViewer
							organizationId={organizationId}
							organizationTimezone={organizationTimezone}
						/>
					),
				},
				{
					value: "config",
					label: t("settings.auditExport.tabs.configuration", "Configuration"),
					description: t(
						"settings.auditExport.description",
						"GoBD-compliant export hardening with digital signatures and WORM retention",
					),
					panel: (
						<AuditConfigForm
							organizationId={organizationId}
							initialConfig={config}
						/>
					),
				},
				{
					value: "packages",
					label: t("settings.auditExport.tabs.packages", "Audit Packages"),
					description: t(
						"settings.navigation.audit.packagesDescription",
						"Generate and review signed audit packages",
					),
					panel: (
						<div className="space-y-6">
							<AuditPackGeneratorCard
								organizationId={organizationId}
								organizationTimezone={organizationTimezone}
							/>
							<AuditPackagesTable
								organizationId={organizationId}
								packages={packages}
							/>
						</div>
					),
				},
				...(config
					? [
							{
								value: "keys",
								label: t("settings.auditExport.tabs.keys", "Signing Keys"),
								description: t(
									"settings.navigation.audit.keysDescription",
									"Manage the signing keys used by audit exports",
								),
								panel: (
									<KeyManagement
										organizationId={organizationId}
										activeKeyFingerprint={config.signingKeyFingerprint}
										activeKeyVersion={config.signingKeyVersion}
									/>
								),
							},
						]
					: []),
			]}
		/>
	);
}

function AuditExportSettingsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.auditExportSettings",
				labelDefault: "Loading audit export settings",
			}}
		/>
	);
}

export default function AuditExportSettingsPage() {
	return (
		<Suspense fallback={<AuditExportSettingsLoading />}>
			<AuditExportSettingsContent />
		</Suspense>
	);
}
