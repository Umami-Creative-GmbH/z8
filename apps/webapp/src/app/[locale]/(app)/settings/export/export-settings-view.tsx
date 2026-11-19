import { ExportForm } from "@/components/settings/export/export-form";
import { ExportHistory } from "@/components/settings/export/export-history";
import { StorageSettingsForm } from "@/components/settings/export/storage-settings-form";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isExportS3Configured } from "@/lib/storage/export-s3-client";
import { getTranslate } from "@/tolgee/server";
import { getExportHistoryAction, getStorageConfigAction } from "./actions";

/**
 * Loads and renders the data export settings for an organization the caller
 * has already authorized. Without `initialTab`, the page opens on New Export,
 * or on Storage Settings while storage is not configured.
 */
export async function renderExportSettingsView({
	organizationId,
	initialTab,
}: {
	organizationId: string;
	initialTab?: "history";
}) {
	// Parallelize translations, S3 config, storage config, and export history fetches
	const [t, s3Configured, storageConfigResult, historyResult] =
		await Promise.all([
			getTranslate(),
			isExportS3Configured(organizationId),
			getStorageConfigAction(),
			getExportHistoryAction(),
		]);

	const storageConfig = storageConfigResult.success
		? storageConfigResult.data
		: null;
	const exports = historyResult.success ? historyResult.data : [];

	const title = t("settings.dataExport.title", "Data Export");

	return (
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
				<PageHeader
					title={title}
					description={t(
						"settings.dataExport.description",
						"Export your organization's data",
					)}
				/>

				<Tabs
					defaultValue={initialTab ?? (s3Configured ? "export" : "storage")}
					className="w-full min-w-0"
				>
					<TabsList aria-label={title}>
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
							<ExportForm />
						) : (
							<Alert>
								<IconAlertTriangle aria-hidden="true" />
								<AlertTitle>
									{t(
										"settings.dataExport.storageNotConfigured.title",
										"Storage Not Configured",
									)}
								</AlertTitle>
								<AlertDescription>
									{t(
										"settings.dataExport.storageNotConfigured.descriptionWithTab",
										"Configure S3 storage on the Storage Settings tab before creating exports.",
									)}
								</AlertDescription>
							</Alert>
						)}
					</TabsContent>
					<TabsContent value="history" className="mt-4">
						<ExportHistory exports={exports} />
					</TabsContent>
					<TabsContent value="storage" className="mt-4">
						<StorageSettingsForm initialConfig={storageConfig} />
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
