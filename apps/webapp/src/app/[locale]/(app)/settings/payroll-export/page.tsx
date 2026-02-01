import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { DatevConfigForm } from "@/components/settings/payroll-export/datev-config-form";
import { LexwareConfigForm } from "@/components/settings/payroll-export/lexware-config-form";
import { SageConfigForm } from "@/components/settings/payroll-export/sage-config-form";
import { PersonioConfigForm } from "@/components/settings/payroll-export/personio-config-form";
import { SuccessFactorsConfigForm } from "@/components/settings/payroll-export/successfactors-config-form";
import { ExportForm } from "@/components/settings/payroll-export/export-form";
import { ExportHistory } from "@/components/settings/payroll-export/export-history";
import { WageTypeMappings } from "@/components/settings/payroll-export/wage-type-mappings";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getDatevConfigAction,
	getLexwareConfigAction,
	getSageConfigAction,
	getPersonioConfigAction,
	getSuccessFactorsConfigAction,
	getExportHistoryAction,
} from "./actions";

async function PayrollExportContent() {
	await connection(); // Mark as fully dynamic

	const [t, currentEmployee] = await Promise.all([getTranslate(), getCurrentEmployee()]);

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t("settings.payrollExport.featureName", "Payroll Export")}
				/>
			</div>
		);
	}

	const authContext = await getAuthContext();

	if (!authContext?.employee || authContext.employee.role !== "admin") {
		redirect("/");
	}

	const organizationId = authContext.employee.organizationId;

	// Fetch configs and history in parallel
	const [datevConfigResult, lexwareConfigResult, sageConfigResult, personioConfigResult, successFactorsConfigResult, historyResult] = await Promise.all([
		getDatevConfigAction(organizationId),
		getLexwareConfigAction(organizationId),
		getSageConfigAction(organizationId),
		getPersonioConfigAction(organizationId),
		getSuccessFactorsConfigAction(organizationId),
		getExportHistoryAction(organizationId),
	]);

	const datevConfig = datevConfigResult.success ? datevConfigResult.data : null;
	const lexwareConfig = lexwareConfigResult.success ? lexwareConfigResult.data : null;
	const sageConfig = sageConfigResult.success ? sageConfigResult.data : null;
	const personioConfig = personioConfigResult.success ? personioConfigResult.data : null;
	const successFactorsConfig = successFactorsConfigResult.success ? successFactorsConfigResult.data : null;
	const exports = historyResult.success ? historyResult.data : [];

	// For backward compatibility, use datevConfig as main config
	const config = datevConfig;

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

			<Tabs defaultValue={config ? "export" : "datev"} className="w-full">
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
						{t("settings.payrollExport.tabs.successfactors", "SAP SuccessFactors")}
					</TabsTrigger>
					<TabsTrigger value="mappings">
						{t("settings.payrollExport.tabs.mappings", "Wage Types")}
					</TabsTrigger>
					<TabsTrigger value="history">
						{t("settings.payrollExport.tabs.history", "History")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="export" className="mt-4">
					<ExportForm organizationId={organizationId} config={config} />
				</TabsContent>

				<TabsContent value="datev" className="mt-4">
					<DatevConfigForm organizationId={organizationId} initialConfig={datevConfig} />
				</TabsContent>

				<TabsContent value="lexware" className="mt-4">
					<LexwareConfigForm organizationId={organizationId} initialConfig={lexwareConfig} />
				</TabsContent>

				<TabsContent value="sage" className="mt-4">
					<SageConfigForm organizationId={organizationId} initialConfig={sageConfig} />
				</TabsContent>

				<TabsContent value="personio" className="mt-4">
					<PersonioConfigForm organizationId={organizationId} initialConfig={personioConfig} />
				</TabsContent>

				<TabsContent value="successfactors" className="mt-4">
					<SuccessFactorsConfigForm organizationId={organizationId} initialConfig={successFactorsConfig} />
				</TabsContent>

				<TabsContent value="mappings" className="mt-4">
					<WageTypeMappings organizationId={organizationId} config={config} />
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

export default function PayrollExportPage() {
	return (
		<Suspense fallback={<PayrollExportLoading />}>
			<PayrollExportContent />
		</Suspense>
	);
}
