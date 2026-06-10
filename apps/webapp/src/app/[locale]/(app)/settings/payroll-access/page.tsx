import { connection } from "next/server";
import { PayrollAccessForm } from "@/components/settings/payroll-access/payroll-access-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getPayrollAccessAdminDataAction } from "./actions";

export default async function PayrollAccessSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

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
							{t("settings.payrollAccess.deniedTitle", "Payroll officer settings access required")}
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
