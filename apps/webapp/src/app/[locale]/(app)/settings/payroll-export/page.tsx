import { Suspense } from "react";
import { DatevConfigForm } from "@/components/settings/payroll-export/datev-config-form";
import { ExpenseWageTypeMappings } from "@/components/settings/payroll-export/expense-wage-type-mappings";
import { ExportForm } from "@/components/settings/payroll-export/export-form";
import { ExportHistory } from "@/components/settings/payroll-export/export-history";
import { LexwareConfigForm } from "@/components/settings/payroll-export/lexware-config-form";
import { PersonioConfigForm } from "@/components/settings/payroll-export/personio-config-form";
import { SageConfigForm } from "@/components/settings/payroll-export/sage-config-form";
import { SuccessFactorsConfigForm } from "@/components/settings/payroll-export/successfactors-config-form";
import { WageTypeMappings } from "@/components/settings/payroll-export/wage-type-mappings";
import { WorkdayConfigForm } from "@/components/settings/payroll-export/workday-config-form";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import type { PayrollExportFormatId } from "@/lib/payroll-export/format-registry";
import { getTranslate } from "@/tolgee/server";
import {
	getDatevConfigAction,
	getExportHistoryAction,
	getLexwareConfigAction,
	getPayrollIdentifierFieldsAction,
	getPersonioConfigAction,
	getSageConfigAction,
	getSuccessFactorsConfigAction,
	getWorkdayConfigAction,
} from "./actions";

type ExportAvailabilityEntry = {
	configured: boolean;
	reason: "missingConfiguration" | "missingCredentials" | null;
};

