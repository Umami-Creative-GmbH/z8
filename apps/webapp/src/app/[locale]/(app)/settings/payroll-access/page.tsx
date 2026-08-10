import { Suspense } from "react";
import { PayrollAccessForm } from "@/components/settings/payroll-access/payroll-access-form";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getPayrollAccessAdminDataAction } from "./actions";

async function PayrollAccessSettingsPageContent() {
	const [t, , result] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
		getPayrollAccessAdminDataAction(),
	]);

	if (!result.success) {
		return (
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<Card>
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
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.payrollAccess.title", "Payroll Officers")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.payrollAccess.description",
						"Activate payroll officers and assign the teams or employees they can include in payroll workflows.",
					)}
				</p>
			</div>
			<PayrollAccessForm
				employees={result.data.employees}
				teams={result.data.teams}
				initialGrants={result.data.grants}
			/>
		</div>
	);
}

function PayrollAccessSettingsPageLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-5 w-full max-w-2xl" />
			</div>
			<Skeleton className="h-64 w-full" />
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
