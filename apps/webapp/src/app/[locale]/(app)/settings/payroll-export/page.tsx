import { IconFileExport } from "@tabler/icons-react";
import { Suspense } from "react";
import { PayrollConnectorsSettings } from "@/components/settings/payroll-export/payroll-connectors-settings";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import {
	getDatevConfigAction,
	getLexwareConfigAction,
	getPayrollIdentifierFieldsAction,
	getPersonioConfigAction,
	getSageConfigAction,
	getSuccessFactorsConfigAction,
	getWorkdayConfigAction,
} from "./actions";

async function PayrollExportContent() {
	// Enforce org-admin access before fetching any connector configs or identifier fields.
	const [t] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);

	// Fetch connector configs and personnel identifier fields in parallel.
	// Operational export execution and history live in `/payroll?tab=export` (#1957, #1958).
	const [
		datevConfigResult,
		lexwareConfigResult,
		sageConfigResult,
		personioConfigResult,
		successFactorsConfigResult,
		workdayConfigResult,
		identifierFieldsResult,
	] = await Promise.all([
		getDatevConfigAction(),
		getLexwareConfigAction(),
		getSageConfigAction(),
		getPersonioConfigAction(),
		getSuccessFactorsConfigAction(),
		getWorkdayConfigAction(),
		getPayrollIdentifierFieldsAction(),
	]);

	const datevConfig = datevConfigResult.success ? datevConfigResult.data : null;
	const lexwareConfig = lexwareConfigResult.success ? lexwareConfigResult.data : null;
	const sageConfig = sageConfigResult.success ? sageConfigResult.data : null;
	const personioConfig = personioConfigResult.success ? personioConfigResult.data : null;
	const successFactorsConfig = successFactorsConfigResult.success
		? successFactorsConfigResult.data
		: null;
	const workdayConfig = workdayConfigResult.success ? workdayConfigResult.data : null;
	// Employee custom fields every identifier and match setting can use (#821).
	const identifierFields = identifierFieldsResult.success ? identifierFieldsResult.data : [];

	// Mappings belong to the organization; any format that reads them
	// unlocks the Wage Types section (#816).
	const hasMappingFormat = Boolean(
		datevConfig || lexwareConfig || sageConfig || successFactorsConfig,
	);

	const title = t(
		"settings.payrollExport.connectorsTitle",
		"Payroll Connectors & Wage Types",
	);

	return (
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
				<PageHeader
					title={title}
					description={t(
						"settings.payrollExport.connectorsDescription",
						"Configure payroll export connectors and wage type mappings",
					)}
					actions={
						<Button asChild variant="outline">
							<Link href="/payroll?tab=export">
								<IconFileExport aria-hidden="true" className="size-4" />
								{t("settings.payrollExport.openPayrollWorkspace", "Run exports in Payroll")}
							</Link>
						</Button>
					}
				/>

				<PayrollConnectorsSettings
					datevConfig={datevConfig}
					lexwareConfig={lexwareConfig}
					sageConfig={sageConfig}
					personioConfig={personioConfig}
					successFactorsConfig={successFactorsConfig}
					workdayConfig={workdayConfig}
					identifierFields={identifierFields}
					hasMappingFormat={hasMappingFormat}
				/>
			</div>
		</div>
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
