import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { AuditConfigForm } from "@/components/settings/audit-export/audit-config-form";
import { AuditPackagesTable } from "@/components/settings/audit-export/audit-packages-table";
import { KeyManagement } from "@/components/settings/audit-export/key-management";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getAuditConfigAction, getAuditPackagesAction } from "./actions";

export const metadata = {
	title: "Audit Export Settings",
	description: "Configure GoBD-compliant audit export hardening with cryptographic proofs",
};

async function AuditExportSettingsContent() {
	await connection();

	// Parallelize all initial fetches to avoid waterfalls
	const [t, currentEmployee, authContext] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
		getAuthContext(),
	]);

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("settings.auditExport.featureName", "Audit Export")} />
			</div>
		);
	}

	if (!authContext?.employee || authContext.employee.role !== "admin") {
		redirect("/");
	}

	const organizationId = authContext.employee.organizationId;

	const [configResult, packagesResult] = await Promise.all([
		getAuditConfigAction(organizationId),
		getAuditPackagesAction(organizationId),
	]);

	const config = configResult.success ? configResult.data : null;
	const packages = packagesResult.success ? packagesResult.data : [];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.auditExport.title", "Audit Export")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.auditExport.description",
						"GoBD-compliant export hardening with digital signatures and WORM retention",
					)}
				</p>
			</div>

			<Tabs defaultValue="config" className="w-full">
				<TabsList>
					<TabsTrigger value="config">
						{t("settings.auditExport.tabs.configuration", "Configuration")}
					</TabsTrigger>
					<TabsTrigger value="packages">
						{t("settings.auditExport.tabs.packages", "Audit Packages")}
					</TabsTrigger>
					{config && (
						<TabsTrigger value="keys">
							{t("settings.auditExport.tabs.keys", "Signing Keys")}
						</TabsTrigger>
					)}
				</TabsList>

				<TabsContent value="config" className="mt-4 space-y-6">
					<AuditConfigForm organizationId={organizationId} initialConfig={config} />
				</TabsContent>

				<TabsContent value="packages" className="mt-4">
					<AuditPackagesTable organizationId={organizationId} packages={packages} />
				</TabsContent>

				{config && (
					<TabsContent value="keys" className="mt-4">
						<KeyManagement
							organizationId={organizationId}
							activeKeyFingerprint={config.signingKeyFingerprint}
							activeKeyVersion={config.signingKeyVersion}
						/>
					</TabsContent>
				)}
			</Tabs>
		</div>
	);
}

function AuditExportSettingsLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-72" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<Skeleton className="h-32 w-full" />
						<Skeleton className="h-10 w-32" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function AuditExportSettingsPage() {
	return (
		<Suspense fallback={<AuditExportSettingsLoading />}>
			<AuditExportSettingsContent />
		</Suspense>
	);
}
