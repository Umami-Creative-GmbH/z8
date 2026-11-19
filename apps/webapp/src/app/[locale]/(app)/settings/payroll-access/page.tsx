import { connection } from "next/server";
import { Suspense } from "react";
import { PayrollAccessForm } from "@/components/settings/payroll-access/payroll-access-form";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getPayrollAccessAdminDataAction } from "./actions";

async function PayrollAccessSettingsPageContent() {
	const [t] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);
	// Current payroll access grant evaluation must execute per request.
	await connection();
	const result = await getPayrollAccessAdminDataAction();

	const header = (
		<PageHeader
			title={t("settings.payrollAccess.title", "Payroll Officers")}
			description={t(
				"settings.payrollAccess.description",
				"Activate payroll officers and assign the teams or employees they can include in payroll workflows.",
			)}
		/>
	);

	if (!result.success) {
		return (
			<div className="page-frame">
				<div className="page-measure space-y-6">
					{header}
					<Card role="alert">
						<CardHeader>
							<CardTitle>
								{t(
									"settings.payrollAccess.deniedTitle",
									"Payroll officer settings access required",
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.payrollAccess.deniedDescription",
									"Only authorized organization admins can manage payroll officers.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">{result.error}</p>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				{header}
				<PayrollAccessForm
					employees={result.data.employees}
					departedEmployees={result.data.departedEmployees}
					teams={result.data.teams}
					initialGrants={result.data.grants}
				/>
			</div>
		</div>
	);
}

function PayrollAccessSettingsPageLoading() {
	return (
		<div className="page-frame">
			<LoadingRegion
				className="page-measure space-y-6"
				label={{
					labelKey: "settings.payrollAccess.loading",
					labelDefault: "Loading payroll officer settings",
				}}
			>
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" aria-hidden="true" />
					<Skeleton className="h-5 w-full max-w-2xl" aria-hidden="true" />
				</div>
				<Skeleton className="h-64 w-full" aria-hidden="true" />
			</LoadingRegion>
		</div>
	);
}

export default function PayrollAccessSettingsPage() {
	return (
		<Suspense fallback={<PayrollAccessSettingsPageLoading />}>
			<PayrollAccessSettingsPageContent />
		</Suspense>
	);
}
