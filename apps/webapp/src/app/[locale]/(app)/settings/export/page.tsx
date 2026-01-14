import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ExportForm } from "@/components/settings/export/export-form";
import { ExportHistory } from "@/components/settings/export/export-history";
import { StorageSettingsForm } from "@/components/settings/export/storage-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isExportS3Configured } from "@/lib/storage/export-s3-client";
import { getTranslate } from "@/tolgee/server";
import { getExportHistoryAction, getStorageConfigAction } from "./actions";

async function ExportSettingsContent() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("settings.dataExport.featureName", "Data Export")} />
			</div>
		);
	}

	// Check if user has admin role
	const { getAuthContext } = await import("@/lib/auth-helpers");
	const authContext = await getAuthContext();

	if (!authContext?.employee || authContext.employee.role !== "admin") {
		redirect("/");
	}

	const organizationId = authContext.employee.organizationId;

	// Check S3 configuration (async, from database)
	const s3Configured = await isExportS3Configured(organizationId);

	// Get storage config for the form
	const storageConfigResult = await getStorageConfigAction(organizationId);
	const storageConfig = storageConfigResult.success ? storageConfigResult.data : null;

	// Get export history
	const historyResult = await getExportHistoryAction(organizationId);
	const exports = historyResult.success ? historyResult.data : [];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">{t("settings.dataExport.title", "Data Export")}</h1>
				<p className="text-muted-foreground">
					{t("settings.dataExport.description", "Export your organization's data")}
				</p>
			</div>

			<Tabs defaultValue={s3Configured ? "export" : "storage"} className="w-full">
				<TabsList>
					<TabsTrigger value="export">
						{t("settings.dataExport.tabs.newExport", "New Export")}
					</TabsTrigger>
					<TabsTrigger value="history">
						{t("settings.dataExport.tabs.exportHistory", "Export History")}
					</TabsTrigger>
					<TabsTrigger value="storage">
						{t("settings.dataExport.tabs.storageSettings", "Storage Settings")}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="export" className="mt-4">
					{s3Configured ? (
						<ExportForm organizationId={organizationId} />
					) : (
						<Card className="border-warning">
							<CardHeader>
								<CardTitle>
									{t("settings.dataExport.storageNotConfigured.title", "Storage Not Configured")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.dataExport.storageNotConfigured.description",
										"Configure S3 storage before creating exports",
									)}
								</CardDescription>
							</CardHeader>
						</Card>
					)}
				</TabsContent>
				<TabsContent value="history" className="mt-4">
					<ExportHistory exports={exports} organizationId={organizationId} />
				</TabsContent>
				<TabsContent value="storage" className="mt-4">
					<StorageSettingsForm organizationId={organizationId} initialConfig={storageConfig} />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function ExportSettingsLoading() {
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

export default function ExportSettingsPage() {
	return (
		<Suspense fallback={<ExportSettingsLoading />}>
			<ExportSettingsContent />
		</Suspense>
	);
}