async function PayrollExportContent() {
	const [t, { organizationId }] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);

	// Fetch configs and history in parallel
	const [
		datevConfigResult,
		lexwareConfigResult,
		sageConfigResult,
		personioConfigResult,
		successFactorsConfigResult,
		workdayConfigResult,
		historyResult,
		identifierFieldsResult,
	] = await Promise.all([
		getDatevConfigAction(organizationId),
		getLexwareConfigAction(organizationId),
		getSageConfigAction(organizationId),
		getPersonioConfigAction(organizationId),
		getSuccessFactorsConfigAction(organizationId),
		getWorkdayConfigAction(organizationId),
		getExportHistoryAction(organizationId),
		getPayrollIdentifierFieldsAction(organizationId),
	]);

	const datevConfig = datevConfigResult.success ? datevConfigResult.data : null;
	const lexwareConfig = lexwareConfigResult.success
		? lexwareConfigResult.data
		: null;
	const sageConfig = sageConfigResult.success ? sageConfigResult.data : null;
	const personioConfig = personioConfigResult.success
		? personioConfigResult.data
		: null;
	const successFactorsConfig = successFactorsConfigResult.success
		? successFactorsConfigResult.data
		: null;
	const workdayConfig = workdayConfigResult.success
		? workdayConfigResult.data
		: null;
	const exports = historyResult.success ? historyResult.data : [];
	// Employee custom fields every identifier and match setting can use (#821).
	const identifierFields = identifierFieldsResult.success ? identifierFieldsResult.data : [];
	// Every registered format (#823) states whether it can export.
	const exportAvailability: Record<PayrollExportFormatId, ExportAvailabilityEntry> = {
		datev_lohn: {
			configured: Boolean(datevConfig),
			reason: datevConfig ? null : "missingConfiguration",
		},
		lexware_lohn: {
			configured: Boolean(lexwareConfig),
			reason: lexwareConfig ? null : "missingConfiguration",
		},
		sage_lohn: {
			configured: Boolean(sageConfig),
			reason: sageConfig ? null : "missingConfiguration",
		},
		personio: {
			configured: Boolean(personioConfig?.hasCredentials),
			reason: !personioConfig
				? "missingConfiguration"
				: personioConfig.hasCredentials
					? null
					: "missingCredentials",
		},
		successfactors_api: {
			configured: Boolean(successFactorsConfig?.hasCredentials),
			reason: !successFactorsConfig
				? "missingConfiguration"
				: successFactorsConfig.hasCredentials
					? null
					: "missingCredentials",
		},
		successfactors_csv: {
			configured: Boolean(successFactorsConfig),
			reason: successFactorsConfig ? null : "missingConfiguration",
		},
		workday_api: {
			configured: Boolean(workdayConfig?.hasCredentials),
			reason: !workdayConfig
				? "missingConfiguration"
				: workdayConfig.hasCredentials
					? null
					: "missingCredentials",
		},
	};
	const hasConfiguredExportTarget = Object.values(exportAvailability).some(
		(entry) => entry.configured,
	);

	// Mappings belong to the organization; any format that reads them
	// unlocks the Wage Types tab (#816).
	const hasMappingFormat = Boolean(
		datevConfig || lexwareConfig || sageConfig || successFactorsConfig,
	);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.payrollExport.title", "Payroll Export")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.payrollExport.description",
						"Export work periods to payroll systems like DATEV or Personio",
					)}
				</p>
			</div>

			<Tabs
				defaultValue={hasConfiguredExportTarget ? "export" : "datev"}
				className="w-full"
			>
				<TabsList>
					<TabsTrigger value="export">
						{t("settings.payrollExport.tabs.export", "Export")}
					</TabsTrigger>
					<TabsTrigger value="datev">
						{t("settings.payrollExport.tabs.datev", "DATEV")}
					</TabsTrigger>
					<TabsTrigger value="lexware">
						{t("settings.payrollExport.tabs.lexware", "Lexware")}
					</TabsTrigger>
					<TabsTrigger value="sage">
						{t("settings.payrollExport.tabs.sage", "Sage")}
					</TabsTrigger>
					<TabsTrigger value="personio">
						{t("settings.payrollExport.tabs.personio", "Personio")}
					</TabsTrigger>
					<TabsTrigger value="successfactors">
						{t(
							"settings.payrollExport.tabs.successfactors",
							"SAP SuccessFactors",
						)}
					</TabsTrigger>
					<TabsTrigger value="workday">
						{t("settings.payrollExport.tabs.workday", "Workday")}
					</TabsTrigger>
					<TabsTrigger value="mappings">
						{t("settings.payrollExport.tabs.mappings", "Wage Types")}
					</TabsTrigger>
					<TabsTrigger value="history">
						{t("settings.payrollExport.tabs.history", "History")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="export" className="mt-4">
					<ExportForm
						organizationId={organizationId}
						config={datevConfig}
						exportAvailability={exportAvailability}
					/>
				</TabsContent>

				<TabsContent value="datev" className="mt-4">
					<DatevConfigForm
						organizationId={organizationId}
						initialConfig={datevConfig}
						identifierFields={identifierFields}
					/>
				</TabsContent>

				<TabsContent value="lexware" className="mt-4">
					<LexwareConfigForm
						organizationId={organizationId}
						initialConfig={lexwareConfig}
						identifierFields={identifierFields}
					/>
				</TabsContent>

				<TabsContent value="sage" className="mt-4">
					<SageConfigForm
						organizationId={organizationId}
						initialConfig={sageConfig}
						identifierFields={identifierFields}
					/>
				</TabsContent>

				<TabsContent value="personio" className="mt-4">
					<PersonioConfigForm
						organizationId={organizationId}
						initialConfig={personioConfig}
						identifierFields={identifierFields}
					/>
				</TabsContent>

				<TabsContent value="successfactors" className="mt-4">
					<SuccessFactorsConfigForm
						organizationId={organizationId}
						initialConfig={successFactorsConfig}
						identifierFields={identifierFields}
					/>
				</TabsContent>

				<TabsContent value="workday" className="mt-4">
					<WorkdayConfigForm
						organizationId={organizationId}
						initialConfig={workdayConfig}
						identifierFields={identifierFields}
					/>
				</TabsContent>

				<TabsContent value="mappings" className="mt-4 space-y-6">
					<WageTypeMappings
						organizationId={organizationId}
						hasMappingFormat={hasMappingFormat}
					/>
					<ExpenseWageTypeMappings />
				</TabsContent>

				<TabsContent value="history" className="mt-4">
					<ExportHistory organizationId={organizationId} exports={exports} />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function PayrollExportLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.payrollExportSettings",
				labelDefault: "Loading payroll export settings",
			}}
		/>
	);
}

export default function PayrollExportPage() {
	return (
		<Suspense fallback={<PayrollExportLoading />}>
			<PayrollExportContent />
		</Suspense>
	);
}
