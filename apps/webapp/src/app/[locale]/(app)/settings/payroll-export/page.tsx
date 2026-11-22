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
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import type { PayrollExportFormatId } from "@/lib/payroll-export/format-registry";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
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
		organizationTimezone,
	] = await Promise.all([
		getDatevConfigAction(),
		getLexwareConfigAction(),
		getSageConfigAction(),
		getPersonioConfigAction(),
		getSuccessFactorsConfigAction(),
		getWorkdayConfigAction(),
		getExportHistoryAction(),
		getPayrollIdentifierFieldsAction(),
		// Export times are audit instants, shown in the organization's time zone.
		loadOrganizationTimezone(db, organizationId),
	]);

	const datevConfig = datevConfigResult.success ? datevConfigResult.data : null;
	const lexwareConfig = lexwareConfigResult.success ? lexwareConfigResult.data : null;
	const sageConfig = sageConfigResult.success ? sageConfigResult.data : null;
	const personioConfig = personioConfigResult.success ? personioConfigResult.data : null;
	const successFactorsConfig = successFactorsConfigResult.success
		? successFactorsConfigResult.data
		: null;
	const workdayConfig = workdayConfigResult.success ? workdayConfigResult.data : null;
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
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.payrollExport.title", "Payroll Export")}
			description={t(
				"settings.payrollExport.description",
				"Export work periods to payroll systems like DATEV or Personio",
			)}
			measure
			defaultTab={hasConfiguredExportTarget ? "export" : "datev"}
			tabs={[
				{
					value: "export",
					label: t("settings.payrollExport.tabs.export", "Export"),
					panel: (
						<ExportForm
							organizationId={organizationId}
							config={datevConfig}
							exportAvailability={exportAvailability}
						/>
					),
				},
				{
					value: "datev",
					label: t("settings.payrollExport.tabs.datev", "DATEV"),
					panel: (
						<DatevConfigForm initialConfig={datevConfig} identifierFields={identifierFields} />
					),
				},
				{
					value: "lexware",
					label: t("settings.payrollExport.tabs.lexware", "Lexware"),
					panel: (
						<LexwareConfigForm initialConfig={lexwareConfig} identifierFields={identifierFields} />
					),
				},
				{
					value: "sage",
					label: t("settings.payrollExport.tabs.sage", "Sage"),
					panel: <SageConfigForm initialConfig={sageConfig} identifierFields={identifierFields} />,
				},
				{
					value: "personio",
					label: t("settings.payrollExport.tabs.personio", "Personio"),
					panel: (
						<PersonioConfigForm
							initialConfig={personioConfig}
							identifierFields={identifierFields}
						/>
					),
				},
				{
					value: "successfactors",
					label: t("settings.payrollExport.tabs.successfactors", "SAP SuccessFactors"),
					panel: (
						<SuccessFactorsConfigForm
							initialConfig={successFactorsConfig}
							identifierFields={identifierFields}
						/>
					),
				},
				{
					value: "workday",
					label: t("settings.payrollExport.tabs.workday", "Workday"),
					panel: (
						<WorkdayConfigForm initialConfig={workdayConfig} identifierFields={identifierFields} />
					),
				},
				{
					value: "mappings",
					label: t("settings.payrollExport.tabs.mappings", "Wage Types"),
					panel: (
						<div className="space-y-6">
							<WageTypeMappings hasMappingFormat={hasMappingFormat} />
							<ExpenseWageTypeMappings />
						</div>
					),
				},
				{
					value: "history",
					label: t("settings.payrollExport.tabs.history", "History"),
					panel: <ExportHistory exports={exports} organizationTimezone={organizationTimezone} />,
				},
			]}
		/>
	);
}

function PayrollExportLoading() {
	return (
		<SettingsPageSkeleton
			measure
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
